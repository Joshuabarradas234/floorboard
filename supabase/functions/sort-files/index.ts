// Floorboard "sort-files" function: reads documents (their text, or a photo of the paper) and says which folder each
// belongs in, with a clear title, using Claude (Anthropic). The app shows the plan for checking before anything moves.
// Only signed-in members of the store can use it. Nothing is stored here.
// Deploy: Supabase -> Edge Functions -> Deploy a new function -> Via editor -> name it "sort-files" -> paste -> Deploy.
// In the function's settings, switch Verify JWT off (the function checks who is calling itself).
// Secret needed: ANTHROPIC_API_KEY (the same one the meeting-notes function uses).
import Anthropic from 'npm:@anthropic-ai/sdk';

const MODEL = 'claude-haiku-5-5'; // quick and cheap: sorting a batch of documents costs a few cents
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

    stage = 'reading the files';
    const body = await req.json().catch(() => ({}));
    const folders: string[] = [...new Set((Array.isArray(body.folders) ? body.folders : []).map((f: unknown) => String(f).slice(0, 60)).filter(Boolean))].slice(0, 60);
    const files = (Array.isArray(body.files) ? body.files : []).slice(0, 40);
    if (!folders.length || !files.length) return json({ error: 'nothing to sort', stage }, 400);

    // one block per file: what it's called, the text inside it, or a picture of it
    const content: any[] = [{ type: 'text', text: 'Folders to choose from:\n' + folders.map((f) => '- ' + f).join('\n') + '\n\nThe files:' }];
    let pictures = 0;
    files.forEach((f: any, i: number) => {
      content.push({ type: 'text', text: '\n#' + i + ' title: ' + String(f.title || '').slice(0, 160) + ' | file name: ' + String(f.name || '').slice(0, 160)
        + (f.text ? '\nText inside (start):\n' + String(f.text).slice(0, 1800) : '') });
      const m = typeof f.image === 'string' && f.image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (m && pictures < 12 && m[2].length < 1_400_000) { content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }); pictures++; }
    });

    const SORTED = {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              n: { type: 'integer', description: 'The file number (#).' },
              folder: { type: 'string', enum: folders, description: 'The folder it belongs in.' },
              title: { type: 'string', description: 'A short clear title: the kind of document, who it is from or about, and its number or month if there is one. Empty if the current title is already clear.' },
            },
            required: ['n', 'folder', 'title'],
            additionalProperties: false,
          },
        },
      },
      required: ['files'],
      additionalProperties: false,
    };

    stage = 'asking Claude';
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { format: { type: 'json_schema', schema: SORTED } },
      system: 'You file documents for staff at a South African retail store. For each file, pick the one folder it belongs in from the list, '
        + 'going by what the document is (an invoice, a quote, a delivery note, a payslip, a contract...), from its text or picture first and its name second. '
        + 'Prefer a folder the person already has over a general one when both fit. Use "Other" only when nothing fits. '
        + 'Suggest a clear title only when the current one is unclear (like a scanner or camera file name). Amounts are in rand.',
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') return json({ error: 'the AI declined to sort these files', stage }, 422);
    const text = response.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('');
    const out = JSON.parse(text).files || [];
    const results = out.filter((r: any) => files[r.n]).map((r: any) => ({ id: String(files[r.n].id), folder: r.folder, title: String(r.title || '').slice(0, 120) }));
    return json({ results, model: response.model, usage: response.usage });
  } catch (e: any) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'the ANTHROPIC_API_KEY secret is not a working key', stage }, 500);
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'the AI is busy; try again in a minute', stage }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: 'the AI said: ' + (e.message || e.status), stage }, 502);
    return json({ error: String(e?.message || e), stage }, 500);
  }
});
