$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $root 'state\installer-cache'
$runtime = Join-Path $root 'state\installer-stage\runtime\voice-python'
$archive = Join-Path $cache 'python-3.11.9-embeddable-amd64.zip'
$sourceUrl = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embeddable-amd64.zip'
$sourceSha256 = '33b448f95fecb7c6f802157dbd5e6b40a2ad9bfc8b95ca634a06ba4073ad1ac0'
New-Item -ItemType Directory -Force -Path $cache | Out-Null

function Get-Sha256([string]$File) {
  return (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
}

if (-not (Test-Path -LiteralPath $archive) -or (Get-Sha256 $archive) -ne $sourceSha256) {
  $download = $archive + '.download'
  Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
  Invoke-WebRequest -Uri $sourceUrl -OutFile $download
  if ((Get-Sha256 $download) -ne $sourceSha256) {
    Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
    throw 'Python embeddable archive SHA-256 mismatch.'
  }
  Move-Item -LiteralPath $download -Destination $archive -Force
}

if (Test-Path -LiteralPath $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
$embeddedPython = Join-Path $runtime 'python.exe'
$pthFile = Join-Path $runtime 'python311._pth'
if (-not (Test-Path -LiteralPath $embeddedPython) -or -not (Test-Path -LiteralPath $pthFile)) {
  throw 'Python 3.11 embeddable archive is missing expected files.'
}

$site = Join-Path $runtime 'Lib\site-packages'
New-Item -ItemType Directory -Force -Path $site | Out-Null
$buildPython = (Get-Command python -ErrorAction Stop).Source
$buildPythonInfo = (& $buildPython -c 'import struct,sys; print(str(sys.version_info.major)+chr(46)+str(sys.version_info.minor),struct.calcsize(chr(80))*8)').Trim()
if ($LASTEXITCODE -ne 0 -or $buildPythonInfo -ne '3.11 64') {
  throw ('The build runner must provide Python 3.11 x64; found ' + $buildPythonInfo)
}

& $buildPython -m pip install --disable-pip-version-check --only-binary=:all: --no-compile --target $site -r (Join-Path $PSScriptRoot 'voice-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Unable to install the locked voice runtime wheels into the portable Python directory.' }

@('python311.zip', '.', 'Lib\site-packages', 'import site') | Set-Content -LiteralPath $pthFile -Encoding ASCII
$probe = & $embeddedPython -B -c 'import sys,struct,pilk,edge_tts,imageio_ffmpeg; print(sys.version_info.major,sys.version_info.minor,sys.version_info.micro,struct.calcsize(chr(80))*8)'
if ($LASTEXITCODE -ne 0 -or ($probe -join ' ') -notmatch '3 11 9 64') {
  throw ('Portable voice Python failed its import probe: ' + ($probe -join ' '))
}

$installed = & $buildPython -m pip list --path $site --format=json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Unable to record installed voice runtime package versions.' }
$manifest = [ordered]@{
  pythonVersion = '3.11.9'
  architecture = 'x64'
  sourceUrl = $sourceUrl
  sourceSha256 = $sourceSha256
  requirementsSha256 = Get-Sha256 (Join-Path $PSScriptRoot 'voice-requirements.txt')
  packages = @($installed | ForEach-Object { @{ name=$_.name; version=$_.version } })
  runtimeProbe = ($probe -join ' ')
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runtime 'VOICE-RUNTIME.json') -Encoding UTF8
Write-Output ('Portable voice runtime prepared: ' + ($probe -join ' '))
