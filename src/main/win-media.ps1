param([int]$ParentId = 0, [int]$Interval = 4)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  function Wait-Op($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait(3000)) { return $null }
    return $task.Result
  }
  $mgr = Wait-Op ($mgrType::RequestAsync()) $mgrType
  if (-not $mgr) { throw 'no manager' }
} catch {
  [Console]::Out.WriteLine('{"error":"unavailable"}')
  [Console]::Out.Flush()
  exit 1
}
while ($true) {
  if ($ParentId -gt 0 -and -not (Get-Process -Id $ParentId -ErrorAction SilentlyContinue)) { exit 0 }
  $list = New-Object System.Collections.ArrayList
  try {
    foreach ($s in $mgr.GetSessions()) {
      $info = $s.GetPlaybackInfo()
      $status = [int]$info.PlaybackStatus
      $item = [ordered]@{ app = [string]$s.SourceAppUserModelId; playing = ($status -eq 4); type = [int]$info.PlaybackType; title = ''; artist = ''; album = '' }
      if ($status -eq 4) {
        $p = Wait-Op ($s.TryGetMediaPropertiesAsync()) $propsType
        if ($p) {
          $item.title = [string]$p.Title
          $item.artist = [string]$p.Artist
          $item.album = [string]$p.AlbumTitle
        }
      }
      [void]$list.Add([pscustomobject]$item)
    }
    $json = ConvertTo-Json -Compress -Depth 3 -InputObject @($list.ToArray())
  } catch {
    $json = '{"error":"read"}'
  }
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
  Start-Sleep -Seconds $Interval
}
