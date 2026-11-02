# Floorboard

A store task board that replaces WhatsApp groups. You tag a person or a team with @, choose what it is (task, feedback, look at this, vote) and how urgent it is (red, amber, green), and add photos, videos or documents. Each person sees only what involves them.

This is a working prototype with an example store and example staff. Every login uses the PIN 1234.

## Windows: glass sidebar on the edge of your screen

Double-click `desktop/Start Floorboard.cmd`.

- The sidebar docks to the right edge of the screen. Windows shows your wallpaper through it as frosted glass.
- Show or hide it with **Ctrl+Alt+F**, or click the Floorboard icon in the system tray.
- Right-click the tray icon for: open the full app, keep the sidebar on top, dock it on the left, start with Windows.
- The sidebar and the full app share the same data and update each other live.

## Phone: app icon on your home screen

The `floorboard-app` folder is an installable web app (a PWA). For a phone to install it, the folder has to be online over https (for example on GitHub Pages or Netlify). Then:

- **iPhone:** open the link in Safari → Share → Add to Home Screen.
- **Android:** open the link in Chrome → ⋮ → Install app. Long-press the icon for a shortcut to the "Needs you" sidebar view.

Add `#widget` to the end of the link to open the compact sidebar view.

## Changing the app

`../floorboard.html` is the single source file. After editing it, run `node build.js` in the folder above this one to rebuild `floorboard-app`.

## Limits of this prototype

- Data is stored on each device. To share tasks between phones and computers, it needs a server with real logins (for example Supabase or Firebase).
- Real home-screen widgets (the live tiles on an iPhone or Android home screen) need a native app built on top of that server.
