param([string]$MsBuild = '', [string]$BuildDirectory = '', [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'components\WeChat-Hook'
$build = Join-Path $root 'state\hook\build-source'
$output = Join-Path $root 'state\hook\native'
foreach ($taskOverride in @(@{value=$BuildDirectory;name='build'},@{value=$OutputDirectory;name='output'})) {
    if (-not $taskOverride.value) { continue }
    $taskPath = if ([IO.Path]::IsPathRooted($taskOverride.value)) { [IO.Path]::GetFullPath($taskOverride.value) } else { [IO.Path]::GetFullPath((Join-Path $root $taskOverride.value)) }
    if (-not $taskPath.StartsWith(([IO.Path]::GetFullPath((Join-Path $root 'state'))+'\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Custom build paths must stay inside this project state directory.' }
    if ($taskOverride.name -eq 'build') { $build=$taskPath } else { $output=$taskPath }
}
$repo = 'https://github.com/mengyunqwq/wechat-hook.git'
if (-not (Test-Path -LiteralPath (Join-Path $source 'x64_Version_dll.vcxproj'))) {
    if (Test-Path -LiteralPath $source) { throw 'components/WeChat-Hook exists but is not a complete source checkout. Back it up, move it aside, and rerun hook:build.' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $source) | Out-Null
    Write-Output ('Cloning voice-capable Hook source: ' + $repo)
    & git clone --branch main --depth 1 $repo $source
    if ($LASTEXITCODE -ne 0) { throw 'Unable to clone the voice-capable Hook source. Check network access and GitHub availability.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $source 'x64_Version_dll.vcxproj'))) { throw 'Hook source is incomplete: x64_Version_dll.vcxproj is missing.' }
$commit = ''
if (Test-Path -LiteralPath (Join-Path $source '.git')) {
    $commit = (& git -C $source rev-parse HEAD).Trim()
    $origin = (& git -C $source remote get-url origin 2>$null).Trim()
    if ($origin -notmatch 'github\.com[:/]mengyunqwq/wechat-hook(?:\.git)?$') { throw ('Hook source origin is not the reviewed voice-capable fork: ' + $origin) }
} elseif (Test-Path -LiteralPath (Join-Path $source 'UPSTREAM.json')) {
    $provenance = Get-Content -LiteralPath (Join-Path $source 'UPSTREAM.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($provenance.upstream -notmatch 'mengyunqwq/wechat-hook') { throw 'Hook provenance does not identify mengyunqwq/wechat-hook.' }
    foreach ($entry in $provenance.files.PSObject.Properties) {
        $file = [IO.Path]::GetFullPath((Join-Path $source $entry.Name))
        if (-not $file.StartsWith([IO.Path]::GetFullPath($source)+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid source provenance path.' }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw ('Reviewed source changed: '+$entry.Name) }
    }
    $commit = $provenance.commit
} else { throw 'Hook source must be a Git checkout or have verified UPSTREAM.json provenance.' }
$voiceSource = Get-ChildItem -LiteralPath (Join-Path $source 'src') -Recurse -Filter '*.cpp' | Select-String -Pattern '\bRoute_SendVoiceMsg\s*\(' | Select-Object -First 1
if (-not $voiceSource) { throw 'This Hook source does not implement Route_SendVoiceMsg. Use https://github.com/mengyunqwq/wechat-hook, not the stock aixed upstream.' }
$voiceSourcePath = $voiceSource.Path
$projectText = [IO.File]::ReadAllText((Join-Path $source 'x64_Version_dll.vcxproj'))
$projectRelative = $voiceSourcePath.Substring($source.Length + 1).Replace('/', '\')
if (-not $projectText.Contains($projectRelative)) { throw ('Voice route source is not included in x64_Version_dll.vcxproj: ' + $projectRelative) }
Write-Output ('Voice route source: ' + $projectRelative)
Write-Output ('Hook commit: ' + $commit)
New-Item -ItemType Directory -Path $build,$output -Force | Out-Null
foreach ($entry in Get-ChildItem -LiteralPath $source -Force) {
    if ($entry.Name -eq '.git') { continue }
    Copy-Item -LiteralPath $entry.FullName -Destination $build -Recurse -Force
}
$encoding = [Text.UTF8Encoding]::new($false)
function Replace-Checked([string]$File,[string]$Before,[string]$After) {
    $text = [IO.File]::ReadAllText($File)
    if (-not $text.Contains($Before)) { throw ('Expected upstream code missing: ' + $File) }
    [IO.File]::WriteAllText($File,$text.Replace($Before,$After),$encoding)
}
Replace-Checked (Join-Path $build 'src\inline_weixin_dll_load.cpp') 'g_httpServer->Start("0.0.0.0", g_StartPort);' 'g_httpServer->Start("127.0.0.1", g_StartPort);'
Replace-Checked (Join-Path $build 'src\inline_weixin_dll_load.cpp') '#include "global.h"' "#include `"global.h`"`n#include `"deferred_init.h`""
Replace-Checked (Join-Path $build 'src\inline_weixin_dll_load.cpp') '    Patch_Revoke();' '    // WeChatAgent does not change message recall behavior.'
Replace-Checked (Join-Path $build 'dllmain.cpp') 'HideModuleFromPEB(hModule);' '// WeChatAgent keeps the module visible for diagnostics.'
Replace-Checked (Join-Path $build 'dllmain.cpp') '#include "global.h"' "#include `"global.h`"`n#include `"deferred_init.h`""
Replace-Checked (Join-Path $build 'dllmain.cpp') 'CustomInit(hModule);' 'ScheduleWeChatAgentInit(hModule);'
Replace-Checked (Join-Path $build 'dllmain.cpp') '    if (ul_reason_for_call == DLL_PROCESS_ATTACH)' "    if (ul_reason_for_call == DLL_PROCESS_DETACH) { CancelWeChatAgentInit(); return TRUE; }`n    if (ul_reason_for_call == DLL_PROCESS_ATTACH)"
Replace-Checked (Join-Path $build 'src\version_proxy.cpp') '#include "version_proxy.h"' "#include `"version_proxy.h`"`n#include `"deferred_init.h`""
Replace-Checked (Join-Path $build 'src\version_proxy.cpp') '    g_hWeixinExe = GetModuleHandleW(L"weixin.exe");' "    WeChatAgentInitStage(`"module_lookup`");`n    g_hWeixinExe = GetModuleHandleW(L`"weixin.exe`");"
Replace-Checked (Join-Path $build 'src\version_proxy.cpp') '    if (MH_Initialize() != MH_OK)' "    WeChatAgentInitStage(`"minhook_initialize`");`n    const auto minhookStatus = MH_Initialize();`n    WeChatAgentInitLog(`"minhook_status`", static_cast<unsigned long>(minhookStatus));`n    if (minhookStatus != MH_OK && minhookStatus != MH_ERROR_ALREADY_INITIALIZED)"
Replace-Checked (Join-Path $build 'src\version_proxy.cpp') '    Evt_WeixinLoad();' "    WeChatAgentInitStage(`"weixin_load_enter`");`n    Evt_WeixinLoad();`n    WeChatAgentInitStage(`"weixin_load_returned`");"
Replace-Checked (Join-Path $build 'src\inline_weixin_dll_load.cpp') 'GetParentProcessId();' "GetParentProcessId();`n    WeChatAgentInitStage(`"parent_pid_ready`");"
Replace-Checked (Join-Path $build 'src\inline_weixin_dll_load.cpp') '        g_httpServer = new HttpServer();' "        WeChatAgentInitStage(`"http_wrapper_construct`");`n        g_httpServer = new HttpServer();"
[IO.File]::WriteAllText((Join-Path $build 'src\http_routes.cpp'),"#include `"http_routes.h`"`n#include `"wechatagent_hook.h`"`nvoid RegisterRoutes(httplib::Server& server) { RegisterWeChatAgentRoutes(server); }`n",$encoding)
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native-hook\wechatagent_hook.h') -Destination (Join-Path $build 'include') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native-hook\wechatagent_hook.cpp') -Destination (Join-Path $build 'src') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native-hook\sticker_sender.h') -Destination (Join-Path $build 'include') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native-hook\sticker_sender.cpp') -Destination (Join-Path $build 'src') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native-hook\sticker_trace.cpp') -Destination (Join-Path $build 'src') -Force
foreach ($name in @('file_sender.h','deferred_init.h','http_server.h')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('native-hook\'+$name)) -Destination (Join-Path $build 'include') -Force }
foreach ($name in @('file_sender.cpp','deferred_init.cpp','http_server.cpp')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('native-hook\'+$name)) -Destination (Join-Path $build 'src') -Force }
$project = Join-Path $build 'x64_Version_dll.vcxproj'
Replace-Checked $project '<ClCompile Include="src\http_routes.cpp" />' '<ClCompile Include="src\http_routes.cpp" /><ClCompile Include="src\wechatagent_hook.cpp" /><ClCompile Include="src\sticker_sender.cpp" /><ClCompile Include="src\sticker_trace.cpp" /><ClCompile Include="src\file_sender.cpp" /><ClCompile Include="src\deferred_init.cpp" />'
Replace-Checked $project 'psapi.lib;gdiplus.lib;' 'version.lib;psapi.lib;gdiplus.lib;'
Replace-Checked $project '<PreprocessorDefinitions>' '<PreprocessorDefinitions>_DISABLE_CONSTEXPR_MUTEX_CONSTRUCTOR;'
if (-not $MsBuild) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio C++ Build Tools, or provide -MsBuild.' }
    $MsBuild = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1)
}
if (-not $MsBuild) { throw 'Visual Studio C++ compiler not found.' }
Push-Location $build
try {
    & $MsBuild $project /m /t:Build /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=v143 /v:minimal /nologo
    if ($LASTEXITCODE -ne 0) { throw 'Native Hook build failed.' }
} finally { Pop-Location }
$dll = Join-Path $build 'x64\Release\version.dll'
$previousDll = Join-Path $output 'version.dll'
$previousManifest = Join-Path $output 'build.json'
if ((Test-Path -LiteralPath $previousDll) -and (Test-Path -LiteralPath $previousManifest) -and (Get-FileHash -LiteralPath $previousDll).Hash -ne (Get-FileHash -LiteralPath $dll).Hash) {
    Copy-Item -LiteralPath $previousDll -Destination (Join-Path $output 'version.dll.previous') -Force
    Copy-Item -LiteralPath $previousManifest -Destination (Join-Path $output 'build.previous.json') -Force
}
Copy-Item -LiteralPath $dll -Destination (Join-Path $output 'version.dll') -Force
@{ upstream='https://github.com/mengyunqwq/wechat-hook'; commit=$commit; targetVersion='4.1.10.27'; integration='WeChatAgent-1'; nativeFiles='appmsg-6-factory-v1'; voiceRoute='Route_SendVoiceMsg'; initialization='deferred-module-v3'; mutexCompatibility='legacy-runtime-constructor-v1'; exceptionDiagnostics='seh-cpp-stage-v1'; logWriter='win32-srw-v1'; moduleWaitWarningMs=30000; moduleWaitTimeoutMs=0; sha256=(Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'build.json') -Encoding UTF8
Write-Output ('Native sender compiled: '+(Join-Path $output 'version.dll')+' (loopback, token, account/version checks).')
