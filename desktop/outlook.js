// Outlook (classic) on this computer, for Ask Floorboard's email search. It reads the Outlook that's already open through
// Outlook's own COM objects, the way Coucou's Mail card does: no sign-in and nothing registered at Microsoft, and it never
// starts Outlook. The new Outlook for Windows has no COM objects, so it isn't reached this way. Read only.
const { execFile } = require('child_process');

// The search words and the number of days go in as environment variables, never into the script itself.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try { $o = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { '{"error":"closed"}'; exit }
$words = @(([string]$env:FB_Q).ToLower().Split(' ', [StringSplitOptions]::RemoveEmptyEntries))
$since = (Get-Date).AddDays(-[int]$env:FB_DAYS)
$out = New-Object System.Collections.ArrayList
foreach ($store in $o.GetNamespace('MAPI').Stores) {
  try { $items = $store.GetDefaultFolder(6).Items } catch { continue }
  $items.Sort('[ReceivedTime]', $true)
  $n = 0
  foreach ($m in $items) {
    if (++$n -gt 400 -or $out.Count -ge 15) { break }
    if ($m.Class -ne 43) { continue }
    if ($m.ReceivedTime -lt $since) { break }
    $from = ''; try { $from = [string]$m.SenderEmailAddress } catch {}
    $hay = ([string]$m.Subject + ' ' + [string]$m.SenderName + ' ' + $from).ToLower()
    $hit = $true; foreach ($w in $words) { if (-not $hay.Contains($w)) { $hit = $false; break } }
    if (-not $hit) { continue }
    $body = ''; try { $body = [string]$m.Body; if ($body.Length -gt 400) { $body = $body.Substring(0, 400) } } catch {}
    [void]$out.Add([ordered]@{ subject = [string]$m.Subject; from = [string]$m.SenderName; address = $from; received = $m.ReceivedTime.ToString('s'); unread = [bool]$m.UnRead; attachments = ($m.Attachments.Count -gt 0); account = [string]$store.DisplayName; preview = $body })
  }
}
ConvertTo-Json -InputObject @{ emails = @($out) } -Depth 3 -Compress
`;

function search(query, days) {
  return new Promise((done) => {
    const env = { ...process.env, FB_Q: String(query || '').slice(0, 200), FB_DAYS: String(Math.min(365, Math.max(1, Number(days) || 30))) };
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], { env, windowsHide: true, timeout: 25000, maxBuffer: 1 << 22, encoding: 'utf8' }, (err, out) => {
      const text = String(out || '').trim();
      try {
        const r = JSON.parse(text.slice(text.indexOf('{')));
        if (r.error === 'closed') return done({ error: 'Outlook (classic) isn’t open on this computer. Open it, signed in, and ask again.' });
        return done({ emails: Array.isArray(r.emails) ? r.emails : [] });
      } catch (e) {
        done({ error: err && err.killed ? 'Outlook took too long to answer.' : 'Outlook didn’t answer. If it asked whether to let a program read your mail, allow it and ask again.' });
      }
    });
  });
}

module.exports = { search };
