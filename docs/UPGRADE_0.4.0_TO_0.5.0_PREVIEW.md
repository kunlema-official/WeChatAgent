# 0.4.0 → 0.5.0 voice preview: safe upgrade plan

## Current status

This folder is a **source preview**, not a ready-to-run Windows installer. Do not copy these files over the running 0.4.0 installation and do not run an installer built from this preview as if full voice output were finished. Incoming voice ASR and TTS generation are integrated, but the checked-in native Hook still reports `nativeVoiceSend: false`; model-selected voice replies therefore fall back to text.

## Before any Windows upgrade test

1. Confirm the current installation root in the desktop app. With the 0.4.0 installer, the usual layout is `ROOT\app` plus `ROOT\data`; older/custom installations may use a remembered workspace or `%APPDATA%\WeChatAgent`.
2. Back up the entire active data/workspace directory, including configuration, persona cards, chat buffers, whitelist, delivery receipts and the existing `app\storage.ini` mapping. Do not move or copy the WeChat raw message database.
3. Stop WeChatAgent's background service and exit WeChatAgent, DSH and the matching WeChat client fully from their trays. Keep the original backup untouched.
4. Keep the original 0.4.0 installer available for rollback.

## When a source-backed native voice sender is ready

The release owner should build and validate the installer on Windows 11 x64, using the exact supported WeChat 4.1.10.27 build and authorized native Hook sources/resources. The Mac source preview cannot validate or produce the final Windows native Hook release.

1. In the Windows build checkout, install locked dependencies with `npm ci` and `npm ci --prefix packages/dsh-social-bridge-plugin`.
2. Run `npm run test:voice`, `npm run test:reply-protocol`, `npm run privacy:check`, then the full project test suite after dependencies are installed.
3. Build the matching native Hook and verify that `/WeChatAgent/health` reports `nativeVoiceSend: true` only after the real send route and database receipt confirmation pass against WeChat 4.1.10.27.
4. Build the installer with `npm run desktop:build`, `npm run installer:runtime`, and `npm run installer:build`. Review the generated manifest, source hashes and verification report.
5. Test both a clean install and an in-place 0.4.0 upgrade in an isolated Windows profile first. Confirm that existing data paths, personas, chat permissions, DSH settings and chat history remain intact.
6. Only after the isolated test passes should the installer be run at the existing installation root. Restart DSH fully so it reloads the new voice plugin.
7. Run `powershell -ExecutionPolicy Bypass -File .\scripts\setup-voice.ps1` from the active WeChatAgent workspace to create the dedicated Python 3.11 x64 voice environment. This does not modify the bundled Python 3.13 runtime.
8. Verify DSH's `speechToText` service and `sensevoice-local` provider, enable voice for one private chat, test incoming voice recognition, then test short voice replies. Enable group chats only after the private-chat test passes.

## Rollback

If the tested installer fails, stop all three applications, reinstall 0.4.0 at the same installation root, and restore the backup only if the app reports a data/configuration issue. Do not manually merge two workspace directories. Keep the failed preview and its logs separately for diagnosis; do not restore WeChat's raw database from the WeChatAgent backup.
