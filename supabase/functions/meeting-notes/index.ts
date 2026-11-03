// Floorboard "meeting-notes" function: turns what was said in a meeting into notes, decisions, tasks and things
// to approve, using Claude (Anthropic). The app shows the result for checking before anything is added.
// Only signed-in members of the store can use it.
// Deploy: Supabase -> Edge Functions -> Deploy a new function -> Via editor -> name it "meeting-notes" -> paste -> Deploy.
// In the function's settings, switch Verify JWT off (the function checks who is calling itself).
// Secret needed: ANTHROPIC_API_KEY (Edge Functions -> Secrets), from console.anthropic.com -> API keys.
import Anthropic from 'npm:@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try { const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); return keys.default || Object.values(keys)[0] as string; } catch { return ''; }
}
async function rest(path: string): Promise<any> {
  const key = serviceKey();
  const auth: Record<string, string> = key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: 'Bearer ' + key };
  const res = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/' + path, { headers: auth });
  if (!res.ok) throw new Error('database ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

// What comes back, checked by the API against this shape
const NOTES = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'The meeting in a few short paragraphs of plain English: what it was about and what came out of it.' },
    decisions: { type: 'array', items: { type: 'string' }, description: 'What was agreed or decided, one per item.' },
    tasks: {
      type: 'array',
      description: 'Things someone said they would do, or was asked to do.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The job, short and clear, starting with a verb.' },
          who: { type: 'string', description: 'The person it was given to, exactly as named in the people list if they are on it, otherwise as said, or empty if nobody was named.' },
          due: { type: 'string', description: 'The date it is due as YYYY-MM-DD if a day was said or clearly meant, otherwise empty.' },
        },
        required: ['title', 'who', 'due'],
        additionalProperties: false,
      },
    },
    approvals: {
      type: 'array',
      description: 'Spending, quotes, payments or purchases that still need someone to sign them off.',
      items: {
        type: 'object',
        properties: {
          what: { type: 'string', description: 'What needs approving.' },
          supplier: { type: 'string', description: 'The supplier or payee, or empty.' },
          amount: { type: 'number', description: 'The amount in rand, or 0 if none was said.' },
          why: { type: 'string', description: 'One line on why it came up.' },
        },
        required: ['what', 'supplier', 'amount', 'why'],
        additionalProperties: false,
      },
    },
    followups: { type: 'array', items: { type: 'string' }, description: 'Open questions or things to come back to that are not tasks.' },
  },
  required: ['summary', 'decisions', 'tasks', 'approvals', 'followups'],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let stage = 'checking the AI key';
  try {
    const apiKey = (Deno.env.get('ANTHROPIC_API_KEY') || '').replace(/^\s*ANTHROPIC_API_KEY\s*=\s*/i, '').replace(/["'\s]/g, '');
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY secret is missing', stage }, 500);

    // who is asking: must be a signed-in member of the store
    stage = 'checking who is asking';
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || token.startsWith('sb_')) return json({ error: 'not signed in' }, 401);
    const who = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', { headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') || serviceKey(), Authorization: 'Bearer ' + token } });
    if (!who.ok) return json({ error: 'not signed in' }, 401);
    const user = await who.json();
    const mem = (await rest('members?select=staff_id&auth_uid=eq.' + encodeURIComponent(user.id)))[0];
    if (!mem) return json({ error: 'not a member of this store' }, 403);

    stage = 'reading the meeting';
    const body = await req.json().catch(() => ({}));
    const transcript = String(body.transcript || '').trim();
    if (transcript.length < 20) return json({ error: 'nothing to make notes from', stage }, 400);
    if (transcript.length > 400000) return json({ error: 'the transcript is too long for one go', stage }, 413);
    const m = body.meeting || {};
    const people: string[] = (Array.isArray(body.people) ? body.people : []).map(String).slice(0, 300);
    const context = [
      'Meeting: ' + String(m.title || 'Meeting'),
      'Date: ' + String(m.date || ''),
      m.owner ? 'In the diary of: ' + String(m.owner) : '',
      m.attendees && m.attendees.length ? 'Who was in it: ' + m.attendees.map(String).join(', ') : '',
      m.agenda ? 'Agenda: ' + String(m.agenda) : '',
      'People in the store (use these exact names for who): ' + people.join(', '),
    ].filter(Boolean).join('\n');

    stage = 'asking Claude';
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: NOTES } },
      system: 'You write the notes for meetings at a South African retail store, so the person who keeps the diary does not have to. '
        + 'The transcript comes from a phone or laptop listening in the room: it has no speaker names and may have mistakes, so read it for meaning. '
        + 'Keep to what was actually said. Write in plain, short sentences. Amounts are in rand. '
        + 'Turn relative dates such as "by Friday" into dates using the meeting date.',
      messages: [{ role: 'user', content: context + '\n\nTranscript:\n' + transcript }],
    });
    if (response.stop_reason === 'refusal') return json({ error: 'the AI declined to make notes from this transcript', stage }, 422);
    if (response.stop_reason === 'max_tokens') return json({ error: 'the notes came out too long; try a shorter part of the meeting', stage }, 422);
    const text = response.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('');
    const notes = JSON.parse(text);
    return json({ notes, model: response.model, usage: response.usage });
  } catch (e: any) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'the ANTHROPIC_API_KEY secret is not a working key', stage }, 500);
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'the AI is busy; try again in a minute', stage }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: 'the AI said: ' + (e.message || e.status), stage }, 502);
    return json({ error: String(e?.message || e), stage }, 500);
  }
});
