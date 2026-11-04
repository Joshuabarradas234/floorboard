// What the app and its widget share: the login and the last snapshot, both as JSON strings.
// iPhone: the App Group's UserDefaults, which the widget (targets/widget) reads and refreshes by itself.
// Android: AsyncStorage, which the widget's task handler reads, since it runs this same JavaScript.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ExtensionStorage } from '@bacons/apple-targets';
import { CONFIG, refresh, ServerError } from './api';

// keys the Swift widget reads too (FloorboardWidget.swift): keep the names in step
export const AUTH_KEY = 'floorboard.auth', SNAPSHOT_KEY = 'floorboard.snapshot', STORE_CODE_KEY = 'floorboard.storecode';

const shared = Platform.OS === 'ios' ? new ExtensionStorage(CONFIG.appGroup) : null;
const getItem = async (k) => (shared ? shared.get(k) : AsyncStorage.getItem(k));
const setItem = async (k, v) => (shared ? shared.set(k, v) : AsyncStorage.setItem(k, v));
const removeItem = async (k) => (shared ? shared.remove(k) : AsyncStorage.removeItem(k));
const getJson = async (k) => { try { const v = await getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };

export const getStoreCode = () => AsyncStorage.getItem(STORE_CODE_KEY);
export const setStoreCode = (c) => (c ? AsyncStorage.setItem(STORE_CODE_KEY, c) : AsyncStorage.removeItem(STORE_CODE_KEY));

// { url, key, staff, name, access_token, refresh_token, expires_at }: the server's address comes along so the
// iPhone widget doesn't need its own copy
export const getAuth = () => getJson(AUTH_KEY);
export const setAuth = (session, staff, name) => setItem(AUTH_KEY, JSON.stringify({
  url: CONFIG.supabaseUrl, key: CONFIG.supabaseKey, staff, name,
  access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at,
}));
export async function clearAll() { await removeItem(AUTH_KEY); await removeItem(SNAPSHOT_KEY); }

export const getSnapshot = () => getJson(SNAPSHOT_KEY);
export const setSnapshot = (snap) => setItem(SNAPSHOT_KEY, JSON.stringify(snap));

// The access token lasts an hour. A refresh hands out a new refresh token and retires the old one, so whoever
// refreshes (the app, or the iPhone widget on its own) saves the pair straight back here, and everyone reads it from here.
let refreshing = null;
export async function validAuth() {
  const a = await getAuth();
  if (!a) return null;
  if (a.expires_at - 60 > Date.now() / 1000) return a;
  if (!refreshing) refreshing = (async () => {
    try {
      const t = await refresh(a.refresh_token);
      const next = { ...a, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at };
      await setItem(AUTH_KEY, JSON.stringify(next));
      return next;
    } catch (e) {
      // the widget may have refreshed a moment ago with the same token: use what it saved
      const now = await getAuth();
      if (now && now.refresh_token !== a.refresh_token) return now;
      if (e instanceof ServerError && (e.status === 400 || e.status === 401)) { await clearAll(); return null; }
      throw e;
    } finally { refreshing = null; }
  })();
  return refreshing;
}
