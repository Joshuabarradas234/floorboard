// Logging in, the same three steps as the web app's CloudLogin: store code, pick your name, PIN
// (or, the first time, the setup code from your manager and a new PIN).
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { memberOf, pinPassword, rpc, signIn, signOut, signUp, STAFF_DOMAIN } from './api';
import { getStoreCode, setStoreCode } from './store';
import { C } from './theme';

const digits = (v) => v.replace(/\D/g, '').slice(0, 6);
const initials = (name) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// onDone({ session, webSession, staff, name }): session is for the app and widget, webSession a second, separate login
// for the full web app inside the app, so the two never use up each other's refresh tokens
export default function SignIn({ onDone }) {
  const [code, setCode] = useState('');
  const [dir, setDir] = useState(null);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [pin, setPin] = useState(''); const [pin2, setPin2] = useState(''); const [setup, setSetup] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const loadDir = async (c) => {
    setBusy(true); setErr('');
    try {
      const data = await rpc('staff_directory', { p_code: c.trim() });
      await setStoreCode(c.trim().toUpperCase());
      setDir(data || []);
    } catch (e) {
      setDir(null);
      setErr(/store code/i.test(e.message) ? 'That store code isn’t right. Ask your manager for it.' : 'Can’t reach the store’s server. Check your internet connection.');
    }
    setBusy(false);
  };
  useEffect(() => { getStoreCode().then((c) => { if (c) { setCode(c); loadDir(c); } }); }, []);

  // the list may be minutes old: check again whether this person has set up their login somewhere since
  const pickUser = async (u) => {
    setSel(u); setErr(''); setPin(''); setPin2(''); setSetup('');
    try {
      const data = await rpc('staff_directory', { p_code: code });
      setDir(data); const fresh = data.find((x) => x.id === u.id); if (fresh) setSel((cur) => (cur && cur.id === fresh.id ? fresh : cur));
    } catch (e) { /* keep the list we have */ }
  };

  async function submit() {
    setErr('');
    const email = sel.handle + STAFF_DOMAIN, password = pinPassword(pin);
    if (sel.claimed) {
      if (pin.length !== 6) return setErr('Your PIN is 6 digits.');
    } else {
      if (setup.length !== 6) return setErr('The setup code from your manager is 6 digits.');
      if (pin.length !== 6) return setErr('Choose a 6-digit PIN you’ll remember.');
      if (pin !== pin2) return setErr('The two PINs don’t match. Type the same PIN twice.');
    }
    setBusy(true);
    try {
      let session;
      if (sel.claimed) {
        try { session = await signIn(email, password); } catch (e) {
          setPin(''); setBusy(false);
          return setErr(e.status === 0 ? 'Can’t reach the store’s server. Check your internet connection.' : 'That PIN doesn’t match. If you’ve forgotten it, ask your manager for a new setup code.');
        }
      } else {
        try { session = await signUp(email, password); } catch (e) {
          if (!/registered|exists/i.test(e.message)) throw e;
          session = await signIn(email, password);
        }
        // already set up on another phone or computer: the PIN worked, so just go in
        if ((await memberOf(session.access_token)) !== sel.id) {
          const ok = await rpc('claim_login', { p_staff: sel.id, p_code: setup }, session.access_token);
          if (!ok) { await signOut(session.access_token); setBusy(false); return setErr('That setup code isn’t right or has expired. Ask your manager for a new one.'); }
        }
      }
      const staff = await memberOf(session.access_token);
      if (staff !== sel.id) { await signOut(session.access_token); setBusy(false); return setErr('This login isn’t linked to ' + sel.name + ' any more. Ask your manager for a new setup code.'); }
      const webSession = await signIn(email, password).catch(() => null);
      setBusy(false);
      onDone({ session, webSession, staff, name: sel.name });
    } catch (e) {
      setBusy(false);
      setErr(e.status === 0 ? 'Can’t reach the store’s server. Check your internet connection.' : 'Couldn’t log in: ' + e.message);
    }
  }

  const groups = useMemo(() => {
    const g = {};
    (dir || []).filter((u) => !q || u.name.toLowerCase().includes(q.toLowerCase())).forEach((u) => { const k = u.dept_name || 'Other'; (g[k] = g[k] || []).push(u); });
    return Object.entries(g);
  }, [dir, q]);

  const Button = (p) => <ActionButton busy={busy} {...p} />;

  return (
    <KeyboardAvoidingView style={s.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.brand}><View style={s.mark}><Text style={s.markT}>F</Text></View><View><Text style={s.brandT}>Floorboard</Text><Text style={s.brandS}>Your store, live</Text></View></View>
        <View style={s.card}>
          {!dir ? (
            <>
              <Text style={s.h}>Enter your store code</Text>
              <Text style={s.p}>Your manager gives you this once. This phone remembers it.</Text>
              <TextInput style={[s.input, s.code]} value={code} autoFocus autoCapitalize="characters" autoCorrect={false} placeholder="Store code" placeholderTextColor={C.faint}
                onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} onSubmitEditing={() => code.trim() && loadDir(code)} />
              {err ? <Text style={s.err}>{err}</Text> : null}
              <Button title="Continue" onPress={() => loadDir(code)} disabled={!code.trim()} />
            </>
          ) : !sel ? (
            <>
              <Text style={s.h}>Who’s logging in?</Text>
              <Text style={s.p}>Pick your name.</Text>
              <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Find your name" placeholderTextColor={C.faint} />
              {dir.length === 0 ? <Text style={s.p}>No one has been added yet.</Text> : null}
              {groups.map(([g, list]) => (
                <View key={g} style={{ gap: 6 }}>
                  <Text style={s.group}>{g}</Text>
                  {list.map((u) => (
                    <Pressable key={u.id} onPress={() => pickUser(u)} style={({ pressed }) => [s.person, pressed && { opacity: 0.7 }]}>
                      <View style={s.av}><Text style={s.avT}>{initials(u.name)}</Text></View>
                      <View style={{ flex: 1 }}><Text style={s.name}>{u.name}</Text><Text style={s.title}>{(u.title || '') + (u.claimed ? '' : ' · first time')}</Text></View>
                    </Pressable>
                  ))}
                </View>
              ))}
              <Pressable onPress={() => { setDir(null); setCode(''); setStoreCode(''); }}><Text style={s.link}>Use a different store code</Text></Pressable>
            </>
          ) : (
            <>
              <View style={s.person}>
                <View style={[s.av, { width: 48, height: 48, borderRadius: 24 }]}><Text style={s.avT}>{initials(sel.name)}</Text></View>
                <View style={{ flex: 1 }}><Text style={s.h}>{sel.name}</Text><Text style={s.title}>{sel.title}</Text></View>
              </View>
              {!sel.claimed ? (
                <>
                  <Text style={s.p}>First time here? Type the 6-digit setup code your manager gave you, then choose your own 6-digit PIN. You’ll use that PIN from now on.</Text>
                  <Field label="Setup code from your manager" value={setup} onChangeText={(v) => setSetup(digits(v))} keyboardType="number-pad" autoFocus />
                </>
              ) : null}
              <Field label={sel.claimed ? 'Your PIN' : 'Choose a 6-digit PIN'} value={pin} onChangeText={(v) => { setPin(digits(v)); setErr(''); }} keyboardType="number-pad" secureTextEntry autoFocus={sel.claimed}
                onSubmitEditing={sel.claimed ? submit : undefined} />
              {!sel.claimed ? <Field label="Type the PIN again" value={pin2} onChangeText={(v) => setPin2(digits(v))} keyboardType="number-pad" secureTextEntry /> : null}
              {err ? <Text style={s.err}>{err}</Text> : null}
              <Button title={sel.claimed ? 'Log in' : 'Set up my login'} onPress={submit} />
              <Pressable onPress={() => setSel(null)}><Text style={s.link}>Not {sel.name.split(' ')[0]}? Pick someone else</Text></Pressable>
            </>
          )}
        </View>
        <Text style={s.foot}>Once you’re in, add the Floorboard widget to your home screen: it shows what needs you and your day, and opens straight to it.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ActionButton({ title, onPress, disabled, busy }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} style={({ pressed }) => [s.btn, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
      {busy ? <ActivityIndicator color={C.ink} /> : <Text style={s.btnT}>{title}</Text>}
    </Pressable>
  );
}
function Field({ label, ...p }) {
  return <View style={{ gap: 6 }}><Text style={s.label}>{label}</Text><TextInput placeholderTextColor={C.faint} style={s.input} autoCorrect={false} autoCapitalize="none" {...p} /></View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 20, paddingTop: 72, gap: 18, maxWidth: 520, width: '100%', alignSelf: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center' },
  markT: { color: C.bg, fontWeight: '800', fontSize: 20 },
  brandT: { color: C.text, fontSize: 18, fontWeight: '700' },
  brandS: { color: C.muted, fontSize: 13 },
  card: { backgroundColor: C.glass, borderColor: C.line, borderWidth: 1, borderRadius: 22, padding: 18, gap: 12 },
  h: { color: C.text, fontSize: 20, fontWeight: '700' },
  p: { color: C.muted, fontSize: 14, lineHeight: 20 },
  label: { color: C.muted, fontSize: 13, fontWeight: '600' },
  input: { backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 16 },
  code: { letterSpacing: 6, fontSize: 20, textAlign: 'center' },
  btn: { backgroundColor: C.text, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnT: { color: C.ink, fontSize: 16, fontWeight: '700' },
  err: { color: C.red, fontSize: 14 },
  link: { color: C.muted, fontSize: 14, textAlign: 'center', textDecorationLine: 'underline', paddingVertical: 6 },
  group: { color: C.faint, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 6 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  av: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#5E6B65', alignItems: 'center', justifyContent: 'center' },
  avT: { color: '#fff', fontWeight: '700', fontSize: 13 },
  name: { color: C.text, fontSize: 16, fontWeight: '600' },
  title: { color: C.muted, fontSize: 13 },
  foot: { color: C.faint, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
