# DSH Voice Service Plugin (preview)

This internal DSH service plugin exposes one `wechatVoice` service to the WeChatAgent bridge. Its package keeps an empty compatibility bundle patch for existing DSH profiles; only `dsh-social-bridge-plugin` inserts the active `dsh-voice-plugin` row.

- `transcribeSilk(audio, options)`: SILK v3 → canonical 16 kHz mono PCM16 WAV → DSH `speechToText` provider (default `sensevoice-local`).
- `synthesizeSilk(text, options)`: default Xiaomi MiMo `mimo-v2.5-tts` API → WAV → 24 kHz mono PCM16 → SILK v3 for WeChat; optional `edge-tts` backend remains available by explicit configuration.
- `status()`: reports Python dependencies, ASR provider readiness, TTS provider selection and whether the MiMo API key is configured (never returns the key).

The plugin does not listen on a separate port. The existing authenticated DSH bridge exposes `/voice/status`, `/voice/transcribe`, and `/voice/synthesize` on its loopback RPC server.

## MiMo TTS configuration (default)

1. Create an API key in the Xiaomi MiMo platform: <https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/speech-synthesis-v2.5>.
2. Set `MIMO_API_KEY` in the Windows user environment. In PowerShell, run `setx MIMO_API_KEY "YOUR_API_KEY"`, then sign out of Windows and sign back in (or launch both WeChatAgent and DSH from a fresh PowerShell process that inherits the variable). Restarting apps from an already-running Explorer session may not inherit the newly written environment value. Do not paste the key into chat or commit it into `wechatagent.json`.
3. The default config is `ttsProvider: "mimo-v2.5-tts"`, `ttsVoice: "冰糖"`, with a natural conversational Mandarin style instruction in `ttsStyle`.
4. Supported built-in voice IDs: `mimo_default`, `冰糖`, `茉莉`, `苏打`, `白桦`, `Mia`, `Chloe`, `Milo`, `Dean`.
5. TTS text is sent to Xiaomi's API for synthesis. Do not use it for text that must never leave the machine. The plugin caps synthesized replies at the existing per-chat limit and validates the returned WAV before conversion.

MiMo is the default provider. If the API key is missing, network access fails, or the API rejects the request, the plugin reports a clear error and WeChatAgent's reply delivery layer can fall back to text. It does **not** silently send the text to Edge TTS. To explicitly select Edge TTS, set `ttsProvider` to `edge-tts`; `edgeVoice`, `ttsRate` and `ttsPitch` then apply.

## ASR requirements

1. Enable the DSH `speechToText` service and its `sensevoice-local` provider for local ASR.
2. On Windows, run `powershell -ExecutionPolicy Bypass -File .\scripts\setup-voice.ps1` from the WeChatAgent workspace. It creates a dedicated Python 3.11 environment at `state/voice-runtime`; the app's Python 3.13 and reader environment are not modified.
3. The voice environment includes `pilk`, `edge-tts`, and `imageio-ffmpeg`. Edge TTS is only used when explicitly selected; `imageio-ffmpeg` and `pilk` are used for audio format conversion.

## Chat policy

Voice processing is disabled by default. In the console, keep **Settings → Chat defaults → Voice recognition and replies** off for the account default, then open **Chat → select one saved chat → Set this chat → Voice recognition and replies → On** to enable only that chat. Per-chat On/Off overrides `wechat.voice.enabled`; “inherit” follows the account default. The reader exposes audio only for the current account and configured whitelist conversations.

## Important output limitation in this preview

The WeChatAgent adapter calls `/SendVoiceMsg` only when the native Hook health check advertises `nativeVoiceSend: true`. The Windows Hook build script fetches the voice-capable `mengyunqwq/wechat-hook` source if needed and verifies `Route_SendVoiceMsg`; real voice-bubble sending still requires Windows runtime verification. If the native sender is unavailable, replies safely fall back to text.

## Audio and privacy

Incoming SILK and decoded WAV files are temporary and deleted after transcription. Generated SILK files are stored in `state/voice/outgoing` for at most about one hour unless a sender is actively using the file. MiMo receives the text sent for synthesis; Edge TTS also sends text externally when explicitly configured.
