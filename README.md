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

**See what they see:** in People & access, an admin can click **See what they see** next to anyone to look at Floorboard the way that person sees it, desktop sidebar included, without their PIN. It's look only: nothing can be changed or sent, and their sticky notes and the chats the admin isn't in stay private. **Back to me** returns to your own view.

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

## Approvals (Finance)

Switch it on in **People & access**: under Finance, turn on **Approvals**. Anyone can then pick **Approval** as the kind of post: what it is (quote, invoice, payment, expense claim), the supplier, the amount, the invoice number, a photo or PDF of it, and who approves it (any one of them, or all of them).

- Approvers get it in Needs you and on their phones, and choose **Approve** (they sign on screen, and can keep their signature for next time), **Don't approve** (with a reason) or **Query**. A query goes back to whoever asked for approval until they answer it.
- The **Approvals** page shows what's waiting, what's approved, what's paid and what wasn't approved, with rand totals. Finance and the admins see everything there and **Mark paid**, with the payment reference if they like. The person who asked hears when it's paid or not approved.
- Every decision keeps who made it, when, and the signature, so "who approved this?" is answered on the post itself.
- Redeploy the `notify` function (step 2 of the alerts setup) to get phone alerts that say "Paid · your invoice" instead of a general heading. Everything works without it.

## Quote drop box (Admin)

Switch it on in **People & access**: under Admin (or whichever department handles new business), turn on **Quote drop box**, and turn on **Drive** there too so signed copies have somewhere to go.

- Drag quotes straight from Outlook (or the desktop) onto **Drop quotes here** in the sidebar, or click it to pick files. Choose once who approves them (for example the owner).
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
