# Mac development + cloud Windows build

You do not need to install Visual Studio, MSVC, Python build dependencies, or a Windows development toolchain on your personal Windows 11 PC.

## Recommended path: GitHub-hosted Windows runner

The repository includes `.github/workflows/windows-voice-hook.yml`. It runs focused voice/reply tests, performs the repository privacy check, compiles the voice-capable x64 Hook on a disposable Windows 2022 runner, verifies the DLL hash and build manifest, and uploads the native build artifact.

The workflow does **not** build or publish a final installer, and it does **not** prove that the DLL can send a real voice bubble in a running WeChat process. The exact WeChat `4.1.10.27` runtime test must still happen on a Windows machine that has that matching client installed. Do not copy the artifact into your active 0.4.0 installation before a separate test plan and rollback backup are ready.

### Setup from a Mac

1. Create a **private** empty GitHub repository. Keep the source private because the ZIP may contain project-specific assets and authorized presets. Do not upload `state/`, `.env`, `config/wechatagent.json`, API keys, WeChat databases, or account data.
2. Extract the source ZIP on the Mac, open Terminal in the extracted project root, and run:

   ```bash
   git init
   git add .
   git status --short
   node scripts/test-voice-feature.mjs
   node scripts/test-reply-protocol.mjs
   ```

   Review `git status --short` before committing. The project `.gitignore` excludes local state, credentials, generated binaries, and runtime databases. If the output lists anything private, stop and remove it before proceeding.

3. Commit and push to your private repository (replace the URL with your own repository URL):

   ```bash
   git add .
   git commit -m "Add voice plugin and Windows cloud build workflow"
   git branch -M main
   git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_PRIVATE_REPO.git
   git push -u origin main
   ```

4. On GitHub, open **Actions → Windows Voice Hook Build → Run workflow**. The `push` trigger also runs when relevant source files change on `main`.
5. When the run completes, download the artifact named `WeChatAgent-0.5.0-preview.2-Windows-x64-voice-hook`. Keep the DLL and `build.json` together; the manifest records the upstream commit, target WeChat version, and DLL hash.
6. Send the Actions log and `build.json` back for review before using the DLL. Do not share the API key or any account data.

### Costs and privacy

GitHub-hosted Windows runners are managed, short-lived virtual machines. For public repositories, standard runners are generally free; for private repositories, usage counts against the account's included Actions minutes and may incur charges beyond the allowance. Check the current GitHub Actions pricing for the account before running many builds.

The workflow needs no secrets and does not use `MIMO_API_KEY`. It fetches the configured public Hook source during the build. Review upstream changes before relying on a build, because the upstream branch can change over time.

## Alternative: Windows cloud VM

Use a Windows cloud VM only if you need an interactive desktop to debug native initialization or test actual WeChat send/receive. It requires installing the Windows C++ Build Tools on that VM, not on your personal PC. Shut it down or delete it when done. Do not log into WeChat on a third-party VM unless you trust its operator and understand the account/session privacy implications.
