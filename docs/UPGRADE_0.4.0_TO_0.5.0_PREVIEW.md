# 0.4.0 → 0.5.0-preview.3：语音更新包与安全升级说明

## 当前状态

Windows x64 语音更新包已由 GitHub Actions 云端构建。构建流程已通过语音专项测试、完整仓库测试、源码隐私检查、原生 Hook 编译、便携式 Python 语音运行环境检查、SILK 编码/解码往返测试，以及安装包和 SHA-256 校验。

- [查看 Windows x64 语音更新包构建与附件](https://github.com/kunlema-official/WeChatAgent/actions/workflows/windows-voice-installer.yml?query=branch%3Afix%2Fvoice-ui-20261026)
- 附件名称以 `WeChatAgent-0.5.0-preview.3-Windows-x64-voice-update` 开头；Actions 附件保留期为 14 天。
- 这是 **更新包**，不是完整首装包：不包含微信客户端或 DSH 桌面程序，需要已有 WeChatAgent 数据工作区，并使用匹配的微信 **4.1.10.27 x64**。
- 原生 Hook 已包含 `/SendVoiceMsg` 路由并在构建清单中验证；但云端 CI **没有连接真实微信进程，也没有实际向微信发送语音气泡**。因此仍需在目标 Windows 机器上做一次私聊实测，不能把 CI 绿勾等同于真实账号验收。
- 语音默认关闭，按聊天启用。来信识别需要 DSH 的 `speechToText` 服务和 `sensevoice-local`；语音回复默认使用 Xiaomi MiMo `mimo-v2.5-tts`，需要有效的 `MIMO_API_KEY`。TTS 或原生发送不可用时，会安全回退为文字；无法确认原生提交结果时不会盲目重复发送。

## 升级前必须做的准备

1. 在 WeChatAgent 的数据/安装设置中确认当前活动工作区。旧版 0.4.0 常见布局是安装根目录下的 `app\` 与 `data\`；较早或自定义安装也可能使用记住的工作区或 `%APPDATA%\WeChatAgent`。以当前程序实际使用的位置为准。
2. 完整备份活动的数据/工作区，包括 `config\wechatagent.json`、人格文件、聊天缓冲、白名单、发送回执和旧版 `app\storage.ini`（若存在）。**不要移动或覆盖微信原始消息数据库。**
3. 停止 WeChatAgent 后台服务，并从托盘彻底退出 WeChatAgent、DSH 和匹配的微信客户端。
4. 保留原版 0.4.0 安装器和未修改的备份，以便回滚。

## 安装与首次验证

1. 打开上方 Actions 页面，进入最新的成功运行，在 Artifacts 中下载 `WeChatAgent-0.5.0-preview.3-Windows-x64-voice-update`。运行更新安装器，并选择当前正在使用的安装根目录；不要为了“试试看”而把更新包装进一个全新的空目录。
2. 启动后先确认原有工作区、聊天白名单、人格、DSH 连接和历史记录仍然存在。如果界面像全新安装一样要求重新配置，请停止操作并核对数据路径，不要在空工作区里重新初始化。
3. 从托盘彻底退出 DSH 后重新启动，确保它重新加载工作区中的 WeChatAgent 插件。确认 DSH 已启用本项目插件，并确认 `speechToText` 与 `sensevoice-local` 可用。首次使用本地 ASR 时，SenseVoice 可能需要准备或下载模型。
4. 为 MiMo 配置 API Key。在 PowerShell 中执行 `setx MIMO_API_KEY "YOUR_API_KEY"`，将占位符替换成你自己的密钥；随后注销并重新登录 Windows，让桌面程序获得新的用户环境变量。也可以从已继承该变量的全新会话启动 WeChatAgent 和 DSH。**不要把密钥粘贴到聊天中，也不要提交到 `wechatagent.json` 或仓库。**
5. 在控制台先保持 **设置 → 聊天默认值 → 语音识别和回复** 关闭，然后只为一个已允许的私聊打开 **聊天 → 选择该私聊 → 设置此聊天 → 语音识别和回复**。先发送一条微信语音，确认它能被识别并进入正常对话，再测试短语音回复。
6. 模型会自行决定使用文字还是语音；默认语音回复上限为 120 个字符，配置允许范围为 10–240。较长内容应使用文字。只有私聊实测通过后，再考虑对群聊单独启用。

更新包已携带专用的便携式 Python 3.11 x64 语音运行环境，不需要在 Windows 上安装 Node.js、Python 或其他开发工具。若状态页报告语音依赖缺失，可从活动工作区运行 `powershell -ExecutionPolicy Bypass -File .\scripts\setup-voice.ps1` 修复专用语音环境；该脚本不会修改应用的 Python 3.13 运行环境。

## 回滚

如果更新后出现异常，停止服务并彻底退出三个应用；在同一安装根目录重新安装原版 0.4.0。只有在应用明确出现数据/配置问题时才恢复备份。不要手工合并两个工作区，也不要用 WeChatAgent 备份覆盖微信原始数据库。保留失败日志和预览安装器，便于定位问题。
