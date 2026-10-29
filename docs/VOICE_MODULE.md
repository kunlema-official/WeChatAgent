# WeChatAgent voice module — preview integration

## Architecture boundary: DSH service plugin vs. ZIP plugin API

This is a first-party **DSH Cordis service plugin**, not a user-installed WeChatAgent ZIP/API-v2 plugin. The 0.4.1 ZIP API is designed for explicitly authorized user extensions; it does not expose raw WeChat audio, DSH's `speechToText` provider, or the native voice-send gate. Routing ASR/TTS through that API would add another plugin process and extra serialization without supplying the required media lifecycle.

The intended flow is: WeChatAgent per-chat policy → native Hook/reader → authenticated loopback voice RPC → this plugin's ASR/TTS service → the existing reply protocol and thin OneBot adapter. The social-bridge bundle owns the single active `dsh-voice-plugin` row. The voice package retains a no-op compatibility bundle patch so existing DSH profiles that already list it in `dsh.profile.bundles` continue to boot; that empty patch contributes no duplicate entry. When the official Voice Input bundle is active, a disabled Cordis group suppresses the fallback STT rows as a unit; otherwise that group provides `speech-to-text` and SenseVoice. This avoids duplicate loader IDs during DSH patch composition. Service injection (`speechToText`) gates voice-service activation, so the design does not depend on YAML row order. The voice plugin registers the `wechatVoice` service; the bridge owns the authenticated RPC routes because it already owns the local token, project root, and chat allowlist.

This keeps ASR/TTS separate from WeChatAgent's send adapter while retaining one source of truth for per-chat voice authorization. The RPC routes currently live in `native-context.mjs`; extracting them into a dedicated route module would be a maintainability refactor, not a requirement to use the public ZIP plugin API.


## Current architecture

1. The NT reader accepts WeChat message type `34` and emits a signed, per-message voice descriptor.
2. The authenticated reader endpoint `/api/v1/voices/<sha256>` resolves `VoiceInfo.voice_data` from the active account's `db_storage/media/media_0.db`, checking the configured conversation whitelist before returning SILK bytes.
3. `hook-onebot.mjs` only processes voice messages when that chat's voice setting is enabled. It sends the audio to the DSH bridge over loopback with the existing DSH bearer token.
4. `dsh-voice-plugin` decodes SILK to 16 kHz mono PCM16 WAV and calls the DSH `speechToText` service (`sensevoice-local` by default). The transcript is converted to a normal text event before the existing chat pipeline.
5. The model can emit `RESPOND_VOICE:` for short, spoken-style replies in enabled chats. The OneBot adapter requests voice delivery only when `/WeChatAgent/health` reports `nativeVoiceSend: true`; otherwise it deliberately falls back to text. The Windows Hook build script fetches the voice-capable `mengyunqwq/wechat-hook` source when no local checkout exists and refuses to build if `Route_SendVoiceMsg` is missing.

## Per-chat configuration

`wechat.voice.enabled` is the account-level default (false). `wechat.voice.chats` is a map keyed by `wechat:private:<numeric-id>` or `wechat:group:<numeric-id>`. A boolean overrides the default; deleting the key restores inheritance.

Console path: **Settings → Chat defaults → Voice recognition and replies** controls the account default (false by default). For a safer rollout, leave that default off, then open **Chat → select one saved private chat → Set this chat → Voice recognition and replies → On**. A per-chat On/Off overrides the account default; “inherit” restores the default. Test short Chinese voice messages in that one private chat before enabling any group. Existing chats stay disabled after migration.

## Voice runtime on Windows 11

The cloud-built preview update installer bundles a portable CPython 3.11 x64 runtime and the pinned `pilk`, `edge-tts`, and `imageio-ffmpeg` wheels. On a packaged installation, desktop bootstrap automatically registers that interpreter in `state/voice/python.json`; users do not need to install Python or run a package manager. To verify or repair the voice runtime manually, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-voice.ps1
```

The script detects the bundled runtime and verifies its imports. It does not modify the existing Python 3.13 reader runtime and does not require a system-wide Python or C++ build toolchain. When running directly from a source checkout without the packaged runtime, the developer fallback still requires Python 3.11 x64 and creates a dedicated environment. Fully restart DSH and WeChatAgent after updating the plugin.

ASR also requires the DSH `speechToText` service and the `sensevoice-local` provider. TTS defaults to Xiaomi MiMo `mimo-v2.5-tts`; set `MIMO_API_KEY` in the Windows user environment, then sign out/in or launch both WeChatAgent and DSH from a fresh shell that inherits the variable. The key is not stored in project JSON. See the plugin README for voices and privacy details. Check the authenticated `/voice/status` endpoint if either service is unavailable.

## Native voice sending still requires Windows runtime verification

The WeChatAgent adapter already calls `/SendVoiceMsg` with a one-shot local gate and confirms the result against a type-34 outgoing message receipt. The native wrapper declares `Route_SendVoiceMsg`, and `scripts/build-hook.ps1` clones the voice-capable `mengyunqwq/wechat-hook` source (if absent), verifies that the route is present and included in the Visual Studio project, then builds a WeChatAgent-integrated DLL. The current Mac-side pass has not built or exercised that Windows DLL against a real WeChat process; therefore runtime voice-bubble sending remains unverified here. The adapter checks `nativeVoiceSend` at runtime and safely falls back to text when unavailable.

## Updating from 0.4.0

The source branch itself is not an installer and must not be copied over a live installation. Use the `Windows Voice Preview Installer` GitHub Actions artifact for the packaged update. The workflow builds the native Hook, prepares both portable Python runtimes, runs the focused voice/reply/installer tests plus the full repository suite, checks source privacy, and records SHA-256 verification data. This still does not replace real Windows 11 end-to-end testing with the user's WeChat process. Before installing, close WeChat and DSH, back up the workspace `state` directory, confirm the existing AppData/workspace mapping, and keep the previous installation available for rollback. The update must preserve chat history, persona files, whitelist and DSH settings. Full voice output should not be called release-ready until the voice-capable Hook build and actual Windows voice-bubble send/receipt have been validated.


## Validation scope

This Mac-side source pass ran JavaScript syntax checks, Python compilation/CLI checks, voice/reply/adapter startup unit tests, and the repository privacy scan. It did **not** run real SILK decode, SenseVoice inference, MiMo API synthesis (and optional Edge TTS network synthesis), native Hook voice sending, or a Windows 11 installer. Those require the target Windows 11 x64 runtime, the configured DSH speech provider, and the exact supported WeChat build.
