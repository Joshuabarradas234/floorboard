// Floorboard "ask" function: the brain of Ask Floorboard. It sends the person's question to Claude (Anthropic) with the
// list of things Floorboard can look up (files, tasks, posts, chats, meetings, people, email) and returns Claude's reply.
// The looking up itself happens in the app, on the person's own device, so Claude only ever sees what that person can see
// in Floorboard; the app sends the results back here and Claude answers. Only signed-in members can use it, nothing is
// stored here.
// Deploy: Supabase -> Edge Functions -> Deploy a new function -> Via editor -> name it "ask" -> paste -> Deploy.
// In the function's settings, switch Verify JWT off (the function checks who is calling itself).
// Secret needed: ANTHROPIC_API_KEY (the same one the meeting-notes and sort-files functions use).
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

// What Floorboard can look up. The app runs these and answers with JSON.
const str = (description: string) => ({ type: 'string', description });
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'find_files',
    description: 'Search the files this person can open in Floorboard: their own My files and folders, and their department archives. '
      + 'Matches titles, file names, folders, suppliers, reference numbers and dates, and the text inside PDFs kept on this device. '
      + 'Use a few short words (a supplier, a document kind like invoice or payslip, a number, a month), not a sentence.',
    input_schema: {
      type: 'object',
      properties: {
        query: str('Short search words, e.g. "highveld invoice october".'),
        where: { type: 'string', enum: ['all', 'mine', 'archive'], description: 'Only their own files, only department archives, or both (the default).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'task_progress',
    description: 'Tasks this person can see (ones they sent, ones sent to them, and their teams\' tasks if they are a manager), '
      + 'with each person\'s progress: done, how far along, when they last updated it, overdue, and quiet for 2 days or more.',
    input_schema: {
      type: 'object',
      properties: {
        query: str('Words from the task title or text. Leave out to list them all.'),
        person: str('Only tasks for this person (a first name is enough).'),
        department: str('Only tasks for this department.'),
        status: { type: 'string', enum: ['open', 'overdue', 'stale', 'done', 'all'], description: 'open (the default), overdue, stale (someone has not updated it for 2 days), done, or all.' },
      },
    },
  },
  {
    name: 'needs_me',
    description: 'What is waiting on this person right now: tasks to do, questions to answer, things to look at, and invoices to approve, most urgent first.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_posts',
    description: 'Search posts on the board (tasks, feedback requests, heads-ups, votes and approvals) this person can see, by words in the title or text.',
    input_schema: {
      type: 'object',
      properties: {
        query: str('Short search words.'),
        type: { type: 'string', enum: ['any', 'task', 'feedback', 'look', 'vote', 'approval'], description: 'Only this kind of post.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_chats',
    description: 'Search messages in the chats this person is in (department chats, groups and direct messages).',
    input_schema: {
      type: 'object',
      properties: { query: str('Short search words.'), days: { type: 'integer', description: 'How many days back to look (default 30).' } },
      required: ['query'],
    },
  },
  {
    name: 'calendar',
    description: 'Meetings this person is in between two dates, with where, who and the notes.',
    input_schema: {
      type: 'object',
      properties: { from: str('First day, YYYY-MM-DD (default today).'), to: str('Last day, YYYY-MM-DD (default a week from the first day).') },
    },
  },
  {
    name: 'people',
    description: 'Staff at the store: name, role and departments. Use it to find who someone is or who is in a department.',
    input_schema: { type: 'object', properties: { query: str('A name or a department. Leave out for everyone.') } },
  },
  {
    name: 'search_email',
    description: 'Search this person\'s work email in Outlook (on this computer, or their Microsoft 365 account if it is connected). '
      + 'Matches the subject and who it is from.',
    input_schema: {
      type: 'object',
      properties: { query: str('Short search words: a sender, a company, or words from the subject.'), days: { type: 'integer', description: 'How many days back (default 30).' } },
      required: ['query'],
    },
  },
];

const SYSTEM = 'You are Ask Floorboard, the assistant inside Floorboard, the app the staff of a South African retail store use instead of WhatsApp groups. '
  + 'You help one person at a time find their documents, see how far people are with tasks, find emails and messages, and answer questions about the store\'s work. '
  + 'Look things up with the tools before answering; never guess names, numbers, dates or who has done what. '
  + 'You only see what this person can see in Floorboard. If a tool finds nothing, say so plainly and suggest other words to try. '
  + 'Answer in plain, friendly English, short: a sentence or two, then a short list when there are several things. '
  + 'Name files by their title and say where they are (My files, a folder, or a department archive). Use people\'s first names. '
  + 'Amounts are in rand (R). Dates like "Tue 4 Nov". Do not use tables or headings. '
  + 'You can\'t change anything in Floorboard: if they ask you to, tell them where to do it in the app.';

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

    stage = 'reading the question';
    const raw = await req.text();
    if (raw.length > 600_000) return json({ error: 'the conversation is too long; start a new one', stage }, 413);
    const body = JSON.parse(raw || '{}');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length || messages[0].role !== 'user') return json({ error: 'no question', stage }, 400);
    // who they are and what day it is, from the app (a second system part, so the first stays the same for every request).
    // The app sets it once per conversation and sends it unchanged: Claude's earlier thinking in the conversation is
    // tied to everything before it, this included.
    const c = body.context || {};
    const about = 'The person asking: ' + String(c.name || 'a staff member').slice(0, 80)
      + (c.role ? ', ' + String(c.role).slice(0, 20) : '')
      + (c.departments ? ', in ' + String(c.departments).slice(0, 200) : '')
      + (c.manages ? ', manages ' + String(c.manages).slice(0, 200) : '') + '.'
      + ' Now: ' + String(c.now || new Date().toISOString()).slice(0, 40) + ' (South Africa).'
      + (c.email ? '' : ' Their email is not connected on this device, so search_email will not find anything.');

    stage = 'asking Claude';
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }, { type: 'text', text: about }],
      tools: TOOLS,
      messages,
    });
    // the app adds this to the conversation as it is and sends it back with the results of any look-ups
    return json({ content: response.content, stop_reason: response.stop_reason, model: response.model, usage: response.usage });
  } catch (e: any) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'the ANTHROPIC_API_KEY secret is not a working key', stage }, 500);
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'the AI is busy; try again in a minute', stage }, 429);
    if (e instanceof Anthropic.BadRequestError) return json({ error: 'the AI could not read this conversation; start a new one', stage, detail: e.message }, 400);
    if (e instanceof Anthropic.APIError) return json({ error: 'the AI said: ' + (e.message || e.status), stage }, 502);
    return json({ error: String(e?.message || e), stage }, 500);
  }
});
