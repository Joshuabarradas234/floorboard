// Outlook (classic) on this computer, for Ask Floorboard's email search and the island's Mail card. It reads the Outlook
// that's already open through Outlook's own COM objects: no sign-in and nothing registered at Microsoft, and it never
// starts Outlook by itself (the Mail card has a button for that). The new Outlook for Windows has no COM objects, so it
// isn't reached this way. Read only: nothing is marked, moved or sent.
const { execFile, spawn } = require('child_process');

// Outlook reached, and an item's date: an item still syncing (a new .ost) can have no received date yet, and Outlook's
// "none" is the year 4501, so the date falls back to when it was sent or made, and an item with none is left out.
// Each item is read on its own, so one odd item can't stop the rest.
const HEAD = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try { $o = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { '{"error":"closed"}'; exit }
function DateOf($m) { foreach ($p in 'ReceivedTime', 'SentOn', 'CreationTime') { try { $v = $m.$p; if ($v -and $v.Year -gt 1990 -and $v.Year -lt 4000) { return $v } } catch {} }; return $null }
`;

// The search words, the number of days and how many go in as environment variables, never into the script itself.
const LIST = HEAD + `
$words = @(([string]$env:FB_Q).ToLower().Split(' ', [StringSplitOptions]::RemoveEmptyEntries))
$since = (Get-Date).AddDays(-[int]$env:FB_DAYS)
$max = [int]$env:FB_N
$out = New-Object System.Collections.ArrayList
$unread = 0
$senders = @{}
foreach ($store in $o.GetNamespace('MAPI').Stores) {
  try { $unread += [int]$store.GetDefaultFolder(6).UnReadItemCount } catch {}
  # who the unread ones are from (the first 300 of them)
  if ($env:FB_FROM -eq '1') { try { $k = 0; foreach ($m in $store.GetDefaultFolder(6).Items.Restrict('[UnRead] = True')) { if (++$k -gt 300) { break }; try { $nm = [string]$m.SenderName; if (-not $nm) { $nm = [string]$m.SenderEmailAddress }; if ($nm) { if ($senders.ContainsKey($nm)) { $senders[$nm]++ } else { $senders[$nm] = 1 } } } catch {} } } catch {} }
  try { $items = $store.GetDefaultFolder(6).Items; $items.Sort('[ReceivedTime]', $true) } catch { continue }
  $n = 0
  foreach ($m in $items) {
    if (++$n -gt 400 -or $out.Count -ge $max) { break }
    try {
      if ($m.Class -ne 43) { continue }
      $t = DateOf $m
      if (-not $t) { continue }
      if ($t -lt $since) { continue }
      $from = ''; try { $from = [string]$m.SenderEmailAddress } catch {}
      $hay = ([string]$m.Subject + ' ' + [string]$m.SenderName + ' ' + $from).ToLower()
      $hit = $true; foreach ($w in $words) { if (-not $hay.Contains($w)) { $hit = $false; break } }
      if (-not $hit) { continue }
      $body = ''; try { $body = [string]$m.Body; if ($body.Length -gt [int]$env:FB_CUT) { $body = $body.Substring(0, [int]$env:FB_CUT) } } catch {}
      [void]$out.Add([ordered]@{ id = [string]$m.EntryID; store = [string]$store.StoreID; subject = [string]$m.Subject; from = [string]$m.SenderName; address = $from; received = $t.ToString('s'); unread = [bool]$m.UnRead; attachments = ($m.Attachments.Count -gt 0); account = [string]$store.DisplayName; preview = $body })
    } catch { continue }
  }
}
$by = @($senders.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 8 | ForEach-Object { [ordered]@{ name = [string]$_.Key; n = [int]$_.Value } })
ConvertTo-Json -InputObject @{ emails = @($out); unread = $unread; from = $by } -Depth 3 -Compress
`;

const READ = HEAD + `
try { $m = $o.GetNamespace('MAPI').GetItemFromID([string]$env:FB_ID, [string]$env:FB_STORE) } catch { '{"error":"gone"}'; exit }
$t = DateOf $m
$from = ''; try { $from = [string]$m.SenderEmailAddress } catch {}
$body = ''; try { $body = [string]$m.Body; if ($body.Length -gt 20000) { $body = $body.Substring(0, 20000) } } catch {}
$files = @(); try { foreach ($a in $m.Attachments) { $files += [string]$a.FileName } } catch {}
ConvertTo-Json -InputObject ([ordered]@{ subject = [string]$m.Subject; from = [string]$m.SenderName; address = $from; to = [string]$m.To; received = $(if ($t) { $t.ToString('s') } else { '' }); body = $body; files = $files }) -Depth 3 -Compress
`;

function run(script, env, done) {
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { env: { ...process.env, ...env }, windowsHide: true, timeout: 25000, maxBuffer: 1 << 23, encoding: 'utf8' }, (err, out) => {
    const text = String(out || '').trim();
    try {
      const r = JSON.parse(text.slice(text.indexOf('{')));
      if (r.error === 'closed') return done({ error: 'Outlook (classic) isn’t open on this computer.', closed: true });
      if (r.error === 'gone') return done({ error: 'That email isn’t in Outlook any more.' });
      return done(r);
    } catch (e) {
      done({ error: err && err.killed ? 'Outlook took too long to answer.' : 'Outlook didn’t answer. If it asked whether to let a program read your mail, allow it and try again.' });
    }
  });
}

// for Ask Floorboard: emails matching the words in the last few days
function search(query, days) {
  return new Promise((done) => run(LIST, { FB_Q: String(query || '').slice(0, 200), FB_DAYS: String(Math.min(365, Math.max(1, Number(days) || 30))), FB_N: '15', FB_CUT: '400' },
    (r) => done(r.error ? { error: r.error === 'Outlook (classic) isn’t open on this computer.' ? 'Outlook (classic) isn’t open on this computer. Open it, signed in, and ask again.' : r.error } : { emails: Array.isArray(r.emails) ? r.emails : [] })));
}

// for the Mail card: the newest emails in the inbox (or those matching the words), newest first
function list(query, n) {
  return new Promise((done) => run(LIST, { FB_Q: String(query || '').slice(0, 200), FB_DAYS: '90', FB_N: String(Math.min(60, Math.max(1, Number(n) || 30))), FB_CUT: '160', FB_FROM: query ? '0' : '1' }, (r) => {
    if (r.error) return done(r);
    // unread: Outlook's own count for the inbox (every account in it)
    const from = (Array.isArray(r.from) ? r.from : r.from ? [r.from] : []).map((x) => ({ name: String((x && x.name) || '').slice(0, 60), n: Number(x && x.n) || 0 })).filter((x) => x.name && x.n);
    done({ emails: (Array.isArray(r.emails) ? r.emails : []).sort((a, b) => String(b.received).localeCompare(String(a.received))), unread: Number(r.unread) || 0, from });
  }));
}

// one email, to read in the Mail card
function read(id, store) {
  if (!/^[0-9A-F]{16,}$/i.test(String(id || '')) || !/^[0-9A-F]{16,}$/i.test(String(store || ''))) return Promise.resolve({ error: 'That isn’t an email Floorboard knows.' });
  return new Promise((done) => run(READ, { FB_ID: String(id), FB_STORE: String(store) }, done));
}

// Outlook (classic), started minimised, for the person who pressed the Mail card's button
function openOutlook() {
  try { spawn('cmd.exe', ['/c', 'start', '""', '/min', 'outlook.exe'], { windowsHide: true, detached: true, stdio: 'ignore' }).unref(); return { ok: true }; }
  catch (e) { return { error: 'Outlook (classic) couldn’t be started.' }; }
}

module.exports = { search, list, read, openOutlook };
