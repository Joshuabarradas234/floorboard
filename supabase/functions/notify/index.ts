// Floorboard "notify" function: sends alerts to phones and computers when the app is closed.
// The app calls it after saving something that needs someone: a new tag, a nudge, an @mention or a direct message.
// It works out the text and the people itself from the saved data, so nobody can send made-up alerts,
// and it skips anyone who is off shift.
// It only uses what the Supabase runtime has built in (fetch and Web Crypto), so there are no packages to load.
// Deploy: Supabase -> Edge Functions -> Deploy a new function -> Via editor -> name it "notify" -> paste -> Deploy.
// Secret needed: VAPID_PRIVATE_KEY (Edge Functions -> Secrets).

const VAPID_PUBLIC_KEY = 'BObiDNxNhrWIwRFL9i6_Ulr5_Mk3wGqsdI8N_wgpSIGR7YitjJmXenVLpklE24tKxb8ePkcg2-QJja_ry4j6-fY';
const APP_LINK = 'https://joshuabarradas234.github.io/floorboard/';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// --- web push: the message is encrypted for that one browser (RFC 8291) and signed with the store's key (RFC 8292) ---
const utf8 = new TextEncoder();
type Bytes = ReturnType<typeof Uint8Array.from>; // plain bytes, as Web Crypto wants them
function b64uDecode(s: string): Bytes {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function b64uEncode(a: Bytes): string {
  let bin = '';
  for (const b of a) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
async function encryptPayload(p256dh: string, authSecret: string, text: string): Promise<Bytes> {
  const ua = b64uDecode(p256dh), secret = b64uDecode(authSecret);
  const mine = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const minePub = new Uint8Array(await crypto.subtle.exportKey('raw', mine.publicKey));
  const theirs = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, mine.privateKey, 256));
  const ikm = await hkdf(secret, shared, concat(utf8.encode('WebPush: info\0'), ua, minePub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(utf8.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt); new DataView(head.buffer).setUint32(16, 4096); head[20] = minePub.length;
  return concat(head, minePub, sealed);
}
const hex = (h: string): Bytes => Uint8Array.from(h.match(/../g)!, (b) => parseInt(b, 16));
// The key goes in the standard PKCS#8 wrapper, so the runtime gets plain bytes and does no text decoding of its own.
async function importVapidKey(privateKey: string, publicKey: string): Promise<CryptoKey> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(privateKey)) {
    throw new Error('the saved VAPID_PRIVATE_KEY is ' + privateKey.length + ' characters' + (/[^A-Za-z0-9_-]/.test(privateKey) ? ' and has characters a key never has' : '')
      + (privateKey === publicKey ? ' (it is the public key)' : '') + '; it should be 43 letters, numbers, - or _');
  }
  const der = concat(hex('308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420'), b64uDecode(privateKey), hex('a144034200'), b64uDecode(publicKey));
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
async function vapidAuth(endpoint: string, key: CryptoKey, publicKey: string, subject: string): Promise<string> {
  const part = (o: unknown) => b64uEncode(utf8.encode(JSON.stringify(o)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8.encode(unsigned)));
  return 'vapid t=' + unsigned + '.' + b64uEncode(sig) + ', k=' + publicKey;
}
// --- end web push ---

// The store's database, reached as the server (so it can read everyone's alert sign-ups).
function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try { const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); return keys.default || Object.values(keys)[0] as string; } catch { return ''; }
}
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const key = serviceKey();
  const auth: Record<string, string> = key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: 'Bearer ' + key };
  const res = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/' + path, { ...init, headers: { ...auth, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!res.ok) throw new Error('database ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.status === 204 ? null : res.json();
}
const q = encodeURIComponent;
const inList = (xs: string[]) => q('(' + xs.map((x) => '"' + x.replace(/"/g, '') + '"').join(',') + ')');

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
  let stage = 'reading the alert key';
  try {
    // forgive the usual paste slips: spaces or line breaks, quotes, or the name pasted in front
    const priv = (Deno.env.get('VAPID_PRIVATE_KEY') || '').replace(/^\s*VAPID_PRIVATE_KEY\s*=\s*/i, '').replace(/["'\s]/g, '');
    if (!priv) return json({ error: 'VAPID_PRIVATE_KEY secret is missing' }, 500);
    const vapidKey = await importVapidKey(priv, VAPID_PUBLIC_KEY);

    // who is asking: must be a signed-in member of the store
    stage = 'checking who is asking';
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || token.startsWith('sb_')) return json({ error: 'not signed in' }, 401);
    const who = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', { headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') || serviceKey(), Authorization: 'Bearer ' + token } });
    if (!who.ok) return json({ error: 'not signed in' }, 401);
    const user = await who.json();
    const mem = (await rest('members?select=staff_id&auth_uid=eq.' + q(user.id)))[0];
    if (!mem) return json({ error: 'not a member of this store' }, 403);
    const me: string = mem.staff_id;

    stage = 'reading what to send';
    const { items = [] } = await req.json().catch(() => ({ items: [] }));
    const rows = async (coll: string) => (await rest('records?select=id,data&coll=eq.' + q(coll))) as { id: string; data: Rec }[];
    const one = async (coll: string, id: string) => ((await rest('records?select=data&coll=eq.' + q(coll) + '&id=eq.' + q(id)))[0] || {}).data as Rec | undefined;
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
        const r = p ? await one('rcp', p.id + '|' + who) : undefined;
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

    stage = 'sending';
    const subs: Rec[] = await rest('push_subs?select=*&staff_id=in.' + inList([...new Set(reachable.map((s) => s.to))]));
    let sent = 0;
    const gone: string[] = [], failed: string[] = [];
    await Promise.all(reachable.flatMap((s) => subs.filter((x) => x.staff_id === s.to).map(async (sub) => {
      try {
        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: { TTL: String(12 * 3600), Urgency: s.urgent ? 'high' : 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
            Authorization: await vapidAuth(sub.endpoint, vapidKey, VAPID_PUBLIC_KEY, APP_LINK) },
          body: await encryptPayload(sub.p256dh, sub.auth, JSON.stringify({ title: s.title, body: s.body, tag: s.tag, url: s.url, urgent: s.urgent, force: !!s.force })),
        });
        if (res.ok) sent++;
        else if (res.status === 404 || res.status === 410) gone.push(sub.endpoint); // the app was removed from that device
        else failed.push(res.status + ' ' + (await res.text()).slice(0, 120));
      } catch (e: any) { failed.push(String(e?.message || e)); }
    })));
    for (const e of gone) await rest('push_subs?endpoint=eq.' + q(e), { method: 'DELETE' });
    return json({ sent, skipped: sends.length - reachable.length, removed: gone.length, failed });
  } catch (e: any) {
    return json({ error: String(e?.message || e), stage }, 500);
  }
});
