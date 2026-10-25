param([string]$PythonPath = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stateVoice = Join-Path $root 'state\voice'
$venv = Join-Path $root 'state\voice-runtime'
New-Item -ItemType Directory -Force -Path $stateVoice | Out-Null

function Get-PythonInfo([string]$Executable, [string[]]$Prefix = @()) {
  $pythonArgs = @($Prefix) + @('-c', 'import struct,sys; print("%d.%d %d" % (sys.version_info.major, sys.version_info.minor, struct.calcsize("P")*8))')
  $value = & $Executable @pythonArgs
  if ($LASTEXITCODE -ne 0) { throw 'Unable to execute the selected Python.' }
  return ([string]$value).Trim()
}

if ($PythonPath) {
  if (-not (Test-Path $PythonPath -PathType Leaf)) { throw "Python executable not found: $PythonPath" }
  $info = Get-PythonInfo $PythonPath
  if ($info -ne '3.11 64') { throw "Voice dependencies require Python 3.11 x64; selected Python is $info. The app's bundled Python 3.13 is intentionally not modified." }
  & $PythonPath -m venv $venv
} else {
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if (-not $launcher) { throw 'Python 3.11 was not found. Install Python 3.11 x64 with the Python Launcher, then rerun this script, or pass -PythonPath C:\Path\To\Python311\python.exe.' }
  $info = Get-PythonInfo $launcher.Source @('-3.11')
  if ($info -ne '3.11 64') { throw "Python Launcher selected $info instead of Python 3.11 x64." }
  & $launcher.Source -3.11 -m venv $venv
}
if ($LASTEXITCODE -ne 0) { throw 'Failed to create the dedicated voice Python environment.' }
$python = Join-Path $venv 'Scripts\python.exe'
& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Failed to prepare pip for the voice environment.' }
& $python -m pip install --only-binary=:all: -r (Join-Path $PSScriptRoot 'voice-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Voice dependencies failed to install. Existing WeChatAgent and reader Python environments were not modified.' }
& $python -c 'import pilk, edge_tts, imageio_ffmpeg; print("voice-dependencies-ok")'
if ($LASTEXITCODE -ne 0) { throw 'Voice dependency self-check failed.' }
$record = @{ version = 1; pythonPath = $python; pythonVersion = '3.11'; installedAt = (Get-Date).ToUniversalTime().ToString('o') }
$temp = Join-Path $stateVoice 'python.json.tmp'
$record | ConvertTo-Json | Set-Content -Path $temp -Encoding UTF8
Move-Item -Force $temp (Join-Path $stateVoice 'python.json')
Write-Output 'Voice Python environment ready. Restart DSH and WeChatAgent before testing speech recognition.'
