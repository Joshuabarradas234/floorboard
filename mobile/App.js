// Floorboard on the phone: log in once here, then the full web app opens inside, and the home-screen widget
// (iPhone: targets/widget, Android: src/android) shows what needs you and today's My week.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import SignIn from './src/SignIn';
import WebApp from './src/WebApp';
import { signOut } from './src/api';
import { clearAll, getAuth, getStoreCode, setAuth, setSnapshot } from './src/store';
import { refreshAndRedraw, redrawWidgets } from './src/refresh';
import { startBackgroundRefresh, stopBackgroundRefresh } from './src/background';
import { C } from './src/theme';

const PENDING_KEY = 'floorboard.web.pending'; // the login waiting to be handed to the web app
// floorboard://go?to=post:p1047 → post:p1047
const targetOf = (url) => { if (!url) return null; try { const p = Linking.parse(url); return p.hostname === 'go' && p.queryParams && p.queryParams.to ? String(p.queryParams.to) : null; } catch (e) { return null; } };

export default function App() {
  const [state, setState] = useState('loading'); // loading | out | in
  const [pending, setPending] = useState(null);
  const [first, setFirst] = useState(null);
  const web = useRef(null);

  useEffect(() => {
    (async () => {
      const [auth, p, url] = await Promise.all([getAuth(), AsyncStorage.getItem(PENDING_KEY), Linking.getInitialURL()]);
      setFirst(targetOf(url));
      setPending(p ? JSON.parse(p) : null);
      setState(auth ? 'in' : 'out');
    })();
    const sub = Linking.addEventListener('url', ({ url }) => { const t = targetOf(url); if (t && web.current) web.current.open(t); });
    return () => sub.remove();
  }, []);

  // while logged in: keep the widget current, and update it as the app goes to the background (after ticking things off)
  useEffect(() => {
    if (state !== 'in') return;
    refreshAndRedraw();
    startBackgroundRefresh();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'background') refreshAndRedraw(); });
    return () => sub.remove();
  }, [state]);

  const handOver = async (p) => { setPending(p); if (p) await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(p)); else await AsyncStorage.removeItem(PENDING_KEY); };

  const signedIn = async ({ session, webSession, staff, name }) => {
    await setAuth(session, staff, name);
    await handOver(webSession ? { session: webSession, code: await getStoreCode() } : null);
    setState('in');
  };
  const signedOut = useCallback(async () => {
    const a = await getAuth();
    if (a) signOut(a.access_token);
    await clearAll();
    await setSnapshot({ v: 1, state: 'signedout', at: Date.now() });
    redrawWidgets().catch(() => {});
    stopBackgroundRefresh();
    await handOver(null);
    setState('out');
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {state === 'loading' ? <View style={s.wait}><ActivityIndicator color={C.muted} /></View>
        : state === 'out' ? <SignIn onDone={signedIn} />
        : <WebApp ref={web} target={first} pending={pending} onTook={() => handOver(null)} onSignedOut={signedOut} />}
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({ wait: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' } });
