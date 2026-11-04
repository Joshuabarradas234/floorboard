// Fetch what's new, work out the widget's snapshot, save it, and redraw the widgets.
import React from 'react';
import { Platform } from 'react-native';
import { ExtensionStorage } from '@bacons/apple-targets';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { loadRecords, ServerError } from './api';
import { buildSnapshot } from './snapshot';
import { validAuth, getSnapshot, setSnapshot } from './store';
import { FloorboardWidget, ANDROID_WIDGET } from './android/FloorboardWidget';

// Returns the snapshot to show: a fresh one, or the last one marked stale when the server can't be reached.
export async function refreshSnapshot() {
  let snap;
  try {
    const auth = await validAuth();
    if (!auth) snap = { v: 1, state: 'signedout', at: Date.now() };
    else snap = buildSnapshot(await loadRecords(auth.access_token), auth.staff, Date.now());
    await setSnapshot(snap);
  } catch (e) {
    const last = await getSnapshot();
    snap = last ? { ...last, stale: true } : { v: 1, state: e instanceof ServerError && e.status === 0 ? 'offline' : 'error', at: Date.now() };
  }
  return snap;
}

export async function redrawWidgets(snap) {
  if (Platform.OS === 'ios') { ExtensionStorage.reloadWidget(); return; }
  if (Platform.OS !== 'android') return;
  const s = snap || (await getSnapshot());
  await requestWidgetUpdate({ widgetName: ANDROID_WIDGET, renderWidget: (info) => <FloorboardWidget snap={s} width={info.width} height={info.height} /> });
}

export async function refreshAndRedraw() {
  const snap = await refreshSnapshot();
  await redrawWidgets(snap).catch(() => {});
  return snap;
}
