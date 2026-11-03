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

`source/floorboard.html` is the single source file (every build also copies it here, with `source/build.js`). After editing it, run `node source/build.js` to rebuild the app. Nothing secret is in `source/`: the server address and publishable key live in `config.js`, and the private alert key only in Supabase.

## Connecting your store's server (Supabase)

Without a server, the app runs the demo store and keeps everything on one device. Connected, everyone shares one live store.

1. Create a free project at supabase.com.
2. In the project, open **SQL Editor → New query**, paste all of `supabase/setup.sql` and click **Run**. The result shows your **store code** and your **setup code**.
3. **Authentication → Sign In / Providers → Email**: switch **Confirm email** off (staff log in with a PIN, not an email address).
4. **Project Settings → API**: copy the **Project URL** and the **publishable** (or **anon public**) key into `config.js`.
5. Open the app, type the store code, pick **Store admin**, type your setup code and choose a 6-digit PIN. Rename yourself under People & access.
6. Add your staff under People & access. Each new person gets a one-time setup code; they choose their own PIN with it. A new code also resets a forgotten PIN.

Add `?demo` to the link to open the demo store instead.

## Alerts when the app is closed, and on shift / off shift

Once, after the steps above:

1. **SQL Editor → New query**: paste all of `supabase/push.sql` and click **Run**.
2. **Edge Functions → Deploy a new function → Via editor**: name it `notify`, paste all of `supabase/functions/notify/index.ts`, and deploy. In the function's settings, switch **Verify JWT** off (the function checks who is calling itself).
3. **Edge Functions → Secrets**: add `VAPID_PRIVATE_KEY` with the private key that matches `vapidPublicKey` in `config.js`. Keep the private key out of this repository.

Then each person taps the bell → **Get alerts when Floorboard is closed** on their phone. On an iPhone, Floorboard has to be added to the home screen from Safari first. The Windows sidebar alerts from the tray instead. Nobody gets phone alerts while they're off shift.

## Month end (Finance)

Switch it on in **People & access**: under Finance, turn on **Month end**. A **Month end** page then appears in the menu for Finance, the admins, and anyone with a deadline on it.

- **Paste from Excel**: copy the month-end sheet's rows (the date in one column, the job in the next) and paste them. A name on its own line, like a person's name or two names joined with `&`, starts a new list and picks those people. On a shared list, a job that names one person goes to just them. `Every Thursday` and `Everyday` repeat.
- **Reminders** arrive as ordinary tasks (in Needs you, and on phones with alerts on), the day before by default. If one is missed, whoever set it gets told. The live store sends them from 07:00, as soon as anyone in the store has Floorboard open.
- **Ask managers for invoices** sends every manager a task to hand in the month's invoices, so Finance can see who is still outstanding.
- Before pasting a new month, remove last month's lists with the bin on each list (**By list** view).

## Still to come

- Real home-screen widgets (the live tiles on an iPhone or Android home screen) need a native app built on top of the server.
