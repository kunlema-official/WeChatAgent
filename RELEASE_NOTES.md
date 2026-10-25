# Release notes

## 0.5.0-preview.2 — MiMo TTS integration

- Set Xiaomi MiMo `mimo-v2.5-tts` as the default TTS backend; Edge TTS remains an explicit optional provider.
- Added validated MiMo WAV response handling and WAV-to-SILK conversion at 24 kHz mono PCM16.
- Added `MIMO_API_KEY` environment-variable configuration and status diagnostics without exposing the key.
- Added voice/style configuration validation and tests for the official OpenAI-compatible request shape.
- Live MiMo API calls and Windows/WeChat native voice sending still require runtime acceptance testing.

# WeChatAgent 0.5.0-preview.2 — MiMo 语音集成源码预览

> 这是源码预览包，不是经过 Windows 11 实机验收的正式安装器；不要直接覆盖已安装的 0.4.0。

## 新增与改造

- 新增独立 DSH Voice Plugin，接入微信 type 34 语音读取、本地 SenseVoice ASR，以及小米 MiMo `mimo-v2.5-tts` API → WAV → SILK v3 的语音合成链路。
- MiMo TTS 为默认引擎，支持内置中文/英文音色和自然语言风格指令；Edge TTS 保留为显式选择的可选后端，不会在 MiMo 失败时偷偷把文本发给 Edge。
- API Key 通过 `MIMO_API_KEY` 环境变量读取，不写入项目 JSON；新增 WAV 响应校验、24 kHz PCM16 转换、SILK 头与时长校验。
- 语音开关沿用账号默认值和当前聊天覆盖规则；模型可以自主选择文字或语音，但最终发送仍受本地聊天配置与原生 Hook 能力检查约束。
- Windows Hook 构建脚本会获取具备 `Route_SendVoiceMsg` 的 `mengyunqwq/wechat-hook` 源码，并在构建前检查路由存在且纳入 VS 工程；WeChatAgent 适配层在发送前检查 Hook 健康状态，并在原生发送不可用时降级为文字。

## 验证范围与限制

- 本轮已通过语音专项测试 13/13、相关 JavaScript 语法检查和 Python 编译/CLI 检查。
- 尚未在当前环境实际调用 MiMo API，也未在 Windows 11 + 微信 4.1.10.27 上构建原生 Hook、发送真实语音气泡或执行 0.4.0 原地升级。
- ASR 仍需 DSH 的 `speechToText` 服务与 `sensevoice-local` provider。MiMo TTS 需要有效的 `MIMO_API_KEY` 和联网环境。

详细说明：[语音模块](docs/VOICE_MODULE.md)、[安全升级计划](docs/UPGRADE_0.4.0_TO_0.5.0_PREVIEW.md)、[MiMo TTS 插件说明](packages/dsh-voice-plugin/README.md)。

---

# WeChatAgent 0.4.0

本次更新完善微信远程助手能力，集中整理功能入口，并改善任务反馈、重复提交和公开版界面兼容。

## 新增功能

- **微信远程助手模式**：按聊天选择 DSH 任务预设，使用已授权的工具、技能与插件。支持任务查询、取消、补充回答、继续任务及工作区切换；聊天模式和助手模式分别保留设置与上下文。
- **管理员控制与原生审批**：在“设置 → 助手设置”管理真实微信 ID，私聊仅允许指定管理员，群聊可独立设置管理员模式；按需启用一次性微信审批，继续遵守 DSH 原生权限。
- **普通文件收发**：为聊天开启文件收发后，可接收微信附件并回传工作区成果，单个文件最多 50 MB。内容解析由所选 DSH 技能、工具及本机依赖完成，收到文件不会自动执行其中内容。
- **自定义任务语录**：支持按接单、读取文件、查找资料、执行工具、继续处理、完成与失败七个阶段添加、修改和删除语录，选择关闭、普通或整活档位，并设置反馈间隔和条数。
- **统一聊天详情**：在一个页面管理允许的好友与群聊、工作区分组、工作模式、人格、能力授权、任务及上下文；可按聊天类型、工作模式、名称或人格筛选。

## 修复问题

- **重复提交与中断恢复**：通过持久批次和任务编号去重，同一任务重试不会重新提交原生操作；执行中断后明确标记，避免自动重跑可能已经发生的操作。
- **公开版聊天页加载失败**：兼容公开版与开发版用量显示模块的差异，避免缺少可选统计模块导致整个页面空白；会话和已有配置继续保留。
- **设置交互与入口兼容**：修正跨页面继承错误滚动位置、聊天搜索与弹窗字段标识冲突；旧会话、回复设置、连接、工具和日志链接继续跳转至对应位置。
- **发布资源完整性**：补齐新版布局模块和使用文档的打包清单，修正公开源码中失效的测试命令，避免界面文件存在而依赖未随包发布。感谢群友定位问题的协作

## 优化内容

- **六项主导航**：收拢为“概览、聊天、人格、能力、表情包、设置”。合并聊天范围和会话管理，将诊断、原始日志与开发者工具移入设置。
- **按功能集中配置**：搜索与网页阅读在“能力 → 联网与阅读”；表情收集、共享、发送、dsh-meme 和联网补图在“表情包”；管理员和语录在“设置 → 助手设置”。DSH 插件与技能仍在 DSH 中安装管理。
- **更清楚的作用范围**：区分账号默认、单聊覆盖、总开关与模式适用性；单聊设置分为基本设置、能力与权限、高级，继续保留独立保存和未保存修改提醒。
- **任务反馈与模型分离**：语录由本地程序选择，不额外调用模型，也不写入提示词、人格卡或接话缓存。默认间隔 15 秒、每任务最多 3 条常规反馈，短任务避免额外完成播报。
- **保留数据与部署方式**：沿用单次目录选择及 app/data 布局、账号隔离、人格分类、表情池和会话历史。DSH 继续独立安装，安装包不携带 DSH 桌面程序。
- **成本优化**：改变了记忆的逻辑，降低了单次聊天的成本

升级前请停止助手服务，并从托盘完整退出旧版 WeChatAgent、DSH 和匹配微信，再运行 WeChatAgent-Setup-0.4.0-x64.exe。同位置升级沿用已有数据路径；更换位置时按提示核对迁移来源和目标。升级后准备连接配置并完整重开 DSH，确保加载新版插件。

匹配微信为 Windows x64 4.1.10.27，桥接插件 SDK 为 0.2.0-rc.2。PDF、Office 等解析依赖 DSH 实际可用的能力；网页阅读不代表可观看视频或访问需登录的内容。安装包未商业代码签名，实际构建号、校验值和验证范围见附带的 VERIFICATION.json 与 SHA256SUMS.txt。

使用入口见[界面导航](docs/UI_LAYOUT.md)、[微信远程助手](docs/ASSISTANT_REMOTE.md)、[文件收发](docs/FILE_TRANSFER.md)和[自定义语录](docs/ASSISTANT_FEEDBACK.md)。[0.3.9 发布说明及后记](docs/releases/0.3.9.md)已保留。
