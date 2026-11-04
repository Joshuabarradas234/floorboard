// The iPhone home-screen widget (WidgetKit), linked into the Xcode project by @bacons/apple-targets at prebuild.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  displayName: 'Floorboard',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'JavaScriptCore'],
  colors: { $accent: '#FFF4E8', $widgetBackground: '#2b2018' },
  // the same App Group as the app, so the widget can read the login and the last snapshot
  entitlements: { 'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'] },
});
