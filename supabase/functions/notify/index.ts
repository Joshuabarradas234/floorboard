// Floorboard "notify" function: sends alerts to phones and computers when the app is closed.
// The app calls it after saving something that needs someone: a new tag, a nudge, an @mention or a direct message.
// It works out the text and the people itself from the saved data, so nobody can send made-up alerts,
// and it skips anyone who is off shift.
// Deploy: Supabase -> Edge Functions -> Deploy a new function -> Via editor -> name it "notify" -> paste -> Deploy.
// Secret needed: VAPID_PRIVATE_KEY (Edge Functions -> Secrets).
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = 'BObiDNxNhrWIwRFL9i6_Ulr5_Mk3wGqsdI8N_wgpSIGR7YitjJmXenVLpklE24tKxb8ePkcg2-QJja_ry4j6-fY';
const APP_LINK = 'https://joshuabarradas234.github.io/floorboard/';
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

type Rec = Record<string, any>;
const TYPES: Rec = { task: 'Task', feedback: 'Feedback', look: 'Look at this', vote: 'Vote' };
const LEVELS: Rec = { red: 'ASAP', amber: 'Important', green: 'General' };

// Same rule as the app: no status means always reachable; "auto" follows the person's usual hours.
function onShift(st: Rec | undefined, now: number): boolean {
  if (!st || !st.mode || st.mode === 'on') return true;
  if (st.mode === 'off') return false;
  const days: number[] = st.days || [1, 2, 3, 4, 5];
  const local = new Date(now - (st.tz || 0) * 60000);
  const day = local.getUTCDay(), mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  const toMin = (t: string) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  const s = toMin(st.start || '08:00'), e = toMin(st.end || '17:00');
  if (s <= e) return days.includes(day) && mins >= s && mins < e;
  return (days.includes(day) && mins >= s) || (days.includes((day + 6) % 7) && mins < e);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const priv = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!priv) return json({ error: 'VAPID_PRIVATE_KEY secret is missing' }, 500);
    webpush.setVapidDetails(APP_LINK, VAPID_PUBLIC_KEY, priv);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });

    // who is asking: must be a signed-in member of the store
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) return json({ error: 'not signed in' }, 401);
    const { data: mem } = await db.from('members').select('staff_id').eq('auth_uid', auth.user.id).maybeSingle();
    if (!mem) return json({ error: 'not a member of this store' }, 403);
    const me: string = mem.staff_id;

    const { items = [] } = await req.json().catch(() => ({ items: [] }));
    const rows = async (coll: string) => ((await db.from('records').select('id,data').eq('coll', coll)).data || []) as { id: string; data: Rec }[];
    const one = async (coll: string, id: string) => ((await db.from('records').select('data').eq('coll', coll).eq('id', id).maybeSingle()).data?.data) as Rec | undefined;
    const users: Rec = Object.fromEntries((await rows('users')).map((r) => [r.id, r.data]));
    const status: Rec = Object.fromEntries((await rows('status')).map((r) => [r.id, r.data]));
    const first = (id: string) => String(users[id]?.name || 'Someone').split(' ')[0];
    const active = Object.values(users).filter((u: Rec) => u.active !== false) as Rec[];
    let groups: Rec | null = null;
    const teamMembers = async (id: string): Promise<string[]> => {
      if (id === 'all') return active.map((u) => u.id);
      if (id === 'managers') return active.filter((u) => u.role !== 'staff').map((u) => u.id);
      if (id.startsWith('g-')) { groups = groups || Object.fromEntries((await rows('groups')).map((r) => [r.id, r.data])); return (groups[id]?.members || []).filter((x: string) => users[x]?.active !== false); }
      return active.filter((u) => (u.depts || []).includes(id) || (u.manages || []).includes(id)).map((u) => u.id);
    };

    const now = Date.now();
    const sends: { to: string; title: string; body: string; tag: string; url: string; urgent: boolean; force?: boolean }[] = [];
    for (const it of (Array.isArray(items) ? items : []).slice(0, 50)) {
      if (it.test) {
        // "Send me a test alert": only ever to the person asking, shown even if Floorboard is open
        sends.push({ to: me, tag: 'test', url: '', urgent: false, force: true, title: 'Floorboard test alert', body: 'Alerts work on this device. You’ll get them even when Floorboard is closed.' });
      } else if (it.post && (it.to || it.nudge)) {
        const p = await one('posts', String(it.post));
        const who = String(it.to || it.nudge);
        const r = await one('rcp', p ? p.id + '|' + who : '');
        if (!p || !r || r.status === 'done' || p.closed) continue;
        sends.push({
          to: who, tag: 'p:' + p.id + (it.nudge ? ':n' : ''), url: '#go-post:' + p.id, urgent: p.level === 'red',
          title: (it.nudge ? 'Reminder · ' : r.escalated ? 'Escalated · ' : '') + (TYPES[p.type] || 'Post') + ' from ' + first(p.author) + ' · ' + (LEVELS[p.level] || ''),
          body: String(p.title || '').slice(0, 180),
        });
      } else if (it.message) {
        const m = await one('messages', String(it.message));
        if (!m || m.user !== me || m.postId || m.kind !== 'msg') continue;
        const c = await one('chats', m.chat);
        if (!c) continue;
        let targets: string[] = [];
        if (c.kind === 'dm') targets = (c.members || []).filter((x: string) => x !== me);
        else for (const t of m.mentions || []) targets.push(...(t.k === 'u' ? [t.id] : await teamMembers(t.id)));
        const a0 = (m.attachments || [])[0];
        const body = m.text || (a0 ? (a0.kind === 'audio' ? 'Voice note' : a0.kind === 'image' ? 'Photo' : 'Attachment') : '');
        for (const to of new Set(targets)) {
          if (to === me) continue;
          sends.push({ to, tag: 'm:' + c.id, url: '#go-chat:' + c.id, urgent: false,
            title: c.kind === 'dm' ? String(users[me]?.name || 'New message') : first(me) + ' tagged you in ' + c.name, body: String(body).slice(0, 180) });
        }
      }
    }
    const reachable = sends.filter((s) => s.force || onShift(status[s.to], now));
    if (!reachable.length) return json({ sent: 0, skipped: sends.length });

    const { data: subs } = await db.from('push_subs').select('*').in('staff_id', [...new Set(reachable.map((s) => s.to))]);
    let sent = 0;
    const gone: string[] = [];
    await Promise.all(reachable.flatMap((s) => (subs || []).filter((x) => x.staff_id === s.to).map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: s.title, body: s.body, tag: s.tag, url: s.url, urgent: s.urgent, force: !!s.force }),
          { TTL: 12 * 3600, urgency: s.urgent ? 'high' : 'normal' });
        sent++;
      } catch (e: any) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) gone.push(sub.endpoint); // the app was removed from that device
      }
    })));
    if (gone.length) await db.from('push_subs').delete().in('endpoint', gone);
    return json({ sent, skipped: sends.length - reachable.length, removed: gone.length });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
