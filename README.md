# Floorboard

A store task board that replaces WhatsApp groups. You tag a person or a team with @, choose what it is (task, feedback, look at this, vote) and how urgent it is (red, amber, green), and add photos, videos or documents. Each person sees only what involves them.

This is a working prototype with an example store and example staff. Every login uses the PIN 1234.

## Windows: glass sidebar on the edge of your screen

Double-click `desktop/Start Floorboard.cmd`.

- The sidebar docks to the right edge of the screen. Windows shows your wallpaper through it as frosted glass.
- **Search** at the top of the sidebar: posts, messages, documents and people (`@bakery`, `#1047`, `invoice highveld`). Enter opens the full app's search with your words in it.
- **Fold it into a slim bar:** the sidebar button at the top (next to ✕) folds it into a small rounded glass rail of icons, floating in the middle of the screen edge (clear of the window buttons in the corners), in your wallpaper's colours: Needs you, Chats, Today, Sticky notes, Files, Calendar and New post, each with its count (red for ASAP, green for unread chats). Click an icon and the sidebar opens up on that section; click the Floorboard mark or your picture to open it. While it's folded it always stays in front of every window, so it's always to hand. It stays folded or open the way you left it, and remembers the width you dragged it to.
- **Close it to a floating button:** close the sidebar (✕ at the top, the tray icon, or **Ctrl+Alt+F**) and it becomes one small Floorboard button floating in front of every window, bottom right at first. Click it and the whole sidebar opens. Drag it anywhere on the screen and it stays there. Its badge shows how many things need you, and turns red for ASAP. While the sidebar is open the button steps aside.
- You can also show or hide the sidebar with **Ctrl+Alt+F**, or by clicking the Floorboard icon in the system tray.
- **The bar at the top of the screen:** a small dark pill hangs from the top middle of the screen, in front of everything. It shows the newest unread chat, how many messages are unread (green) and how many things need you (red for ASAP). Point at it or click it and it opens: one line per chat with who wrote, what they said and how many are unread. Photos, voice notes and files show as labels. Click a chat to read it there and type an answer; **Enter** sends. A chat only counts as read once you open it. **Esc**, or clicking somewhere else, folds it back into the pill. The arrow button opens that chat in the full app.
- Right-click the tray icon for: open the full app, keep the sidebar on top, show or hide the floating button, show or hide the bar at the top, dock it on the left, start with Windows.
- The sidebar, the bar and the full app share the same data and update each other live.

### Floorboard's own island (Windows)

Floorboard has its own island at the top middle of the screen, laid out and working like Coucou's (it can take Coucou's place: the tray icon's menu → **Floorboard's own island at the top (instead of Coucou)**; Floorboard then sends nothing to Coucou, and whether to keep Coucou is yours). Closed, it's a small black island with a character for each card and its number: WhatsApp's unread messages, Outlook's unread emails, tasks still to do, what needs you in JARVIS, and in Floorboard what needs you and unread chats; open, **Home** has one card big on the left and the others in a grid (click one to bring it big), **💬** is Ask Floorboard (or JARVIS), and **➕** takes files dropped on it (save them to My files, or send them to JARVIS). A chat, an email, a search or a list makes it taller.

- **Floorboard:** a search bar for posts, documents, chats and people (Enter opens the full search), and what needs you.
- **Tasks:** how many are still to do (this week's task-board tasks and tasks people sent you), each to open or move along, and how far each team you run is.
- **JARVIS** (the account it's linked to): what needs you, the jobs and how far they are, the Tower and the morning brief, in turn; all of it when opened.
- **Mail:** Outlook (classic)'s inbox, an email to read, a search. It reads the Outlook that's open (a button opens it when it isn't) and marks nothing.
- **WhatsApp:** your chats with how many unread in each (messages since you last wrote there or opened it in the island; opening a chat here marks it read on your phone too, as Coucou did), a chat to read and answer (Enter sends; only to your own chats and contacts, never a typed-in number, and not too fast), finding someone in your address book, and ↗ to open WhatsApp Desktop. It uses the WhatsApp gateway already linked to your phone (the one Coucou set up): the first time Floorboard starts it, it copies the gateway and the link into its own folder (`%APPDATA%Floorboardwhatsapp-gateway`) and runs it from there, so Coucou can be uninstalled without scanning the code again.
- **Getting your attention:** news twirls that card's character once (a WhatsApp message, an email, a task, or from JARVIS something that needs you, a job finished, or the morning brief); a message also opens the island a little with who it's from and what they said; a call opens it on WhatsApp with the character shaking until it stops ringing (**Answer in WhatsApp**, or **Not now**). With the island chosen over Coucou, the WhatsApp gateway tells Floorboard of messages and calls straight away. A soft sound goes with news (⚙ or 🔊 turns it off).
- **Characters:** ghosts or slimes (⚙), one pastel colour per card. Their eyes follow your pointer anywhere on the screen; they blink, smile, look surprised at news, grin when pointed at, shut their eyes when everything's been still a while, and keep still with Windows' reduce-motion setting. Tap one and it gets heart eyes and a happy squish, with hearts floating up. They're Floorboard's own (Coucou's code is MIT; its name, characters, icon and sounds are its own and aren't used).

### Floorboard in Coucou's island (Windows)

If you use [Coucou](https://github.com/Louis-CFM/coucou) (a free app that puts WhatsApp, classic Outlook mail and more in an island at the top of the screen), Floorboard joins it as Coucou's big main card, named **Floorboard** while it's open (Coucou keeps that card for a coding tool, "Claude Code" unless changed, and still labels it so). It shows your department at a glance (its open tasks and how far the team is with this week's task board, and how far you are), or for an admin the whole store (what's overdue and ASAP, and how far everyone is this week), then how many things need you, how many chats are unread and the newest thing for you. It's busy while something needs you and rests once you're all caught up, and it stays in the island for as long as Floorboard is open, without sounds. While Coucou is open, Floorboard's own bar at the top steps aside so there's one island, and it comes back if Coucou is closed. Floorboard only talks to Coucou on this computer.

- Turn it on or off from the tray icon's menu: **Show Floorboard in Coucou's island**.
- Searching from the island: Coucou's cards can't hold a search box, so Floorboard's card says *Search or ask: 💬 above*. The 💬 at the top of the island is Coucou's chat, which is Ask Floorboard (it finds files, posts, chats, people, meetings and email).
- WhatsApp and Outlook live in Coucou's island. WhatsApp: in Coucou, **Settings… → Integrations → WhatsApp**, **Install WhatsApp**, then scan the code with your phone (WhatsApp › Settings › Linked devices › Link a device). Email: sign in to **Outlook (classic)** and leave it open (the new Outlook can't be reached), and have Coucou show its **Mail** card. Coucou 0.5.9 has no switch for that card yet: close Coucou, add `"integration_mail"` to `"activeIntegrations"` in `%APPDATA%\Coucou\settings.json`, and start Coucou again.
- The island shows four small cards beside the main one: your department's card, Mail and WhatsApp, and one more spot (JARVIS's card, on the computer where JARVIS is linked; see below). Coucou's services are switched on and off in **Settings… → Integrations**: Mail and WhatsApp suit the store; the developer services (Resend, n8n, Vercel, GitHub and the rest) need their own keys and do nothing without them.

**Your department's card.** Beside Floorboard's main card, each person gets one small card for their own work, busy while something wants doing:

| Who | Card | What it says |
|---|---|---|
| Everyone with a task board | **taskboard** (amber) | your tasks this week (how many done); a department head, how far the team is and who's furthest behind; an admin, the whole store and the department furthest behind |
| Finance | **mfs** | what's waiting for approval in MFS, who owes (and how much is late), anything wrong |
| Finance, and anyone who approves | **approvals** | invoices and quotes to approve and to pay, with the amounts |
| Finance | **month-end** | what's late and what's due this week |
| The store manager and admins | **store** | what's overdue and ASAP, and which department is most behind |
| Whoever has the quote drop box | **quotes** | quotes waiting, with a question, or approved |
| Every department | its name (**bakery**, **fruit-veg**…) | the team's open and overdue tasks, and who's gone quiet for 2 days |

Coucou colours a card by its name, from four colours only (green, yellow, blue, pink; its colour settings don't reach these cards), so the task board's card is called **taskboard** to come out amber, the nearest to orange, and JARVIS's comes out pink.

Floorboard picks the best one for you (the task board first; then for Finance MFS and approvals, for the store manager the store, for everyone else their own team). To pick another, or none: the tray icon's menu → **Your department's card in Coucou's island**. A card you pick shows only itself.

Coucou always keeps one main card for a coding app (Claude Code, Cursor, Codex or Antigravity); Floorboard takes that card over while it's open, and it goes back to the coding app when Floorboard closes. If you also run Claude Code with Coucou's hooks installed, both share that card.

MFS (Finance's card): on a computer that can reach the MFS app, open the tray menu → **Your department's card in Coucou's island → Connect MFS…**, enter the MFS address (`http://localhost:8787` on the MFS computer itself) and the MFS app's Jarvis key (`JARVIS_KEY` in its `.env`; `pnpm jarvis:setup` sets one up). The key stays on that computer, locked with Windows' own encryption. MFS answers its Jarvis questions only on its own computer or network, and only reading: nothing in MFS changes. Until MFS is connected, Finance gets the approvals card.

### JARVIS (Windows, one account)

On a computer that also runs JARVIS (JARVIS Armor Workspace), Floorboard can follow JARVIS's Tower and send it work, for one Floorboard account only. The first time an admin signs in there, the sidebar offers **JARVIS is on this computer → Link**; after that only that account sees anything of JARVIS, in the sidebar, the island or the chat, and nobody else's account can link it. Everything goes between Floorboard and JARVIS on that computer: nothing of JARVIS's goes to the store's server.

- **Its own card in Coucou's island (jarvis).** What the Tower is working on and how far it is (`2 working · Corner Café menu boards 40%`), what needs you, or what it last finished. It's busy while JARVIS works or something needs you, and then goes through what the sidebar's JARVIS card shows, a few seconds each: each thing that needs you with what it says, each job running with how far it is, the Tower, the morning brief, then the summary (Coucou shows a card's last two lines, so each thing is its name, then what it says). It says *Closed · open JARVIS* while JARVIS is closed. Coucou names cards in small letters, so it reads **jarvis**, in pink.
- **Pop-ups.** A Windows notification when a job is done, failed, stopped at its budget, or needs a brief or your changes, and when the morning brief is in. Clicking one opens JARVIS in the sidebar. The newest one also shows on the island card.
- **In the sidebar.** The JARVIS card: what needs you, each job with its floor, progress and the step it's on, **Continue where it stopped** for a stopped job (JARVIS may ask you to approve the cost first), and the morning brief.
- **Send work.** Drop the artwork (images, PDFs or design files, up to 20 at 20 MB each, from File Explorer or the desktop), pick the suit and the client (the suit's client folders), the floor (Client Marketing & Web by default) and say what to do with it; **More for the brief** adds what it's for, who it's for, musts and what finished means. **Check with JARVIS** shows what JARVIS will do (where it files the artwork, the floor, what it may cost); nothing starts until **Start it**. JARVIS copies the files into the client's folder itself, and anything that costs money still goes through JARVIS's own approval.
- **Ask it in Coucou's chat.** Pick the **jarvis** model in Coucou's chat (beside **floorboard**), or start a question to Floorboard with "JARVIS": *how far is the menu boards?*, *what needs me?*, *morning brief*, *what are you working on?*, *continue the flyer* (then *yes*). It answers from JARVIS's own records, on that computer.
- The tray icon's menu → **JARVIS** turns the island card and the pop-ups on or off.

JARVIS has to be open for its work to run and for the card to move: night shifts (floor 31 on Monday mornings) start only while it's open, and the morning brief comes the first time JARVIS is opened that day, so its pop-up comes then. Nothing is ever posted by JARVIS or Floorboard: you approve and post yourself.

It needs JARVIS 1.107 or later, which tells programs on the same computer where its control deck is listening (a new key each time JARVIS starts, in a file only that Windows user can read). Until then the card says JARVIS isn't connected.

### Keeping it up to date (Windows)

The first time, the sidebar asks whether Floorboard may check GitHub for new versions. If you say yes, it looks when it starts and every few hours. When there's a newer version, the sidebar shows **A new version of Floorboard is ready** with **Update now**: one click and it updates, restarts and keeps your settings and logins. You can switch the checking on or off, or check straight away, from the tray icon's menu.

New versions only arrive once they've been pushed to GitHub. A copy with changes that aren't on GitHub yet isn't updated, so nothing is lost.

## Phone: app icon on your home screen

The `floorboard-app` folder is an installable web app (a PWA). For a phone to install it, the folder has to be online over https (for example on GitHub Pages or Netlify). Then:

- **iPhone:** open the link in Safari → Share → Add to Home Screen.
- **Android:** open the link in Chrome → ⋮ → Install app. Long-press the icon for a shortcut to the "Needs you" sidebar view.

Add `#widget` to the end of the link to open the compact sidebar view.

The **Get it on your phone** QR code opens the full app. Choose **Sidebar view** under the code for a phone that should open the compact sidebar view from its home-screen icon instead (the ↗ at its top opens the full app). On a phone, **Open Floorboard like this from my home screen** at the bottom of the sidebar view changes it.

## Phone: a home-screen widget (the Floorboard app)

A web app can't put a widget on a phone's home screen, so `mobile/` is a small iPhone and Android app whose main job is the widget. It shows the signed-in person's **Needs you** count (ASAP, Important, General), the top 3 things waiting on them, and today's **My week** list with ticks: everyday tasks, that day's tasks, tasks other people sent, and month-end jobs. It comes in small, medium and large. It refreshes by itself about every 15 minutes on iPhone and every 30 on Android, and straight away when you leave the app. Tapping a row opens that post or page.

The app itself is the full web app (the live link above) with a sign-in screen in front: store code, pick your name, PIN, the same as the web app. Changes to the web app reach it with no new build. Keep using the home-screen web app for alerts when Floorboard is closed and for Outlook email, because they don't work inside the app.

### What it costs and what to sign up for

| | Cost | Needed for |
|---|---|---|
| **Expo** account (expo.dev) | Free | Building the app in the cloud. You don't need a Mac. The free plan's monthly builds are plenty. |
| **Apple Developer Program** (developer.apple.com/programs) | US$99 a year | Any iPhone install, through TestFlight. Sign up with an Apple ID that has two-factor on. Approval can take a day or two. As an individual, Apple checks your ID. As a company, it asks for a D-U-N-S number. |
| **Google Play Console** (play.google.com/console) | US$25 once | Optional. Without it you share an APK file, which phones install directly. Google is starting to ask for registered developers even for APKs, country by country. If phones ever refuse the APK, use Play's internal testing. |

### Build it (on this Windows computer)

1. Make a free account at expo.dev. Then, in a terminal in the `mobile` folder, run:

   ```bash
   npm install
   ```

   ```bash
   npx eas-cli@latest login
   ```

   ```bash
   npx eas-cli@latest init
   ```

   `init` links the folder to your Expo account and writes a `projectId` into `app.json`. Commit that change.

2. **Android:** run the following, then open the link it prints on each phone and allow installing from that app. Staff can also scan the QR code on the build's page at expo.dev.

   ```bash
   npx eas-cli@latest build -p android --profile apk
   ```

3. **iPhone:** once Apple has accepted you, put your Team ID (developer.apple.com → Account → Membership) into `mobile/app.json` as `"appleTeamId"` under `"ios"`. Then build and send the build to TestFlight:

   ```bash
   npx eas-cli@latest build -p ios --profile production
   ```

   ```bash
   npx eas-cli@latest submit -p ios --latest
   ```

   The first build asks you to sign in to Apple. It then sets up the certificates, the app and widget IDs and the shared App Group by itself. After about 15 minutes the build appears in App Store Connect under TestFlight. Add staff there as testers. They install Apple's **TestFlight** app and accept the invite. Testers you add by email (not part of your App Store Connect team) need Apple's short beta review first.

To check the iPhone project compiles before paying for Apple, `npx eas-cli@latest build -p ios --profile simulator` builds a simulator copy. You can't install it on a phone, and it only runs on a Mac.

### On each phone

Open Floorboard and sign in. Then add the widget:

- **iPhone:** touch and hold the home screen → **Edit** → **Add Widget** → **Floorboard** → choose a size.
- **Android:** touch and hold the home screen → **Widgets** → **Floorboard**. Drag its edges to make it bigger: wider shows the top 3, taller adds today's list.

Logging out of the web app inside the app logs the widget out too.

### Changing the widget

`mobile/src/snapshot.js` works out what the widget shows, the same way `source/floorboard.html` does (`needsMe`, `dayList`, `taggedFor`, `deadlinesFor`). Change both together. The iPhone widget runs a copy of that file. After changing it, run `npm run embed` in `mobile/` to refresh `targets/widget/SnapshotSource.swift`, and `npm test` to check it. A change in `mobile/` needs a new build (steps 2 and 3). Changes to the web app don't.

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

**See what they see:** in People & access, an admin can click **See what they see** next to anyone to look at Floorboard the way that person sees it, desktop sidebar included, without their PIN. It's look only: nothing can be changed or sent, and their sticky notes and the chats the admin isn't in stay private. **Back to me** returns to your own view.

## Alerts when the app is closed, and on shift / off shift

Once, after the steps above:

1. **SQL Editor → New query**: paste all of `supabase/push.sql` and click **Run**.
2. **Edge Functions → Deploy a new function → Via editor**: name it `notify`, paste all of `supabase/functions/notify/index.ts`, and deploy. In the function's settings, switch **Verify JWT** off (the function checks who is calling itself).
3. **Edge Functions → Secrets**: add `VAPID_PRIVATE_KEY` with the private key that matches `vapidPublicKey` in `config.js`. Keep the private key out of this repository.

Then each person taps the bell → **Get alerts when Floorboard is closed** on their phone. On an iPhone, Floorboard has to be added to the home screen from Safari first. The Windows sidebar alerts from the tray instead. Nobody gets phone alerts while they're off shift.

## Files: my own files and the department archive

**Files** is in the bottom bar for everyone. It shows folders:

- In the Windows sidebar (and the phone's sidebar view) a **Files** card shows the same folders, small: click one to open it in the full app, or **+** to add files right there.
- **My files**: each person's own files. Add a file (or take a photo on a phone), give it a title, and it's kept. Only that person can see them; an admin's **See what they see** doesn't show them either. Click a file to open it, rename it, save a copy or delete it.
- **Your own folders**: **New folder** makes a folder with any name you like (Payslips, Certificates…). Add files straight into it, rename it, or delete it (its files go back to My files). Opening a file lets you move it between My files and your folders. Only you see your folders.
- **Department archive**: one for each department you're in (admins too: only their own). Everything filed for that department. It's the same files as that department's **Drive**, so nothing is filed twice. Anyone in the department can add files, with a title and, if you like, one of the Drive's folders. A paper record shows where the paper copy is kept.

It's on for every department. To hide it for a department, switch off **My files & archive** under the department in **People & access**.

On the live store, run `supabase/setup.sql` once more (SQL Editor → New query → paste → Run; it's safe to run again). That makes personal files private on the server too: only their owner can open them. Until you do, Files still works.

### Sort my files

**Sort my files** (on the Files page, or **Sort these** inside My files) puts every loose file into the right folder: invoices, quotes, credit notes, delivery notes, orders, statements, receipts, payslips, contracts, certificates, forms, policies and SOPs, price lists, reports, and photos, videos and voice notes. It uses your own folders where they fit (your Payslips folder, say) and makes new ones only where needed. Exact copies of the same file go in **Duplicates**; nothing is deleted.

It goes by what each file says: the words inside PDFs and text files, and its title and file name. You see the plan first (the files fly from the pile into their folders), can move any file to another folder, then click **Put them in folders**. **Undo** puts everything back. Admins and a department's managers can sort that department's archive the same way, into its Drive folders.

To have the store's AI read the files too (photos of paperwork, scans with no text, and clearer titles for files named like "Scan_0012"), set up the sort-files function once, the same way as meeting notes:

1. **Edge Functions → Deploy a new function → Via editor**: name it `sort-files`, paste all of `supabase/functions/sort-files/index.ts`, and deploy. In its settings, switch **Verify JWT** off.
2. It uses the same `ANTHROPIC_API_KEY` secret as meeting notes. Sorting a batch of documents costs a few cents.
3. If Supabase kept a random name for it (functions can't be renamed), put that name in `config.js` as `sortFunction` instead of deploying again.

Without it, sorting still works, by the words in and on the files.

## Ask Floorboard

**Ask Floorboard** (in the sidebar under the board, at the top of the full app's side column, and the ✦ on the slim rail) answers questions in plain words:

- "Find the last Highveld invoice", "Where's my October payslip?" (your files, your folders and your department's archive, including the words inside PDFs kept on this device)
- "How far is the bakery with its tasks?", "Who hasn't touched the waste sheets?" (each person's progress, what's overdue and who's been quiet for 2 days)
- "What needs me today?", "Any meetings tomorrow?", "What did Johan say about the fridge?"
- "Any emails from SunPack this week?" (Outlook: your Microsoft 365 mailbox if it's connected, or Outlook (classic) open on the Windows computer)

It only sees what you can see in Floorboard. The looking up happens on your own device; Claude (Anthropic) gets your question and what was found, and writes the answer. Set it up once:

1. **Edge Functions → Deploy a new function → Via editor**: name it `ask`, paste all of `supabase/functions/ask/index.ts`, and deploy. In its settings, switch **Verify JWT** off.
2. It uses the same `ANTHROPIC_API_KEY` secret as meeting notes. It runs on Claude Opus 5.5, so each question costs a little; to make it cheaper, change `MODEL` at the top of the function to `claude-haiku-5-5`.

Until it's set up (and with no signal), Ask Floorboard still gives a quick answer by keyword from the same look-ups, and says so under the answer.

**In Coucou's chat (Windows).** The Windows app also answers Coucou's chat, so you can ask from the island at the top of the screen: in Coucou, **Settings… → Chat → Local models → OpenAI-compatible**, enter `http://127.0.0.1:47831`, click **Connect**, then **Use in chat**. Ask in the island's 💬 tab (or Ctrl+Alt+Space); Floorboard's blue card shows what it's looking up while it works. Only programs on this computer can reach that address, and Floorboard has to be open and signed in.

## Works with no signal

Floorboard keeps a copy of itself and of the store on each device, so it keeps working with no connection:

- The whole app, the PDF reader and the fonts are saved on the device the first time it opens with a signal. On a slow signal it opens from that copy after a few seconds instead of waiting.
- Everything stays usable offline: chats, tasks, notes, Files. Changes, and files you add, wait on the device (even if the app is closed) and send by themselves when the signal is back. The top bar shows **Offline** until then, and **● Live** once everything is sent.
- Files open with no signal once they're on the device. While there's a signal, each person's own files, their department archives, and the last two weeks of photos and files in their chats are brought onto the device in the background (files up to 25 MB). Anything else downloads the first time it's opened. The file shows **On this device** when it's ready.
- Logging out with changes that haven't been sent yet asks first, because they'd be lost. Logging out also clears the store's data and files from that device.

## Month end (Finance)

Switch it on in **People & access**: under Finance, turn on **Month end**. A **Month end** page then appears in the menu for Finance, the admins, and anyone with a deadline on it.

- **Paste from Excel**: copy the month-end sheet's rows (the date in one column, the job in the next) and paste them. A name on its own line, like a person's name or two names joined with `&`, starts a new list and picks those people. On a shared list, a job that names one person goes to just them. `Every Thursday` and `Everyday` repeat.
- **Reminders** arrive as ordinary tasks (in Needs you, and on phones with alerts on), the day before by default. If one is missed, whoever set it gets told. The live store sends them from 07:00, as soon as anyone in the store has Floorboard open.
- **Ask managers for invoices** sends every manager a task to hand in the month's invoices, so Finance can see who is still outstanding.
- Before pasting a new month, remove last month's lists with the bin on each list (**By list** view).

## Petrol & expense slips

The Finance team sends its petrol slips (or parking and tolls, or anything else they paid for the store) to the team that handles claims: the **Petrol & expense slips** card in the sidebar → **Send a slip**. The card shows only for people in a department named Finance (or Accounts), not for admins.

- Take a photo of the slip (on a phone it opens the camera) or pick a PDF, then the amount and the date. For petrol, also the garage, litres, odometer and vehicle (the vehicle is remembered for next time), and what it was for.
- **Send** prints the claim as a receipt that tears off and goes to the team. It arrives there as an **expense claim** for that department's head to approve, with the photo, and goes on through **Approvals** like any other: approve, query, mark paid. The person hears when it's approved and paid, and the card shows how their last slip is getting on.
- Slips go to the department with **Takes expense slips** on in **People & access**: the Admin department unless an admin picks another.

## Task board (weekly tasks per department)

On for every department (an admin can switch it off under the department in **People & access**). Open **Task board** in the menu.

- **Department heads** (whoever manages the department, and admins) set the week's tasks: for the **whole team**, or for **one person**, with a note if needed. **Copy last week's tasks** starts a new week from the last one. A task can be taken off the board.
- **The team** panel shows how far each person is this week (their tasks averaged), how many they've finished, and who hasn't moved a task for 2 days. Each task shows everyone's progress and their notes.
- **Everyone** sees their own tasks for the week, in the sidebar's **This week** card and on the Task board: drag the slider as they go, or press **Done**, and add a note on how it's going. Each person's progress is saved on its own, so two people updating at once never clash.
- Move between weeks with the arrows; each week (Monday to Sunday) keeps its own board.
- Ask Floorboard knows the board too: "how far is the bakery this week?".

## My week (daily tasks)

Switch it on in **People & access**: under the department, turn on **My week**. It replaces a weekly Excel task sheet: a column for each day with Done, Time and Reason.

- **Everyday tasks** (like reading email or the bank recons) fill in every day you pick by themselves. Taking one off keeps it on the days already gone.
- Add each day's other jobs in its column, or paste a list from Excel. Click a task to note the time or the reason it's late, move it to the next day, or take it off.
- Tasks other people send you appear on their due day (today, if they have no date or are late), with who sent them. Ticking one there marks it done for the sender too; clicking it opens the task.
- Your **Month end** deadlines show on their days too (marked "Month end"), so a new month's sheet pasted on the Month end page fills everyone's weeks. Ticking one there ticks it on the Month end page.
- Today's list is in the sidebar and on Needs you. Managers (and admins) can open their team's weeks, set up someone's everyday tasks and add tasks for them; only the person ticks their own.

## OneDrive

Each person can link their own OneDrive: on the **Drive** page, paste the address from OneDrive in the browser, or an admin adds it under the person in People & access. Drive then has **Open OneDrive** at the top. The files stay in OneDrive.

## Outlook email

Each person can see their own work email in Floorboard: their Outlook folders (with the inbox's own folders first, where Outlook rules file things, like a folder per person) and who emailed them, in the sidebar and on the **Outlook** page. On any email: **Open in Outlook**, **Add to my day**, **Task for someone**, or **Send for payment** (with the email's attachments).

Nothing from a mailbox is kept in Floorboard: it's read live from Microsoft on the person's own device, with their own sign-in. The website signs in with Microsoft's sign-in library; the desktop app signs in through the browser and keeps the sign-in encrypted for that Windows user. Logging out of Floorboard disconnects Outlook on that device.

Set it up once, in your company's Microsoft 365:

1. At **entra.microsoft.com**, sign in with a work account: **Identity → Applications → App registrations → New registration**. Name it `Floorboard`, choose *Accounts in this organizational directory only*, and add the redirect URI as **Single-page application (SPA)**: the web address of the app (for example `https://you.github.io/floorboard/`). Register.
2. **Authentication → Add a platform → Mobile and desktop applications**: add `http://localhost` (for the desktop sidebar).
3. **API permissions → Add a permission → Microsoft Graph → Delegated**: tick **Mail.Read**. An admin can click **Grant admin consent** so nobody is asked.
4. Copy the **Application (client) ID** and **Directory (tenant) ID** into `config.js` as `msClientId` and `msTenantId`.
5. In **People & access**, turn on **Outlook email** for the departments that want it.

## Approvals (Finance)

Switch it on in **People & access**: under Finance, turn on **Approvals**. Anyone can then pick **Approval** as the kind of post: what it is (quote, invoice, payment, expense claim), the supplier, the amount, the invoice number, a photo or PDF of it, and who approves it (any one of them, or all of them).

- Approvers get it in Needs you and on their phones, and choose **Approve** (they sign on screen, and can keep their signature for next time), **Don't approve** (with a reason) or **Query**. A query goes back to whoever asked for approval until they answer it.
- The **Approvals** page shows what's waiting, what's approved, what's paid and what wasn't approved, with rand totals. Finance and the admins see everything there and **Mark paid**, with the payment reference if they like. The person who asked hears when it's paid or not approved.
- Every decision keeps who made it, when, and the signature, so "who approved this?" is answered on the post itself.
- **Posted in a group chat:** when someone posts a document with words like quote, invoice or please pay, Floorboard asks them "Is this for payment?". **Send for payment** turns it into an approval with the file, supplier, number and amount filled in, addressed to Finance, and the chat shows it was sent. Finance sees anything nobody sent under **Posted in chats** on the Approvals page, and on their My week, next to what's approved and still **to pay**. Direct messages are left alone.
- Redeploy the `notify` function (step 2 of the alerts setup) to get phone alerts that say "Paid · your invoice" instead of a general heading. Everything works without it.

## Quote drop box (Admin)

Switch it on in **People & access**: under Admin (or whichever department handles new business), turn on **Quote drop box**, and turn on **Drive** there too so signed copies have somewhere to go.

- Under the department, **Drop box for** gives the drop box to one person only (otherwise everyone in the department has it), and **Quotes go to** sends every quote to one approver, for example the owner, with no choosing.
- Drag quotes straight from Outlook (or the desktop) onto **Drop quotes here** in the sidebar, or click it to pick files. If **Quotes go to** isn't set, choose once who approves them.
- Each quote needs a short note saying what it is. The approver sees that note first, on the card, in the sidebar and in the alert.
- PDFs are read when they're dropped: the supplier, number, date, total, VAT, the main lines and how long it's valid show as a **Quick look**, so the approver knows what they're signing without opening it. Scans (photos of paper) have no text to read.
- Once it's approved and signed, a signed PDF (a cover page with the signature and the note, then the quote) is saved in the department's Drive under **Signed quotes**. No printing, signing on paper or scanning back in.
- **Printing**, if paper is still wanted: every approval has **Print with slip**. In the desktop app the drop box can also print each quote by itself, as it's sent or once it's approved, on the printer chosen on that computer.
- In the desktop sidebar, the **pin** at the top keeps Floorboard in front of Outlook while dragging.
- **Writing on the document**: on the approval, **Open and write on it** shows the quote's pages full screen. Write, sign or circle things with an iPad pen (or a finger or mouse), in four colours, fine or thick, with an eraser and undo. Once a pen is used, fingers only scroll. Marks save as you go, and appear on the signed copy and print-outs. When approving, **I signed on the document itself** uses that signature instead of a separate one.

## Calendar

Everyone has a **Calendar** in the menu. Plan meetings in your own diary or in someone else's (an assistant can keep the manager's diary): the day, time, how long, where, who from the store, people from outside, an agenda, and whether it repeats every week or month.

- The diary's owner, whoever planned it and the people in it all see it. **Let them know** sends them a heads-up on their board and phone.
- A reminder pops up before each meeting (15 minutes before unless you choose otherwise) on any device with Floorboard open. The sidebar shows the next meeting, and the start-of-shift summary lists the day's meetings.
- **Upcoming** shows the next 30 days with tasks and month-end dates in between; **Month** is the month at a glance; **Past** keeps track of what happened. Open a meeting to write what was agreed and the follow-ups, mark it done, or cancel one.

### Recording a meeting

Open a meeting and tap **Record the meeting**. After ticking that everyone knows it's being recorded, Floorboard asks to use the microphone (choose **Allow**) and writes down what's said as it's said, in Chrome, Edge, or Safari on an iPad or iPhone. The desktop app can't hear speech, so there the button is **Record in your browser**: it opens that meeting's recorder in Chrome or Edge (sign in there once). **Paste a transcript instead** takes one from Teams, Zoom or a recording app. Then Claude writes the notes, what was decided, the tasks (with who and when) and anything that needs approving. Nothing is sent until it's been checked: tick the tasks and approvals to send, then **Save to the meeting**.

Set it up once for the live store:

1. At [console.anthropic.com](https://console.anthropic.com), sign in, add credit under **Billing**, then **API keys → Create key** and copy it.
2. In Supabase, **Edge Functions → Secrets**: add `ANTHROPIC_API_KEY` with that key.
3. **Edge Functions → Deploy a new function → Via editor**: name it `meeting-notes`, paste all of `supabase/functions/meeting-notes/index.ts`, deploy, and in its settings switch **Verify JWT** off (the function checks who is calling itself).

It uses Claude Opus 5.5; an hour-long meeting costs roughly a few rand. The speech is written down by the browser's own speech service (Google for Chrome, Microsoft for Edge, Apple for Safari). Without the setup, the app makes simple notes on the device instead.

Approvers and the people who asked can also answer with a **voice note** (Query, Don't approve, Approve, and answering a query), and the drop box takes **photos or videos** with each quote.

## Still to come

- Real home-screen widgets (the live tiles on an iPhone or Android home screen) need a native app built on top of the server.
