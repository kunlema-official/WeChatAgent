param([string]$PythonPath = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stateVoice = Join-Path $root 'state\voice'
$venv = Join-Path $root 'state\voice-runtime'
New-Item -ItemType Directory -Force -Path $stateVoice | Out-Null

function Get-PythonInfo([string]$Executable, [string[]]$Prefix = @()) {
  $pythonArgs = @($Prefix) + @('-c', 'import struct,sys; print(str(sys.version_info.major)+chr(46)+str(sys.version_info.minor),struct.calcsize(chr(80))*8)')
  $value = & $Executable @pythonArgs
  if ($LASTEXITCODE -ne 0) { throw 'Unable to execute the selected Python.' }
  return ([string]$value).Trim()
}

# Installed preview builds ship a portable Python 3.11 runtime so users do not
# need to install Python or any development components on Windows.
$distributionFile = Join-Path $root 'config\distribution.json'
if (-not $PythonPath -and (Test-Path -LiteralPath $distributionFile)) {
  $distribution = Get-Content -LiteralPath $distributionFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($distribution.dataHome -and $distribution.version -and $distribution.runtimeRevision) {
    $runtimeName = [string]$distribution.version + '-' + [string]$distribution.runtimeRevision
    $runtimeRoot = Join-Path (Join-Path $distribution.dataHome 'runtimes') $runtimeName
    $bundledPython = Join-Path $runtimeRoot 'voice-python\python.exe'
    if (Test-Path -LiteralPath $bundledPython) {
      $info = Get-PythonInfo $bundledPython
      if ($info -ne '3.11 64') { throw ('Bundled voice Python must be 3.11 x64; found ' + $info) }
      & $bundledPython -B -c 'import pilk,edge_tts,imageio_ffmpeg; print(1)'
      if ($LASTEXITCODE -ne 0) { throw 'Bundled voice runtime failed its dependency self-check.' }
      $record = @{ version = 1; pythonPath = $bundledPython; pythonVersion = '3.11'; mode = 'bundled'; installedAt = (Get-Date).ToUniversalTime().ToString('o') }
      $temp = Join-Path $stateVoice 'python.json.tmp'
      $record | ConvertTo-Json | Set-Content -Path $temp -Encoding UTF8
      Move-Item -Force $temp (Join-Path $stateVoice 'python.json')
      Write-Output 'Bundled voice Python runtime ready. No system Python installation was required.'
      exit 0
    }
  }
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
& $python -c 'import pilk,edge_tts,imageio_ffmpeg; print(1)'
if ($LASTEXITCODE -ne 0) { throw 'Voice dependency self-check failed.' }
$record = @{ version = 1; pythonPath = $python; pythonVersion = '3.11'; installedAt = (Get-Date).ToUniversalTime().ToString('o') }
$temp = Join-Path $stateVoice 'python.json.tmp'
$record | ConvertTo-Json | Set-Content -Path $temp -Encoding UTF8
Move-Item -Force $temp (Join-Path $stateVoice 'python.json')
Write-Output 'Voice Python environment ready. Restart DSH and WeChatAgent before testing speech recognition.'
