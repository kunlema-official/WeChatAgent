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
$pinnedCommit = 'e3f6cfc45701c5233d87024813ea8842aa7bfb4b' # source revision observed in the Windows build log
if (-not (Test-Path -LiteralPath (Join-Path $source 'x64_Version_dll.vcxproj'))) {
    if (Test-Path -LiteralPath $source) { throw 'components/WeChat-Hook exists but is not a complete source checkout. Back it up, move it aside, and rerun hook:build.' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $source) | Out-Null
    Write-Output ('Fetching pinned voice-capable Hook source: ' + $repo + ' @ ' + $pinnedCommit)
    New-Item -ItemType Directory -Force -Path $source | Out-Null
    & git init $source
    if ($LASTEXITCODE -ne 0) { throw 'Unable to initialize Hook source checkout.' }
    & git -C $source remote add origin $repo
    if ($LASTEXITCODE -ne 0) { throw 'Unable to configure Hook source origin.' }
    & git -C $source fetch --depth 1 origin $pinnedCommit
    if ($LASTEXITCODE -ne 0) { throw ('Unable to fetch pinned Hook commit ' + $pinnedCommit + '. Check GitHub access or update the reviewed commit deliberately.') }
    & git -C $source checkout --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Unable to check out reviewed Hook source.' }
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
if ($commit -and $commit -ne $pinnedCommit) { throw ('Hook source commit mismatch. This build integration is pinned for ' + $pinnedCommit + ' but found ' + $commit + '. Remove components/WeChat-Hook and rerun hook:build to fetch the pinned revision.') }
$voiceSource = Get-ChildItem -LiteralPath (Join-Path $source 'src') -Recurse -Filter '*.cpp' | Select-String -Pattern '(?m)^\s*(?:void|bool|int)\s+Route_SendVoiceMsg\s*\(' | Select-Object -First 1
if (-not $voiceSource) { throw 'This Hook source does not define Route_SendVoiceMsg. Use the reviewed voice-capable source revision, not the stock aixed upstream.' }
$voiceSourcePath = $voiceSource.Path
$projectText = [IO.File]::ReadAllText((Join-Path $source 'x64_Version_dll.vcxproj'))
$projectRelative = $voiceSourcePath.Substring($source.Length + 1).Replace('/', '\')
if (-not $projectText.Contains($projectRelative)) { throw ('Voice route source is not included in x64_Version_dll.vcxproj: ' + $projectRelative) }
$voiceSourceRelative = $projectRelative
# The upstream moved its initialization translation unit in the current reviewed revision.
# Locate it by its unique HTTP-server startup anchor instead of assuming the old filename.
$inlineLoadRelative = 'src\inline_weixin_dll_load.cpp'
if (-not (Test-Path -LiteralPath (Join-Path $source $inlineLoadRelative))) {
    $startupCandidates = @()
    foreach ($candidate in (Get-ChildItem -LiteralPath $source -Recurse -File -Filter '*.cpp')) {
        $candidateText = [IO.File]::ReadAllText($candidate.FullName)
        if ($candidateText -match 'g_httpServer\s*->\s*Start\s*\(' -and $candidateText.Contains('g_StartPort')) { $startupCandidates += $candidate }
    }
    if ($startupCandidates.Count -ne 1) {
        $found = ($startupCandidates | ForEach-Object { $_.FullName }) -join '; '
        throw ('Cannot safely locate the Hook initialization source by the HTTP server startup anchor. Candidates: ' + $found)
    }
    $inlineLoadRelative = [IO.Path]::GetRelativePath($source, $startupCandidates[0].FullName).Replace('/', '\')
    Write-Output ('Resolved moved initialization source: ' + $inlineLoadRelative)
}
Write-Output ('Voice route source: ' + $voiceSourceRelative)
Write-Output ('Hook commit: ' + $commit)
New-Item -ItemType Directory -Path $build,$output -Force | Out-Null
foreach ($entry in Get-ChildItem -LiteralPath $source -Force) {
    if ($entry.Name -eq '.git') { continue }
    Copy-Item -LiteralPath $entry.FullName -Destination $build -Recurse -Force
}
$encoding = [Text.UTF8Encoding]::new($false)
function Replace-Checked([string]$File,[string]$Before,[string]$After) {
    if (-not (Test-Path -LiteralPath $File)) { throw ('Expected upstream source file missing: ' + $File) }
    $text = [IO.File]::ReadAllText($File)
    if (-not $text.Contains($Before)) { throw ('Expected upstream code missing: ' + $File + ' :: ' + $Before) }
    [IO.File]::WriteAllText($File,$text.Replace($Before,$After),$encoding)
}
$voiceSendSource = Join-Path $build 'src\wx_send.cpp'
Replace-Checked $voiceSendSource '        static std::atomic<bool> g_forceOn{ false };' "        static std::atomic<bool> g_forceOn{ false };`n        static std::atomic<uint64_t> g_forceOnUntil{ 0 };"
Replace-Checked $voiceSendSource '            if (g_forceOn.load()) return true;' "            if (g_forceOn.load()) {`n                const uint64_t until = g_forceOnUntil.load();`n                if (until != 0 && GetTickCount64() < until) return true;`n                g_forceOn.store(false);`n                g_forceOnUntil.store(0);`n            }"
Replace-Checked $voiceSendSource '        voicesend::g_forceOn.store(on);' "        if (on) {`n            voicesend::g_forceOnUntil.store(GetTickCount64() + 30000);`n            voicesend::g_forceOn.store(true);`n        } else {`n            voicesend::g_forceOn.store(false);`n            voicesend::g_forceOnUntil.store(0);`n        }"
$inlineLoadBuildFile = Join-Path $build $inlineLoadRelative
$inlineText = [IO.File]::ReadAllText($inlineLoadBuildFile)
$startPattern = 'g_httpServer\s*->\s*Start\s*\(\s*"[^"]+"\s*,\s*g_StartPort\s*\)\s*;'
$startMatches = [regex]::Matches($inlineText, $startPattern)
if ($startMatches.Count -lt 1) { throw ('No HTTP server start calls found in ' + $inlineLoadRelative + '; expected at least one matching g_httpServer->Start(..., g_StartPort) call.') }
# Some reviewed Hook revisions contain multiple startup branches in this translation unit.
# Restrict every matching server start to loopback, not just the first one.
$inlineText = [regex]::Replace($inlineText, $startPattern, 'g_httpServer->Start("127.0.0.1", g_StartPort);')
Write-Output ('Restricted ' + $startMatches.Count + ' HTTP server start call(s) to 127.0.0.1.')
[IO.File]::WriteAllText($inlineLoadBuildFile, $inlineText, $encoding)
Replace-Checked $inlineLoadBuildFile '#include "global.h"' "#include `"global.h`"`n#include `"deferred_init.h`""
Replace-Checked $inlineLoadBuildFile 'if (g_WxVersion == 0) Patch_Revoke();' '    // WeChatAgent does not change message recall behavior.'
Replace-Checked (Join-Path $build 'dllmain.cpp') 'HideModuleFromPEB(hModule);' '; /* WeChatAgent keeps the module visible for diagnostics. */'
Replace-Checked (Join-Path $build 'dllmain.cpp') '#include "global.h"' "#include `"global.h`"`n#include `"deferred_init.h`""
Replace-Checked (Join-Path $build 'dllmain.cpp') 'CustomInit(hModule);' 'ScheduleWeChatAgentInit(hModule);'
Replace-Checked (Join-Path $build 'dllmain.cpp') '    if (ul_reason_for_call == DLL_PROCESS_ATTACH)' "    if (ul_reason_for_call == DLL_PROCESS_DETACH) { CancelWeChatAgentInit(); return TRUE; }`n    if (ul_reason_for_call == DLL_PROCESS_ATTACH)"
Replace-Checked (Join-Path $build 'src\version_proxy.cpp') '#include "version_proxy.h"' "#include `"version_proxy.h`"`n#include `"deferred_init.h`""
Replace-Checked (Join-Path $build 'src\version_proxy.cpp') '    g_hWeixinExe = GetModuleHandleW(L"weixin.exe");' "    WeChatAgentInitStage(`"module_lookup`");`n    g_hWeixinExe = GetModuleHandleW(L`"weixin.exe`");"
Replace-Checked (Join-Path $build 'src\version_proxy.cpp') '    if (MH_Initialize() != MH_OK)' "    WeChatAgentInitStage(`"minhook_initialize`");`n    const auto minhookStatus = MH_Initialize();`n    WeChatAgentInitLog(`"minhook_status`", static_cast<unsigned long>(minhookStatus));`n    if (minhookStatus != MH_OK && minhookStatus != MH_ERROR_ALREADY_INITIALIZED)"
Replace-Checked (Join-Path $build 'src\version_proxy.cpp') '    Evt_WeixinLoad();' "    WeChatAgentInitStage(`"weixin_load_enter`");`n    Evt_WeixinLoad();`n    WeChatAgentInitStage(`"weixin_load_returned`");"
Replace-Checked $inlineLoadBuildFile 'GetParentProcessId();' "GetParentProcessId();`n    WeChatAgentInitStage(`"parent_pid_ready`");"
Replace-Checked $inlineLoadBuildFile '        g_httpServer = new HttpServer();' "        WeChatAgentInitStage(`"http_wrapper_construct`");`n        g_httpServer = new HttpServer();"
$voiceRouteCompileEntry = ''
if ($voiceSourceRelative -ieq 'src\http_routes.cpp') {
    # The reviewed fork defines Route_SendVoiceMsg in http_routes.cpp. Keep that implementation
    # in a separate translation unit before replacing the registrar; otherwise the route is lost.
    $voiceRouteCopy = Join-Path $build 'src\voice_send_route.cpp'
    Copy-Item -LiteralPath (Join-Path $build 'src\http_routes.cpp') -Destination $voiceRouteCopy -Force
    $voiceRouteText = [IO.File]::ReadAllText($voiceRouteCopy)
    $registerPattern = '(?m)^(\s*(?:static\s+)?void\s+)RegisterRoutes\s*\('
    if (-not [regex]::IsMatch($voiceRouteText, $registerPattern)) { throw 'Voice route implementation is in src/http_routes.cpp but its RegisterRoutes function could not be isolated safely.' }
    $voiceRouteText = [regex]::Replace($voiceRouteText, $registerPattern, '$1RegisterUpstreamRoutes(', 1)
    if (-not $voiceRouteText.Contains('Route_SendVoiceMsg')) { throw 'Preserved voice route source lost Route_SendVoiceMsg.' }
    [IO.File]::WriteAllText($voiceRouteCopy, $voiceRouteText, $encoding)
    $voiceRouteCompileEntry = '<ClCompile Include="src\http_routes.cpp" /><ClCompile Include="src\voice_send_route.cpp" />'
    Write-Output 'Preserved Route_SendVoiceMsg in src\voice_send_route.cpp; upstream route registration remains uncalled.'
}
[IO.File]::WriteAllText((Join-Path $build 'src\http_routes.cpp'),"#include `"http_routes.h`"`n#include `"wechatagent_hook.h`"`nvoid RegisterRoutes(httplib::Server& server) { RegisterWeChatAgentRoutes(server); }`n",$encoding)
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native-hook\wechatagent_hook.h') -Destination (Join-Path $build 'include') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native-hook\wechatagent_hook.cpp') -Destination (Join-Path $build 'src') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native-hook\sticker_sender.h') -Destination (Join-Path $build 'include') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native-hook\sticker_sender.cpp') -Destination (Join-Path $build 'src') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native-hook\sticker_trace.cpp') -Destination (Join-Path $build 'src') -Force
foreach ($name in @('file_sender.h','deferred_init.h','http_server.h')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('native-hook\'+$name)) -Destination (Join-Path $build 'include') -Force }
foreach ($name in @('file_sender.cpp','deferred_init.cpp','http_server.cpp')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('native-hook\'+$name)) -Destination (Join-Path $build 'src') -Force }
$project = Join-Path $build 'x64_Version_dll.vcxproj'
$routeCompilePrefix = if ($voiceRouteCompileEntry) { $voiceRouteCompileEntry } else { '<ClCompile Include="src\http_routes.cpp" />' }
Replace-Checked $project '<ClCompile Include="src\http_routes.cpp" />' ($routeCompilePrefix + '<ClCompile Include="src\wechatagent_hook.cpp" /><ClCompile Include="src\sticker_sender.cpp" /><ClCompile Include="src\sticker_trace.cpp" /><ClCompile Include="src\file_sender.cpp" /><ClCompile Include="src\deferred_init.cpp" />')
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
