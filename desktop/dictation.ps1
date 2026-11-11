# Floorboard's meeting recorder: writes down what the microphone hears, with Windows' own speech recognition
# (Windows.Media.SpeechRecognition dictation; it needs Settings > Privacy & security > Speech > Online speech recognition
# switched on). It listens one stretch of speech at a time, over and over, until Floorboard ends this process.
# One JSON line per thing heard: {"t":"text","text":"...","at":ms}; {"t":"ready"} once listening; {"t":"error","why":"..."}.
$ErrorActionPreference = 'Stop'
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
  $opTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  function AwaitOp($op, [Type]$type) { $t = $opTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }

  $r = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer   # free dictation is its default
  $res = AwaitOp ($r.CompileConstraintsAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult])
  if ($res.Status -ne [Windows.Media.SpeechRecognition.SpeechRecognitionResultStatus]::Success) { Say @{ t = 'error'; why = [string]$res.Status }; exit 1 }
  $r.Timeouts.InitialSilenceTimeout = [TimeSpan]::FromSeconds(60)
  $r.Timeouts.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(1200)
  Say @{ t = 'ready' }
  $fails = 0
  while ($true) {
    try {
      $out = AwaitOp ($r.RecognizeAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionResult])
      $fails = 0
      $text = [string]$out.Text
      if ($text) { Say @{ t = 'text'; text = $text; at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() } }
    } catch {
      $m = $_.Exception.InnerException; if (-not $m) { $m = $_.Exception }; $m = [string]$m.Message
      if ($m -match '0x80045509|privacy policy') { Say @{ t = 'error'; why = 'privacy' }; exit 1 }
      $fails++
      if ($fails -gt 20) { Say @{ t = 'error'; why = $m }; exit 1 }
      Start-Sleep -Milliseconds 500
    }
  }
} catch {
  $m = [string]$_.Exception.Message
  if ($m -match '0x80045509|privacy policy') { $m = 'privacy' }
  Say @{ t = 'error'; why = $m }
  exit 1
}
