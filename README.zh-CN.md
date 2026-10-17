# dsh-ios-simulator-helper

[English](https://github.com/zhz8888/dsh-ios-simulator-helper/blob/main/README.md) | [简体中文](https://github.com/zhz8888/dsh-ios-simulator-helper/blob/main/README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/@zhz8888/dsh-ios-simulator-helper.svg)](https://www.npmjs.com/package/@zhz8888/dsh-ios-simulator-helper)
[![license: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://github.com/zhz8888/dsh-ios-simulator-helper/blob/main/LICENSE)
![platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)
[![target: DSH](https://img.shields.io/badge/DSH-0.2.x-blue.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

把 ZCode 官方 `ios-simulator@0.1.0` 插件移植为 **DSH（DeepSeek Harness）原生插件**：原有 20 个 MCP 工具全部保留为 DSH 原生工具，并新增一个完整的 **设置页面**（设置 → iOS 模拟器），让默认设备、运行时、UI 后端、构建参数与输出目录都能在应用里配置，而不是靠环境变量。

- 工具名、参数名与原插件完全一致，为原 MCP 服务器写的工作流可直接迁移；另新增 1 个 `ios_shutdown_simulator`（原插件能启动模拟器却无法停止它）。
- 设置页 5 组 17 个字段，全部实时生效；空值按「设置页 → 原插件环境变量 → 内置默认值」顺序回落。
- 设置页会检测宿主系统：**非 macOS 时直接提示该插件仅支持 macOS**，且所有 `ios_*` 工具都会以一句话拒绝执行，而不是抛出 `spawn xcrun ENOENT`。
- npm 包名为 `@zhz8888/dsh-ios-simulator-helper`，插件页显示的名称由 `locale/en.json` 与 `locale/zh.json` 提供——英文 **iOS Simulator**、中文 **iOS 模拟器**——而不是裸包名。

## 快速上手

在装了完整 Xcode、至少一个 iOS 运行时和 DSH 的 Mac 上：

1. **安装插件**

   ```bash
   dsh plugin --profile <profile> add @zhz8888/dsh-ios-simulator-helper
   ```

   DSH Desktop 则在左侧「插件」页里添加同一个包名。装完重载或重启 DSH。

2. **检查环境** —— 打开 **设置 → iOS 模拟器**，点「检测环境」。它跑的正是 `ios_preflight` 的那套检查（完整 Xcode、模拟器运行时、`idb`），缺什么就给修复建议。

3. **开始使用** —— 直接说需求（「把这个工程在 iPhone 16 模拟器上构建并跑起来」「给正在运行的 App 截个图」），或直接调用 21 个 `ios_*` 工具。工具需要的参数都能在那个设置页里改。

## 目录

- [快速上手](#快速上手)
- [环境要求](#环境要求)
- [安装](#安装)
- [设置页面](#设置页面)
- [截图](#截图)
- [工具清单](#工具清单)
- [Skill 与斜杠命令](#skill-与斜杠命令)
- [与原插件的差异](#与原插件的差异)
- [架构](#架构)
- [开发与验证](#开发与验证)
- [版本与发布](#版本与发布)
- [插件市场收录](#插件市场收录)
- [已知限制](#已知限制)
- [参与贡献](#参与贡献)
- [许可](#许可)

## 环境要求

| 依赖 | 说明 |
|---|---|
| macOS | 唯一支持的宿主。`xcrun simctl`、`xcodebuild`、Simulator.app 只存在于 macOS |
| 完整 Xcode | `xcode-select -p` 必须指向 `Xcode.app/Contents/Developer`；仅装 Command Line Tools 不够 |
| iOS Simulator 运行时 | Xcode → Settings → Platforms 里至少安装一个 iOS/iPadOS 运行时 |
| Node.js ≥ 22 | DSH 宿主运行时 |
| idb（可选） | 仅 `ios_ui_*` 工具需要；未安装时构建/运行/截图/日志链路完全不受影响 |

`ios_preflight` 会逐项检查上述条件并给出修复建议；设置页的「检测环境」按钮运行同一套检查。

## 安装

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-ios-simulator-helper
```

**DSH Desktop**：`desktop` profile 由 Electron 应用自身管理，在左侧「插件」页里添加 `@zhz8888/dsh-ios-simulator-helper`，再把生成的条目打开即可。

发布出去的 tarball 里已经包含插件运行所需的一切——host 半侧、浏览器 bundle、随包 skill 与 `locale/` 条目——安装期不编译任何东西，因此不涉及构建授权步骤。

`package.json` 声明了 `dsh.bundle.patch`，安装后 DSH 的 reconcile 会把本包追加到 `dsh.profile.bundles`，profile 启动时合并 `cordis.patch.yml`，挂载唯一一行 host 入口。`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools` 与 `@deepseek-ai/schemastery` 是 **peer 依赖**，由 DSH 宿主提供：插件只声明自己构建时对应的版本区间，避免再装第二份，本包自身没有任何运行时依赖。DSH 的兼容性闸门按 `peerDependencies` 里 `@deepseek-ai/dsh*` 的版本区间与运行时版本比对，不匹配会明确拒装。

> 只能挂载一次。`dsh plugin add` 已经把入口写进 `dsh.profile.bundles`；再往 profile 自己的 `cordis.patch.yml` 里加同一行会让同名工具二次注册，并在加载期直接报错。

### 打开设置页

重载/重启后打开 **设置 → iOS 模拟器**。页面在 host 半侧真正提供了该设置命名空间时才会出现；反之不会留下任何痕迹。

### 升级与卸载

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-ios-simulator-helper@latest   # 升级
dsh plugin --profile <profile> remove @zhz8888/dsh-ios-simulator-helper      # 卸载
```

设置保存在 profile 里而不是包里，所以这两条命令都不会动它。数据目录（默认 `$DSH_HOME/ios-simulator-helper`）存放截图、构建日志与 DerivedData，卸载不会删除它，是否清理由你决定。

## 设置页面

设置命名空间 = profile patch 行 id = `ios-simulator-helper`（同时是 `dsh.name`）。页面通过 `ctx.configForms` 读写，因此具备暂存编辑、脏值检测、内联校验、乐观并发（revision）与「已覆盖/恢复默认」语义。

页面顶部显示插件完整名称，随后每个分类是一张独立卡片，靠卡片边框区分，不必在每个区块之间加分隔线。每个字段沿用平台自带的「标签 → 控件 → 说明」结构，开关只靠滑块本身表示状态。度量取自 `@deepseek-ai/dsh-client-ui-primitives` 的 `settings-form/fields.module.css`——即内置设置页所用的表单套件，因此本页与它们并排也不显突兀。三个超时均以整秒填写（`120`、`60`、`600`）；旧的 `IOS_SIM_*_MS` 环境变量仍按毫秒读取，并自动换算为秒。

保存由一条吸附在页面底部、居中的小药丸条负责：有暂存改动、写入进行中或写入失败时出现，状态点旁写明当前状态，并提供 **放弃改动** 与 **保存**（复用平台的 `Button` 组件；草稿不合法时保存按钮禁用）。只是把控件改回当前生效值的草稿不算改动——开关拨回去后表单会真正回到干净状态。写入成功由一条提示条确认；离开页面会放弃未保存的编辑。

| 分组 | 设置项 | 类型 | 默认值 | 原插件环境变量回落 | 说明 |
|---|---|---|---|---|---|
| 模拟器与设备 | `defaultDevice` | 文本（建议来自本机模拟器） | `iPhone 16` | `IOS_SIM_DEFAULT_DEVICE` | 设备名片段；工具未指定 `udid`/`device` 时优先使用，找不到时退回第一个可用 iPhone |
| | `defaultRuntime` | 文本（建议来自已装运行时） | 空 | `IOS_SIM_DEFAULT_RUNTIME` | 运行时名片段，例如 `iOS-27`；留空不限运行时。**偏好而非要求**：值过期时自动放宽而不是报错 |
| | `autoBootSimulator` | 开关 | 开 | `IOS_SIM_AUTO_BOOT` | 关闭后，目标未启动时直接报错，不替你执行 `simctl boot` |
| | `autoOpenSimulator` | 开关 | 开 | `IOS_SIM_AUTO_OPEN` | 与原插件一致地打开模拟器窗口（启动/显示/打开 URL/构建并运行）；关闭后只做 `simctl` 操作 |
| | `bootTimeoutSeconds` | 整数 | `120` | `IOS_SIM_BOOT_TIMEOUT_MS`（毫秒） | 单条 `simctl boot` / `bootstatus` 的最长等待，单位为秒；旧变量保留毫秒写法并自动换算 |
| UI 自动化 | `uiBackend` | 下拉 | `auto` | `IOS_SIM_UI_BACKEND` | `auto` 探测 idb；`idb` 强制要求；`none` 关闭 UI 工具；`xcodebuildmcp` 为保留值 |
| | `idbBinary` | 文本 | `idb` | `IOS_SIM_IDB_BINARY` | idb 命令名或绝对路径 |
| | `uiTimeoutSeconds` | 整数 | `60` | `IOS_SIM_UI_TIMEOUT_MS`（毫秒） | 单次 idb UI 命令的最长运行时间，单位为秒；旧变量为毫秒 |
| 构建与 DerivedData | `defaultConfiguration` | 文本 | `Debug` | `IOS_SIM_CONFIGURATION` | 工具未指定 `configuration` 时使用 |
| | `buildTimeoutSeconds` | 整数 | `600` | `IOS_SIM_BUILD_TIMEOUT_MS`（毫秒） | 一次 `xcodebuild build` 的最长运行时间，单位为秒；旧变量为毫秒 |
| | `extraBuildArgs` | 多行文本 | 空 | `IOS_SIM_EXTRA_BUILD_ARGS` | 每行一个参数，`#` 为注释；插在 `-derivedDataPath` 之后、`build` 之前 |
| | `derivedDataDir` | 文本 | 空 | `IOS_SIM_DERIVED_DATA_DIR` | 留空用 `<数据目录>/DerivedData/<项目指纹>` |
| | `disableCodeSigning` | 开关 | 开 | `IOS_SIM_DISABLE_CODE_SIGNING` | 原插件固定传 `CODE_SIGNING_ALLOWED=NO`；关闭后交给 Xcode 决定 |
| 日志 | `logSeconds` | 整数 | `120` | `IOS_SIM_LOG_SECONDS` | `ios_logs` 未指定窗口时读取的最近秒数，上限 3600 |
| | `logLimit` | 整数 | `20000` | `IOS_SIM_LOG_LIMIT` | `ios_logs` 未指定上限时返回的最大字符数 |
| 输出目录 | `dataDir` | 文本 | 空 | `IOS_SIM_PLUGIN_DATA` | 截图、构建日志与 DerivedData 的根目录；留空用 `$DSH_HOME/ios-simulator-helper`，其次 `~/.dsh/ios-simulator-helper` |
| | `screenshotDir` | 文本 | 空 | `IOS_SIM_SCREENSHOT_DIR` | 留空用 `<数据目录>/screenshots` |

页面底部是宿主检测与三个按钮/结果区：

- **宿主系统**：页面先用浏览器自身的平台串**同步**判断（因此非 macOS 的浏览器在首屏就能看到提示，不必等请求），再用 host 半侧 `GET /api/ios-simulator-helper/host` 的结论确认；两者冲突时以 host 为准。判定为不支持时，页面顶部出现红色提示条：**该插件仅支持 macOS**，并给出检测到的平台名。
- **检测环境** → `GET /api/ios-simulator-helper/status`，返回与 `ios_preflight` 相同的检查项，逐条显示状态、详情与修复建议。
- **刷新模拟器与运行时** → `GET /api/ios-simulator-helper/inventory`，探测 Xcode 路径与版本、macOS 版本、模拟器、运行时与默认目标，用于填充上方字段的建议列表。

### 兼容旧配置

原插件的 `userConfig`（`default_device`、`ui_backend`）与其环境变量 `IOS_SIM_DEFAULT_DEVICE`、`IOS_SIM_UI_BACKEND`、`IOS_SIM_PLUGIN_DATA` 都会作为回落生效（见上表最后一列），因此已有 ZCode / CI 配置无需改动。原插件的 `IOS_SIM_PACKAGE_ROOT` 只用于其 MCP 启动器定位插件自身，DSH 侧由包路径直接解析，不再需要。

## 截图

四张都是 DSH Desktop 里这份代码跑起来的真实页面，按从上到下的滚动顺序排列，没有做图。

**1. 模拟器与设备** —— 每次 `ios_*` 调用都会读取的字段：

![DSH Desktop 里的 iOS 模拟器设置页：模拟器与设备分组，含默认设备、默认运行时、自动启动、自动打开窗口与启动超时](https://raw.githubusercontent.com/zhz8888/dsh-ios-simulator-helper/main/assets/settings-page-1-simulator-and-device.png)

**2. UI 自动化与构建** —— `idb` 后端与其超时，接着是 `xcodebuild` 的配置、构建超时与额外参数：

![滚动到 UI 自动化与构建分组：UI 后端、idb 可执行文件、UI 操作超时、默认构建配置、构建超时与额外 xcodebuild 参数](https://raw.githubusercontent.com/zhz8888/dsh-ios-simulator-helper/main/assets/settings-page-2-ui-automation-and-build.png)

**3. 日志与输出** —— DerivedData 目录与代码签名开关，`ios_logs` 的窗口与字符上限，以及截图/日志/DerivedData 的落盘位置：

![继续向下滚动：DerivedData 目录、构建时禁用代码签名、默认日志窗口与默认日志字符上限，以及数据目录与截图目录](https://raw.githubusercontent.com/zhz8888/dsh-ios-simulator-helper/main/assets/settings-page-3-logs-and-output.png)

**4. 宿主检测与保存** —— macOS 判定与检测到的平台、两个检测按钮，以及保存按钮：

![页面底部：宿主系统判定为「macOS —— 符合要求（darwin/arm64）」、检测环境与刷新模拟器按钮，以及保存按钮](https://raw.githubusercontent.com/zhz8888/dsh-ios-simulator-helper/main/assets/settings-page-4-host-check.png)

`screenshots.json` 就在 `package.json` 旁边按这个顺序列出四张图，插件市场据此展示。`assets/` 只放这些精选截图；运行产物与验证截图不进仓库（见 `.gitignore`）。

## 工具清单

21 个工具：原插件 20 个名称与参数完全一致，另加 1 个。

| 工具 | 作用 |
|---|---|
| `ios_preflight` | 检查宿主是否 macOS、Xcode/`xcodebuild`/`simctl`、运行时、模拟器与 UI 后端，并回显当前设置 |
| `ios_list_simulators` | 列出 iOS/iPadOS 模拟器与已安装运行时 |
| `ios_boot_simulator` | 启动选定模拟器，可选打开 Simulator 窗口 |
| `ios_show_simulator` | 打开 Simulator.app 并聚焦指定 UDID |
| `ios_shutdown_simulator` | **新增**：关闭选定模拟器（`simctl shutdown`），已关闭时报成功而非错误 |
| `ios_discover_project` | 发现 `.xcodeproj`/`.xcworkspace`、scheme 与 bundle id |
| `ios_create_app` | 生成最小 SwiftUI 工程（默认拒绝覆盖已生成文件） |
| `ios_build_app` | 用 `xcodebuild` 构建 iOS 模拟器产物 |
| `ios_build_and_run` | 构建 → 安装 → 启动 → 显示 |
| `ios_install_app` | 安装 `.app` 到选定模拟器（绝对路径可用） |
| `ios_launch_app` | 按 bundle id 启动 |
| `ios_terminate_app` | 按 bundle id 结束进程 |
| `ios_open_url` | 在模拟器里打开 URL |
| `ios_screenshot` | 截图并落盘；模型支持图像输入时同时返回图像 |
| `ios_logs` | 读取 `log show` 输出，可按 bundle id 过滤 |
| `ios_ui_status` | 报告 UI 自动化后端可用性与当前设置选择 |
| `ios_ui_tap` / `ios_ui_swipe` / `ios_ui_type_text` / `ios_ui_button` / `ios_ui_describe` | 基于 idb 的点击/滑动/输入/按键/可访问性树 |

两个行为值得单独说明：

- **`ios_screenshot`**：PNG 总会写到磁盘（默认 `<数据目录>/screenshots/`），同时尝试把图像提交给宿主的附件服务以获得规范的图像块。当前模型未声明图像输入、或部署没有附件服务时，结果退化为纯文本并附上文件路径，而不会让整次调用失败。
- **`ios_build_and_run` 的 bundle id 解析**（相对原插件修正）：原插件只问 `xcodebuild -showBuildSettings`，该命令在没有 `-derivedDataPath` 时会去准备**默认** DerivedData 目录，在受限环境里失败后静默返回 `undefined`，于是构建成功却报「bundle id 无法解析」。本插件的解析顺序是「显式 `bundleId` 参数 → 刚构建出的 `.app` 的 `CFBundleIdentifier`（用 `plutil` 读取，即 simctl 真正安装的那个值）→ 带 `-derivedDataPath` 的 `-showBuildSettings` → `project.pbxproj` 中发现的标识符」，并在结果里用 `bundleIdSource` 说明来源。

## Skill 与斜杠命令

- **`ios-dev` skill**：随包提供（`skills/ios-dev/`），host 半侧通过 `ctx.skills.register()` 注册为嵌入式 skill，skill 目录作为 `resourceBase`。内容已按 DSH 改写：去掉 `mcp__...` 前缀、把环境配置指向设置页、写明 macOS 前置条件与「用完关闭模拟器」的收尾动作。
- **`/ios-dev [目标]` 命令**：通过 `ctx.commands.register()` 注册。DSH 的用户命令刻意不产生模型消息，因此该命令做一件不依赖模型的事——跑一遍环境诊断，输出结论、失败项与修复建议；非 macOS 宿主返回的就是「仅支持 macOS」这句话。

## 与原插件的差异

| 方面 | 原插件（ZCode） | 本插件（DSH） |
|---|---|---|
| 工具暴露 | stdio MCP 服务器 `ios-simulator`，模型看到 `mcp__ios_simulator__*` | 原生 `ctx.tools.register()`，模型看到 `ios_*` |
| 用户配置 | `plugin.json` 的 `userConfig`（2 项），经环境变量注入 | 设置页 17 字段 + schemastery `Config`，全部 `.volatile()` 实时生效；原环境变量仍作回落 |
| 宿主检查 | 仅 `ios_preflight` 里检查一次 `process.platform` | 中央化的 `requireMacOS()`：每个工具一句话拒绝；设置页同步 + 权威双重判定 |
| 工作目录 | `process.cwd()` | `exec.agent.session.header.cwd`（会话工作区） |
| 数据目录 | `IOS_SIM_PLUGIN_DATA` / 临时目录 | `$DSH_HOME/ios-simulator-helper`，可在设置页配置 |
| 路径安全 | `inside(cwd, path)` 拒绝逃逸 | 同一语义；另区分「只读路径」（`ios_install_app` 允许绝对路径）与「写入目标」（必须在会话工作区内） |
| 截图返回 | MCP image content（base64） | host 附件引用生成的图像块，失败时退化为文本 + 磁盘路径 |
| 结果归一 | providers 直接返回含 `undefined` 的对象 | 所有工具结果经 `toLosslessJson()` 归一（注册表拒绝 `undefined`） |
| 斜杠命令 | 注入一段提示词给模型 | 直接运行诊断并输出结论 |
| 进程调用 | `node:child_process` 直接 spawn | 保持一致 |

保留直接 spawn 是有意的取舍：这样 `xcodebuild`、`simctl`、`idb` 的行为与原插件逐字节一致。代价是绕过了 DSH 的 subprocess seam——没有统一的过程管理、环境清洗与卸载期终止。本插件每个外部调用都有显式 timeout 与 `SIGTERM`，且不读写任何凭据环境变量。

## 架构

```
dsh-ios-simulator-helper/
├── package.json            # dsh.bundle.patch、dsh.client、peer 依赖（兼容性闸门）
├── cordis.patch.yml        # - insert: [{ id: ios-simulator-helper, name: '@zhz8888/dsh-ios-simulator-helper' }]
├── ios.svg                 # 插件图标：iOS 字标，沿用原版取色，深色模式自适应反色
├── locale/en.json          # 插件页名称与简介（英文；它的存在与否决定其他语言文件是否生效）
├── locale/zh.json          # 对应的简体中文
├── README.md               # 英文版（默认）
├── README.zh-CN.md         # 本文件（简体中文）
├── lib/
│   ├── index.js            # host 半侧：注册工具 / skill / 命令 / 三个 Fetch 路由 / 设置页策略
│   ├── client.js           # browser 半侧：__ModuleLoader__ 手写 bundle，设置页 + 宿主检测
│   ├── settings.js         # 字段声明、schemastery Config（全部 .volatile()）、实时读取
│   ├── runtime.js          # 每次调用构造 runtime（会话 cwd + 实时设置 + 平台 → 数据目录）
│   ├── tools/index.js      # 21 个 defineTool 定义、参数/结果 schema、图像准入
│   ├── providers/          # 从原插件逐文件移植，改为显式接收 runtime
│   └── util/               # 进程执行、路径、内容块
├── skills/ios-dev/         # SKILL.md
├── scripts/                # check-bundle.mjs（一致性闸门）、verify-mount.mjs、smoke.mjs、link-dsh-deps.mjs
└── test/                   # node:test 单元与集成测试
```

四个约束决定了上面的形状：

1. **设置命名空间只有一个真相来源**：profile patch 行 id。`cordis.patch.yml` 的 `id`、`lib/settings.js` 的 `SETTINGS_NAMESPACE`、`lib/client.js` 的字面量必须一致；`scripts/check-bundle.mjs` 会校验它们，也会校验 host 与 client 两份字段表无漂移、三个路由两侧一致、macOS 判定逻辑仍在。
2. **browser bundle 不能 import host 模块**（客户端纯度闸门禁止跨插件值导入），因此字段表被写了两遍，靠闸门保持一致；bundle 只能 `require` 宿主的 9 个静态模块（React、Cordis、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit` 等）。
3. **平台检查中央化**：`lib/providers/host.js` 的 `hostInfo()` / `requireMacOS()` 是唯一读取 `process.platform` 语义的地方，且平台是可注入参数，因此非 macOS 分支可以在 macOS 上被测试。
4. **插件页显示名是包资源，不是 manifest 字段**：DSH 通过 `exports` 映射解析 `<包名>/locale/en.json`，所以 `./locale/*.json` 必须保持导出、`locale` 必须留在 `files` 里——缺任何一项都会静默退回显示裸包名。`en.json` 同时是其他语言文件的总开关，不能只留 `zh.json`。这三条都由 `test/manifest.test.js` 锁住。

## 开发与验证

```bash
git clone https://github.com/zhz8888/dsh-ios-simulator-helper.git
cd dsh-ios-simulator-helper
pnpm install                  # 只装测试依赖（react、react-dom）
pnpm test                     # 98 个测试（不需要 Xcode，不需要模拟器）
pnpm run check                # 测试 + host/client 一致性闸门 + 真实 Cordis 挂载验证
pnpm run verify:mount         # 真实 Cordis Context + 真实 ToolRuntime 注册表
pnpm run smoke                # 只读真机探测：preflight / 模拟器 / 运行时 / 项目发现 / inventory
pnpm run smoke:simulator      # 额外：生成工程 → 构建 → 安装启动 → 截图 → 日志 → 结束 → 关闭模拟器
pnpm run link:dsh-deps        # 离线开发：把本机 DSH 的 @deepseek-ai 包软链进 node_modules
```

`smoke:simulator` 支持 `--device <片段>`、`--data-dir <路径>`、`--keep`、`--no-macros`：

- 默认把数据目录放在本次生成的临时工程下，因此在受限（沙箱）shell 里也能跑完，且结束时会关闭**只有本次启动过**的模拟器，不会掐掉你正在用的设备。
- `--no-macros` 会把生成的 `ContentView.swift` 换成不含 Swift 宏的版本。原模板的 `@State` / `#Preview` 需要 `swift-plugin-server`，而宏展开由 `sandbox-exec` 承载；**调用方自身处于沙箱内时无法启动嵌套沙箱**，编译会以 `sandbox-exec: sandbox_apply: Operation not permitted` 失败——这与本插件无关（同一条命令行原插件也会失败）。该开关用于在沙箱 shell 里仍然验证构建编排、产物发现、安装、启动、截图、日志、结束与关闭整条链路。

### 四层验证

| 层 | 命令 | 证明了什么 |
|---|---|---|
| 单元 / 解析器 | `pnpm test` | 客户端 bundle 加载契约与静态模块约束、manifest 与 patch 契约、设置投影（volatile 实时读取、环境变量回落、越界回落、布尔写法）、移植过来的解析器（`simctl list` 设备/运行时、UDID 校验、选择顺序、bundle id 来源、`plutil`、路径边界、日志钳制、无损 JSON 归一） |
| 设置页渲染 | `pnpm test`（`client-render.test.js`） | 用真实 React + `react-dom/server` 在三种宿主场景（macOS / Linux / Windows / 无法识别）下渲染整个设置页：分组/字段/字典键完整、受控输入带真实值、开关与下拉状态正确、**非 macOS 出现「仅支持 macOS」提示条且 macOS 不出现**、提示条带检测到的平台名、无未解析字典键 |
| 一致性闸门 | `scripts/check-bundle.mjs` | bundle id = 包名、命名空间 = patch 行 id、host 与 client 两份字段表逐键逐选项一致、三个路由两侧一致、macOS 判定与提示键仍在、bundle 仍是经典脚本 |
| 真实宿主挂载 | `scripts/verify-mount.mjs` | 在**真实** Cordis `Context` + **真实** `ToolRuntime` 上挂载：21 个工具注册成功、只读工具经注册表实际派发并通过参数/结果 schema 校验、错误参数被注册表拒绝、未知工具名不解析、17 个设置字段全部 volatile、dispose 后工具全部注销 |

`smoke` 覆盖只有真机才能证明的部分：Xcode 探测、`simctl` 实际调用、生成工程能否编译、产物发现与 bundle id 解析、安装/启动/截图/日志/结束/关闭。

## 版本与发布

| 版本 | 日期 | npm | GitHub |
|---|---|---|---|
| `v1.0.0` | 2026-10-17 | [`@zhz8888/dsh-ios-simulator-helper@1.0.0`](https://www.npmjs.com/package/@zhz8888/dsh-ios-simulator-helper) | [Release 说明](https://github.com/zhz8888/dsh-ios-simulator-helper/releases/tag/v1.0.0) |

一次发布意味着同一个提交出现在两个地方，而且这件事是可核对的：

```bash
npm view @zhz8888/dsh-ios-simulator-helper@1.0.0 gitHead --registry https://registry.npmjs.org
git rev-parse v1.0.0^{commit}   # 两者应打印同一个提交
```

**发布新版本**

1. 改 `package.json` 的 `version` 并提交（历史里的写法是 `build: bump the version to x.y.z`）。
2. 在打 tag 的那个提交上发布：

   ```bash
   npm publish --registry https://registry.npmjs.org --access public
   ```

   两个参数都必须带：本机 `.npmrc` 的 `registry` 通常指向只读镜像；scoped 包不加 `--access public` 会保持私有。开了两步验证的账号会多一步浏览器授权，npm 会先建一个临时的 `0.0.0-stage` 版本再发布正式版本。
3. 给 tag 写 GitHub Release——中英双语，栏目照上一版：这一版包含什么、改了什么、怎么安装、做过哪些验证。

> npm 包页上渲染的 README 是**发布出去的 tarball 里**那一份，所以这里改了 README 要等下一次发版才会反映到 npm 上。

## 插件市场收录

本仓库按 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的[贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)整理。指南的每一条要求与本仓库的对应位置：

| 要求 | 满足位置 |
|---|---|
| `package.json` 声明 `dsh.bundle`（`dsh plugin add` 能否安装取决于它） | `dsh.bundle.patch` → `./cordis.patch.yml`，由 `test/manifest.test.js` 断言 |
| `package.json` 旁边有 `cordis.patch.yml` 用于挂载插件 | `cordis.patch.yml`，一个 `insert` 行，行 id 即设置命名空间 |
| 真实可用代码，而非占位 | `lib/`（host 半侧、client 半侧、21 个工具）、`test/`、`scripts/` |
| 官方 `@deepseek-ai/*` 必须是 `peerDependencies`，不能是 `dependencies` | `package.json` —— 本包**没有任何运行时依赖** |
| peer 区间不能静默排除 harness 的预发布版本 | 含预发布的区间都补齐下一段元组：`^0.2.0-rc.2 \|\| ^0.2.1-alpha.1` |
| 在自己的仓库里声明 1-8 张截图 | `screenshots.json` → `assets/`；张数、是否在仓库内、禁止 `..` 由 `test/manifest.test.js` 断言 |
| `repository`、`homepage`、`bugs` 指向被收录的仓库 | `package.json`，由 `test/manifest.test.js` 断言 |

投稿本体是列表仓库里的单个文件 `data/plugins/zhz8888__dsh-ios-simulator-helper.yml`（`url` 与 `name` 用上面的仓库地址，`description.en` 只描述代码实际做的事）。分类选 `dev`：这个插件做的是构建、运行与检查 iOS 应用。

已经就位：

- 仓库已在 [github.com/zhz8888/dsh-ios-simulator-helper](https://github.com/zhz8888/dsh-ios-simulator-helper) 公开，带 `dsh-plugin` 等 11 个 topic。
- 包已发布到 npm，市场可以显示下载量；包的 `repository` 字段指回本仓库，这就是两者建立关联的依据。
- `v1.0.0` 已打 tag 并有对应的 GitHub Release。

还差一件事：

- **仓库要满 24 小时。** 列表 CI 会拒绝创建不足 24 小时的仓库，所以 PR 只能在那之后提交。

## 已知限制

- **仅支持 macOS**：非 macOS 上 `ios_preflight` 会把 `Host OS (macOS)` 标为失败并跳过其余探测（不做无意义的 spawn），所有 `ios_*` 工具直接拒绝；设置页顶部常驻提示。
- `idb` 未安装时 `ios_ui_*` 不可用，`ios_ui_status` 会说明原因；`xcodebuildmcp` 只是保留值（与原插件的 `reservedBackends` 一致），尚未实现。
- 原插件的 `ios_build_and_run` 会无条件打开 Simulator 窗口；本插件把它交给 `autoOpenSimulator` 设置（默认开，行为与原插件一致），`ios_build_app` / `ios_screenshot` 仍按原语义不主动开窗。
- `ios_logs` 与原插件一样只做 `log show`（不做实时流），窗口与长度可配置且有上限。
- Swift 宏（`@State`、`#Preview` 等）需要 `swift-plugin-server` 启动 `sandbox-exec`；**在沙箱内调用本插件时这类工程无法编译**（真机集成测试因此提供 `--no-macros`）。DSH 宿主半侧的代码运行在 bash 沙箱之外，正常使用不受影响。
- 生成工程模板与原插件逐字保留（`project.pbxproj` 为 Xcode 14 兼容格式、`objectVersion = 56`），未跟随新版 Xcode 的模板变化。
- **设置页已在 DSH Desktop 里人工目视确认过一次**：把插件装进 `desktop` profile，打开「设置 → iOS 模拟器」，`assets/` 里那四张按顺序就是那次的真实界面。暗色主题、窄屏换行与非 macOS 提示条仍只有渲染测试覆盖，没有目视。
- `@deepseek-ai/dsh-client-ui-primitives` 是浏览器打包产物（依赖 `*.module.css`、`simple-icons`、`zustand/vanilla`），Node 无法直接 import，因此渲染测试对该包使用忠实替身；真实 React 与 `react-dom/server` 仍是真件。
- 插件不触碰凭据：不读取、不转发任何含 key/token/secret 的环境变量。

## 参与贡献

问题与 PR 都欢迎提到 [github.com/zhz8888/dsh-ios-simulator-helper](https://github.com/zhz8888/dsh-ios-simulator-helper/issues)。每个改动都要保持 `pnpm check` 全绿——它会跑单元测试、host/client 一致性闸门和真实宿主挂载，见[开发与验证](#开发与验证)。没有 CLA，也没有需要填的表单：一个说明改了什么、为什么改的聚焦 PR 就够了。

## 许可

[MIT](https://github.com/zhz8888/dsh-ios-simulator-helper/blob/main/LICENSE)，版权所有 (c) 2026 zhz8888。

工具与 provider 逻辑移植自 ZCode 官方 `ios-simulator` 插件（同样以 MIT 分发，版权归 Z.ai），
SwiftUI 工程模板逐字保留；完整的来源与版权说明见 [LICENSE](https://github.com/zhz8888/dsh-ios-simulator-helper/blob/main/LICENSE) 末尾的归属章节。
