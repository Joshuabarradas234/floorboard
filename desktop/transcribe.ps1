# Floorboard's meeting recorder: writes down what's said in a recording, after the meeting, with Windows' own speech engine
# (System.Speech dictation, on this computer; nothing is sent anywhere). Floorboard hands it the meeting's sound as a
# 16 kHz mono WAV file. One JSON line per stretch of speech: {"t":"text","text":"...","at":seconds}, then {"t":"done"};
# {"t":"error","why":"..."} if it can't.
param([Parameter(Mandatory = $true)][string]$Wav)
$ErrorActionPreference = 'Stop'
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
  Add-Type -AssemblyName System.Speech
  $all = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if (-not $all -or $all.Count -eq 0) { Say @{ t = 'error'; why = 'no speech engine installed' }; exit 1 }
  # Windows' own language first, then any English one, then whatever there is
  $info = ($all | Where-Object { $_.Culture.Name -eq (Get-UICulture).Name } | Select-Object -First 1)
  if (-not $info) { $info = ($all | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq 'en' } | Select-Object -First 1) }
  if (-not $info) { $info = $all[0] }
  $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
  $r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $r.SetInputToWaveFile($Wav)
  $r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(30)
  $r.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(600)
  $r.BabbleTimeout = [TimeSpan]::Zero
  $stuck = 0; $last = -1
  while ($true) {
    $res = $null
    try { $res = $r.Recognize() } catch { break } # the end of the file
    $pos = $r.RecognizerAudioPosition.TotalSeconds
    if ($null -eq $res) {
      # silence or noise it couldn't make out: carry on until the file has run out
      if ($r.AudioState -eq 'Stopped') { break }
      if ($pos -le $last) { $stuck++; if ($stuck -ge 3) { break } } else { $stuck = 0 }
      $last = $pos
      continue
    }
    $last = $pos; $stuck = 0
    $text = [string]$res.Text
    if ($text) { Say @{ t = 'text'; text = $text; at = [Math]::Round($pos, 1) } }
  }
  Say @{ t = 'done'; engine = [string]$info.Culture.Name }
} catch {
  Say @{ t = 'error'; why = [string]$_.Exception.Message }
  exit 1
}
