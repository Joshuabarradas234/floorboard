// Floorboard "meeting-notes" function: turns what was said in a meeting into notes, decisions, tasks and things
// to approve, using Claude (Anthropic). The app shows the result for checking before anything is added.
// Only signed-in members of the store can use it.
// Deploy: Supabase -> Edge Functions -> Deploy a new function -> Via editor -> name it "meeting-notes" -> paste -> Deploy.
// In the function's settings, switch Verify JWT off (the function checks who is calling itself).
// Secret needed: ANTHROPIC_API_KEY (Edge Functions -> Secrets), from console.anthropic.com -> API keys.
//
// Minutes (the Windows app's sidebar recorder) also uses it to write down who said what:
//   { action: 'transcribe', path, speakers }  the meeting's sound, uploaded by the person to files/me/<them>/minutes/…,
//                                             goes to AssemblyAI (speech to text, split by voice) -> { id }
//   { action: 'transcript', id }              -> { status } until done, then { status: 'completed', utterances }, and the
//                                             recording and transcript are deleted at AssemblyAI straight away
//   and the notes themselves can come with pictures of the screen: { screens: [{ at: 'm:ss', path }] }.
// Secret needed for that: ASSEMBLYAI_API_KEY (Edge Functions -> Secrets), from assemblyai.com -> Dashboard -> API keys.
import Anthropic from 'npm:@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const AAI = 'https://api.assemblyai.com/v2';
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

// the store's file storage, as the server (the person's own files: me/<them>/…)
const storageAuth = (): Record<string, string> => { const key = serviceKey(); return key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: 'Bearer ' + key }; };
const encPath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
async function signedUrl(path: string): Promise<string> {
  const res = await fetch(Deno.env.get('SUPABASE_URL') + '/storage/v1/object/sign/files/' + encPath(path), { method: 'POST', headers: { ...storageAuth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 7200 }) });
  if (!res.ok) throw new Error('storage ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const out = await res.json(), rel = String(out.signedURL || out.signedUrl || '');
  if (!rel) throw new Error('storage gave no link');
  return /^https?:/.test(rel) ? rel : Deno.env.get('SUPABASE_URL') + '/storage/v1' + (rel.startsWith('/') ? rel : '/' + rel);
}
async function download(path: string): Promise<Uint8Array> {
  const res = await fetch(Deno.env.get('SUPABASE_URL') + '/storage/v1/object/files/' + encPath(path), { headers: storageAuth() });
  if (!res.ok) throw new Error('storage ' + res.status);
  return new Uint8Array(await res.arrayBuffer());
}
function base64(bytes: Uint8Array): string { let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s); }
const aaiKey = () => (Deno.env.get('ASSEMBLYAI_API_KEY') || '').replace(/^\s*ASSEMBLYAI_API_KEY\s*=\s*/i, '').replace(/["'\s]/g, '');
async function aai(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(AAI + path, { ...init, headers: { authorization: aaiKey(), 'content-type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  if (res.status === 401) throw new Error('the ASSEMBLYAI_API_KEY secret is not a working key');
  if (!res.ok) throw new Error('AssemblyAI said ' + res.status + ': ' + text.slice(0, 200));
  try { return JSON.parse(text); } catch { return {}; }
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
    speakers: {
      type: 'array',
      description: 'Only when the transcript has speaker labels (Speaker A, Speaker B...): who each label is. Empty otherwise.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'The label exactly as in the transcript, e.g. "Speaker A".' },
          name: { type: 'string', description: 'The person, using the name from the list of who was in the meeting, or empty if it is not clear who it is.' },
          sure: { type: 'boolean', description: 'True only when the transcript makes it clear (they are named, introduce themselves, or are answered by name).' },
        },
        required: ['label', 'name', 'sure'],
        additionalProperties: false,
      },
    },
    walkthrough: {
      type: 'array',
      description: 'Only when there are pictures of the screen: the meeting in order, one item per thing that was gone through. Empty otherwise.',
      items: {
        type: 'object',
        properties: {
          at: { type: 'string', description: 'When it started, as m:ss or h:mm:ss from the start of the meeting.' },
          screen: { type: 'string', description: 'What was on the screen: the app, document or page, and the figures or items that mattered.' },
          discussed: { type: 'string', description: 'What was said, suggested, asked or decided while it was on screen, and by whom when known.' },
        },
        required: ['at', 'screen', 'discussed'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'decisions', 'tasks', 'approvals', 'followups', 'speakers', 'walkthrough'],
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

    const body = await req.json().catch(() => ({}));

    // Minutes: the meeting's sound to AssemblyAI, to be written down split by voice
    if (body.action === 'transcribe') {
      stage = 'sending the sound to be written down';
      if (!aaiKey()) return json({ error: 'ASSEMBLYAI_API_KEY secret is missing', stage }, 500);
      const path = String(body.path || '');
      if (!path.startsWith('me/' + mem.staff_id + '/minutes/') || path.includes('..')) return json({ error: 'not your recording', stage }, 403);
      const n = Math.max(0, Math.min(20, Number(body.speakers) || 0));
      const job = await aai('/transcript', {
        method: 'POST',
        body: JSON.stringify({
          audio_url: await signedUrl(path), language_code: 'en', speaker_labels: true,
          ...(n >= 2 ? { speaker_options: { min_speakers_expected: 1, max_speakers_expected: n + 1 } } : {}),
        }),
      });
      return json({ id: job.id, status: job.status });
    }
    if (body.action === 'transcript') {
      stage = 'writing down what was said';
      if (!aaiKey()) return json({ error: 'ASSEMBLYAI_API_KEY secret is missing', stage }, 500);
      const id = String(body.id || '');
      if (!/^[\w-]{6,80}$/.test(id)) return json({ error: 'no such transcript', stage }, 400);
      const t = await aai('/transcript/' + id);
      if (t.status === 'error') { aai('/transcript/' + id, { method: 'DELETE' }).catch(() => {}); return json({ status: 'error', error: String(t.error || 'it could not be written down') }); }
      if (t.status !== 'completed') return json({ status: t.status });
      const utterances = (t.utterances || []).map((u: any) => ({ speaker: String(u.speaker || ''), start: Number(u.start) || 0, end: Number(u.end) || 0, text: String(u.text || '') }));
      await aai('/transcript/' + id, { method: 'DELETE' }).catch(() => {}); // nothing kept there once it's back
      return json({ status: 'completed', utterances, text: String(t.text || '') });
    }

    stage = 'reading the meeting';
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

    // pictures of the screen during the meeting (Minutes, screen and voice): from the person's own files, at most 40
    stage = 'reading the pictures of the screen';
    const shots = (Array.isArray(body.screens) ? body.screens : [])
      .filter((s: any) => s && typeof s.path === 'string' && s.path.startsWith('me/' + mem.staff_id + '/minutes/') && !s.path.includes('..')).slice(0, 40);
    const pictures: any[] = [];
    for (const s of shots) {
      try { pictures.push({ type: 'text', text: 'Screen at ' + String(s.at || '') + ':' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64(await download(s.path)) } }); } catch { /* skip a picture that's gone */ }
    }
    const labelled = /^\[\d[\d:]*\] Speaker [A-Z]+:/m.test(transcript);

    stage = 'asking Claude';
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: NOTES } },
      system: 'You write the notes for meetings at a South African retail store, so the person who keeps the diary does not have to. '
        + (labelled
          ? 'The transcript was written down by a speech service that split it by voice: each line starts with the time from the start of the meeting and a speaker label (Speaker A, Speaker B...). The labels are the same person throughout, but they are not names, and the words may have mistakes, so read for meaning. '
            + 'Work out who each label is from the list of who was in the meeting, using what is said (names used, introductions, roles, who is asked something and who answers), and fill in speakers; leave the name empty when it is not clear. Use the names, not the labels, in the summary, decisions and tasks when you know them. '
          : 'The transcript comes from a phone or laptop listening in the room: it has no speaker names and may have mistakes, so read it for meaning. Leave speakers empty. ')
        + (pictures.length
          ? 'You also get pictures of the screen taken during the meeting, each with its time. In walkthrough, go through the meeting in order, one item per thing that was looked at or gone through: when it started, what was on the screen (the app, document or page and the figures or items that mattered), and what was said, suggested, asked or decided about it, and by whom. Mention in the summary what was gone through on screen. '
          : 'Leave walkthrough empty. ')
        + 'Keep to what was actually said and shown. Write in plain, short sentences. Amounts are in rand. '
        + 'Turn relative dates such as "by Friday" into dates using the meeting date.',
      messages: [{ role: 'user', content: [{ type: 'text', text: context + '\n\nTranscript:\n' + transcript }, ...pictures] }],
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
