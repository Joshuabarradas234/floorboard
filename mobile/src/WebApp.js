// The full Floorboard web app, inside the app. A widget tap arrives as `target` (e.g. post:p1047) and opens there,
// using the web app's own #go- links.
import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONFIG } from './api';
import { C } from './theme';

const hashFor = (target) => (target ? 'go-' + encodeURIComponent(target) : '');
const sameApp = (url) => url.startsWith(CONFIG.webUrl) || url === CONFIG.webUrl.replace(/\/$/, '') || /^(about:|blob:|data:)/.test(url);

// Runs before the web app's own scripts on every load. `pending` is a login to hand over once ({ session, code }),
// or 'clear' after logging out here. It also tells us when the web app logs out (supabase-js removes its key),
// so the widget logs out with it.
function bootScript(pending) {
  return `(function () {
  var P = ${JSON.stringify(pending || null)}, post = function (m) { try { window.ReactNativeWebView.postMessage(m); } catch (e) {} };
  try {
    if (P === 'clear') localStorage.removeItem('floorboard.auth');
    else if (P) { localStorage.setItem('floorboard.auth', JSON.stringify(P.session)); if (P.code) localStorage.setItem('floorboard.storecode.v1', P.code); }
    if (P) post('fb:took');
  } catch (e) {}
  var rm = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function (k) {
    if (k === 'floorboard.auth' && this === window.localStorage) post('fb:signedout');
    return rm.apply(this, arguments);
  };
})(); true;`;
}

const WebApp = forwardRef(function WebApp({ target, pending, onTook, onSignedOut }, ref) {
  const web = useRef(null);
  const insets = useSafeAreaInsets();
  // the first address only: later taps change the hash in place instead of reloading the app
  const uri = useMemo(() => CONFIG.webUrl + (target ? '#' + hashFor(target) : ''), []); // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({
    open(t) { if (web.current && t) web.current.injectJavaScript('location.hash = ' + JSON.stringify(hashFor(t)) + '; true;'); },
  }));
  const external = (url) => { Linking.openURL(url).catch(() => {}); };
  return (
    // iPhone: the web app pads itself for the notch (viewport-fit=cover); Android's web view doesn't pass the insets on
    <View style={[s.page, Platform.OS === 'android' && { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <WebView
        ref={web}
        source={{ uri }}
        style={s.web}
        originWhitelist={['https://*', 'about:*', 'blob:*', 'data:*']}
        injectedJavaScriptBeforeContentLoaded={bootScript(pending)}
        onMessage={(e) => { const m = e.nativeEvent.data; if (m === 'fb:took') onTook(); else if (m === 'fb:signedout') onSignedOut(); }}
        onShouldStartLoadWithRequest={(r) => { if (r.isTopFrame === false || sameApp(r.url)) return true; external(r.url); return false; }}
        onOpenWindow={(e) => external(e.nativeEvent.targetUrl)}
        setSupportMultipleWindows
        javaScriptCanOpenWindowsAutomatically
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        allowsBackForwardNavigationGestures
        contentInsetAdjustmentBehavior="never"
        applicationNameForUserAgent="FloorboardApp/1"
        pullToRefreshEnabled={false}
        decelerationRate="normal"
        onContentProcessDidTerminate={() => web.current && web.current.reload()}
        onRenderProcessGone={() => web.current && web.current.reload()}
      />
    </View>
  );
});
export default WebApp;

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: C.bg }, web: { flex: 1, backgroundColor: C.bg } });
