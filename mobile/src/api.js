// The store's server, called directly over HTTP the way the iPhone widget does in Swift, so the app, the Android widget
// and the iPhone widget all share one login (the tokens live in store.js) without supabase-js refreshing them behind our back.
import Constants from 'expo-constants';
import { SNAPSHOT_COLLS } from './snapshot';

export const CONFIG = Constants.expoConfig.extra.floorboard;
// Staff log in with a made-up address and their PIN, exactly as the web app's CloudLogin does.
export const STAFF_DOMAIN = '@staff.floorboard.app';
export const pinPassword = (pin) => 'fb-' + pin + '-FB';

export class ServerError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function call(path, { method = 'GET', token, body, headers } = {}) {
  let res;
  try {
    res = await fetch(CONFIG.supabaseUrl + path, {
      method,
      headers: { apikey: CONFIG.supabaseKey, Authorization: 'Bearer ' + (token || CONFIG.supabaseKey), 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ServerError('offline', 0);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) throw new ServerError((data && (data.msg || data.message || data.error_description || data.error)) || 'HTTP ' + res.status, res.status, data);
  return data;
}

// a session is the token response plus the staff id it belongs to
const toSession = (t) => ({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at || Math.floor(Date.now() / 1000) + (t.expires_in || 3600), token_type: t.token_type || 'bearer', expires_in: t.expires_in, user: t.user });

export const signIn = async (email, password) => toSession(await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }));
export async function signUp(email, password) {
  const t = await call('/auth/v1/signup', { method: 'POST', body: { email, password } });
  if (!t || !t.access_token) throw new ServerError('The server still asks for email confirmation. Your admin needs to switch “Confirm email” off in Supabase.', 400, t);
  return toSession(t);
}
export const refresh = async (refreshToken) => toSession(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } }));
export const signOut = (token) => call('/auth/v1/logout?scope=local', { method: 'POST', token }).catch(() => {});

export const rpc = (name, args, token) => call('/rest/v1/rpc/' + name, { method: 'POST', token, body: args });
export async function memberOf(token) {
  const rows = await call('/rest/v1/members?select=staff_id', { token });
  return rows && rows[0] ? rows[0].staff_id : null;
}

// Only the parts of the store the widget needs: not chats, messages, files or the activity on each post.
export async function loadRecords(token) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await call('/rest/v1/records?select=coll,id,data&coll=in.(' + SNAPSHOT_COLLS.join(',') + ')&order=coll.asc,id.asc&limit=1000&offset=' + from, { token });
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
