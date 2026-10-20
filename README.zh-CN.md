# dsh-ios-simulator-helper

[English](README.md) | **简体中文**

[![npm version](https://img.shields.io/npm/v/@zhz8888/dsh-ios-simulator-helper.svg)](https://www.npmjs.com/package/@zhz8888/dsh-ios-simulator-helper)
[![license: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
![platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)
[![target: DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.2-blue.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

把 ZCode 官方 `ios-simulator@0.1.0` 插件移植为 **DSH（DeepSeek Harness）原生插件**：原有 20 个 MCP 工具全部保留为 DSH 原生工具，并新增一个**参数表单**，渲染在「插件」页该插件的详情页里（插件 → 已安装插件 → iOS 模拟器助手），让默认设备、运行时、UI 后端、构建参数与输出目录在应用里配置，而不是靠环境变量。

- 工具名、参数名与原插件完全一致，为原 MCP 服务器写的工作流可直接迁移；另新增 1 个 `ios_shutdown_simulator`（原插件能启动模拟器却无法停止它）。
- 参数页 5 组 17 个字段，全部实时生效；空值按「参数页 → 原插件环境变量 → 内置默认值」顺序回落。
- 参数页会检测宿主系统：**非 macOS 时直接提示该插件仅支持 macOS**；所有需要调用 Apple 工具链的工具都会以明确的报错拒绝执行，而不是抛出 `spawn xcrun ENOENT`；`ios_preflight` 则报告宿主检查失败，`ios_discover_project`、`ios_create_app` 与 `ios_ui_status` 仍可正常返回。
- npm 包名为 `@zhz8888/dsh-ios-simulator-helper`；插件页显示的名称由 `locale/` 提供——英文 **iOS Simulator Helper**、中文 **iOS 模拟器助手**——而不是裸包名，两份描述都注明插件为非官方、与 Apple 无隶属关系。

## 快速上手

在装了完整 Xcode、至少一个 iOS 运行时和 DSH 的 Mac 上：

1. **安装插件**

   ```bash
   dsh plugin --profile <profile> add @zhz8888/dsh-ios-simulator-helper
   ```

   DSH Desktop 则在左侧「插件」页里添加同一个包名。装完重载或重启 DSH。

2. **检查环境** —— 打开 **插件 → 已安装插件 → iOS 模拟器助手**，点「检测环境」。它跑的正是 `ios_preflight` 的那套检查（完整 Xcode、模拟器运行时、`idb`），缺什么就给修复建议。

3. **开始使用** —— 直接说需求（「把这个工程在 iPhone 16 模拟器上构建并跑起来」「给正在运行的 App 截个图」），或直接调用 21 个 `ios_*` 工具。工具需要的参数都能在那个页面里改。

## 目录

- [快速上手](#快速上手)
- [环境要求](#环境要求)
- [安装](#安装)
- [配置页面](#配置页面)
- [截图](#截图)
- [工具清单](#工具清单)
- [Skill 与斜杠命令](#skill-与斜杠命令)
- [与原插件的差异](#与原插件的差异)
- [已知限制](#已知限制)
- [版本与发布](#版本与发布)
- [参与贡献](#参与贡献)
- [许可](#许可)

## 环境要求

| 依赖 | 说明 |
|---|---|
| macOS | 唯一支持的宿主。`xcrun simctl`、`xcodebuild`、模拟器窗口应用只存在于 macOS |
| 完整 Xcode | `xcode-select -p` 必须指向 `Xcode.app/Contents/Developer`；仅装 Command Line Tools 不够 |
| iOS Simulator 运行时 | Xcode → Settings → Platforms 里至少安装一个 iOS/iPadOS 运行时 |
| Node.js ≥ 22 | DSH 宿主运行时 |
| idb（可选） | 仅 `ios_ui_*` 工具需要；未安装时构建/运行/截图/日志链路完全不受影响 |

`ios_preflight` 会逐项检查上述条件并给出修复建议；参数页的「检测环境」按钮运行同一套检查。

## 安装

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-ios-simulator-helper
```

**DSH Desktop**：`desktop` profile 由 Electron 应用自身管理，在左侧「插件」页里添加 `@zhz8888/dsh-ios-simulator-helper`，再把生成的条目打开即可。重载/重启后表单在 **插件 → 已安装插件 → iOS 模拟器助手**；只有 host 半侧真正提供了该设置命名空间时，表单才会出现。

发布出去的 tarball 里已经包含插件运行所需的一切——host 半侧、浏览器 bundle、随包 skill 与 `locale/` 条目——安装期不编译任何东西，因此不涉及构建授权步骤。`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools` 与 `@deepseek-ai/schemastery` 是 **peer 依赖**，由 DSH 宿主提供：插件不会装第二份，本包自身也**没有任何运行时依赖**。DSH 的兼容性闸门按 `peerDependencies` 里 `@deepseek-ai/dsh*` 的版本区间与运行时版本比对，不匹配会明确拒装。

> 只能挂载一次。`dsh plugin add` 已经把入口写进 `dsh.profile.bundles`；再往 profile 自己的 `cordis.patch.yml` 里加同一行会让同名工具二次注册，并在加载期直接报错。

### 升级与卸载

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-ios-simulator-helper@latest   # 升级
dsh plugin --profile <profile> remove @zhz8888/dsh-ios-simulator-helper      # 卸载
```

设置保存在 profile 里而不是包里，所以这两条命令都不会动它。数据目录（默认 `$DSH_HOME/ios-simulator-helper`）存放截图、构建日志与 DerivedData，卸载不会删除它，是否清理由你决定。

### 版本闸门

DSH 兼容范围是 **`>=0.2.1-rc.2`——只有下界，没有上界**，三处声明逐字一致（`peerDependencies`、`engines.dsh`、`dsh.compatibility.dsh`）：低于下界的运行时会**直接拒绝安装**，同时未来的稳定版都不会被排除。

只有一个 node-semver 细节绕不开：`0.2.2-alpha.1` 这类**新元组的预发布**在 npm/pnpm 的默认规则下不被放行，安装会失败。此时二选一——给范围补一条该元组的分支（`">=0.2.1-rc.2 <0.2.2-0 || >=0.2.2-0"`），或让 pnpm 放宽 peer 校验：

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-ios-simulator-helper \
  --config.strict-peer-dependencies=false
```

稳定版（`0.2.1`、`0.2.2`、`0.3.0`、`1.0.0`…）不受这个细节影响，一律放行。

## 配置页面

配置命名空间 = profile patch 行 id = `ios-simulator-helper`（同时是 `dsh.name`）。表单注册到插件页的 `plugins.bundle.config` 槽、以包名为键，因此渲染在「插件」页该插件的详情页里，而不是「设置」对话框里；只有当 host 半侧提供该命名空间时它才存在。表单通过 `ctx.configForms` 读写，因此暂存编辑、脏值检测、内联校验、乐观并发（revision）与「已覆盖 / 恢复默认」语义都由 harness 提供。详情页负责绘制插件标题、图标与描述；表单本身只贡献一行「改动何时生效」的说明、每个分组一张卡片——卡片描边就是分组之间的分隔，度量取自内置设置页所用的同一套表单套件（`@deepseek-ai/dsh-client-ui-primitives`）——以及底部粘性保存栏。三个超时均以整秒填写，而旧的 `IOS_SIM_*_MS` 环境变量仍按毫秒读取并自动换算。

保存由一条吸附在表单底部的小药丸条负责：有暂存改动、写入进行中或写入失败时出现，状态点旁写明当前状态，并提供 **放弃改动** 与 **保存**（草稿不合法时保存按钮禁用）。只是把控件改回当前生效值的草稿不算改动；写入成功由一条提示条确认，离开页面会放弃未保存的编辑。

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

表单底部是宿主检测与两个按钮/结果区：

- **宿主系统**：页面先用浏览器自身的平台串**同步**判断（因此非 macOS 的浏览器在首屏就能看到提示，不必等请求），再用 host 半侧 `GET /api/ios-simulator-helper/host` 的结论确认；两者冲突时以 host 为准。判定为不支持时——或 host 没有返回、而浏览器自身就是非 macOS 时——页面顶部出现红色提示条：**该插件仅支持 macOS**，并给出检测到的平台名。
- **检测环境** → `GET /api/ios-simulator-helper/status`，返回与 `ios_preflight` 相同的检查项，逐条显示状态、详情与修复建议。
- **刷新模拟器与运行时** → `GET /api/ios-simulator-helper/inventory`，探测 Xcode 路径与版本、macOS 版本、模拟器、运行时与默认目标，用于填充上方字段的建议列表。

### 兼容旧配置

原插件的 `userConfig`（`default_device`、`ui_backend`）与其环境变量 `IOS_SIM_DEFAULT_DEVICE`、`IOS_SIM_UI_BACKEND`、`IOS_SIM_PLUGIN_DATA` 都会作为回落生效（见上表最后一列），因此已有 ZCode / CI 配置无需改动。原插件的 `IOS_SIM_PACKAGE_ROOT` 只用于其 MCP 启动器定位插件自身，DSH 侧由包路径直接解析，不再需要。

## 截图

四张都是 DSH harness 0.2.1-rc.2 里这份代码跑起来的真实页面，按从上到下的滚动顺序排列，没有做图。展示的是「插件」页该插件详情页里的参数表单、1.1.0 的卡片式布局与按整秒填写的超时；保存操作条只在有暂存改动时出现，因此这几张里看不到它。截图时窗口用的是中文界面，卡片标题为中文，字段名两种语言一致。

**1. 模拟器与设备** —— 插件标题与描述，以及每次 `ios_*` 调用都会读取的字段：

![「插件」页里的 iOS 模拟器助手：插件标题、版本与描述，接着是模拟器与设备卡片，含默认设备、默认运行时、自动启动、自动打开窗口与启动超时](https://raw.githubusercontent.com/zhz8888/dsh-ios-simulator-helper/main/assets/settings-page-1-simulator-and-device.png)

**2. UI 自动化与构建** —— `idb` 后端与其超时，接着是 `xcodebuild` 的配置、构建超时与额外参数：

![表单滚动到 UI 自动化与构建分组：UI 后端、idb 可执行文件、UI 操作超时、默认构建配置、构建超时与额外 xcodebuild 参数](https://raw.githubusercontent.com/zhz8888/dsh-ios-simulator-helper/main/assets/settings-page-2-ui-automation-and-build.png)

**3. 构建尾部与日志** —— DerivedData 目录与代码签名开关，接着是 `ios_logs` 的窗口与字符上限，以及输出目录的开头：

![表单继续向下滚动：DerivedData 目录、构建时禁用代码签名，接着是默认日志窗口与默认日志字符上限，以及数据目录与截图目录的开头](https://raw.githubusercontent.com/zhz8888/dsh-ios-simulator-helper/main/assets/settings-page-3-logs-and-output.png)

**4. 输出目录与宿主检测** —— 截图/日志/DerivedData 的落盘位置，然后是 macOS 判定与两个检测按钮：

![表单底部：数据目录与截图目录，以及宿主系统判定为「macOS —— 符合要求（darwin/arm64）」与检测环境、刷新模拟器两个按钮](https://raw.githubusercontent.com/zhz8888/dsh-ios-simulator-helper/main/assets/settings-page-4-host-check.png)

`screenshots.json` 就在仓库里的 `package.json` 旁边按这个顺序列出四张图，插件市场据此展示。

## 工具清单

21 个工具：原插件 20 个名称与参数完全一致，另加 1 个。

| 工具 | 作用 |
|---|---|
| `ios_preflight` | 检查宿主是否 macOS、Xcode/`xcodebuild`/`simctl`、运行时、模拟器与 UI 后端，并回显当前设置 |
| `ios_list_simulators` | 列出 iOS/iPadOS 模拟器与已安装运行时 |
| `ios_boot_simulator` | 启动选定模拟器，可选打开 Simulator 窗口 |
| `ios_show_simulator` | 打开模拟器窗口应用（Xcode 25 及更早为 Simulator.app，Xcode 26 及以后为 Device Hub）并可聚焦指定 UDID |
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
- **`ios_build_and_run` 分四步解析 bundle id**——相对原插件的修正：原插件只问 `xcodebuild -showBuildSettings`，该命令在受限环境里失败后会静默返回 `undefined`，于是构建成功却报「bundle id 无法解析」。本插件的顺序是：显式 `bundleId` 参数 → 刚构建出的 `.app` 的 `CFBundleIdentifier`（用 `plutil` 读取，即 simctl 真正安装的那个值）→ 带 `-derivedDataPath` 的 `-showBuildSettings` → `project.pbxproj` 中发现的标识符，并在结果里用 `bundleIdSource` 说明来源。

## Skill 与斜杠命令

- **`ios-dev` skill**：随包提供（`skills/ios-dev/`），host 半侧通过 `ctx.skills.register()` 注册为嵌入式 skill，skill 目录作为 `resourceBase`。内容已按 DSH 改写：去掉 `mcp__...` 前缀、把环境配置指向插件的配置页面、写明 macOS 前置条件与「用完关闭模拟器」的收尾动作。
- **`/ios-dev [目标]` 命令**：通过 `ctx.commands.register()` 注册。DSH 的用户命令刻意不产生模型消息，因此该命令做一件不依赖模型的事——跑一遍环境诊断，输出结论、失败项与修复建议。

## 与原插件的差异

| 方面 | 原插件（ZCode） | 本插件（DSH） |
|---|---|---|
| 工具暴露 | stdio MCP 服务器 `ios-simulator`，模型看到 `mcp__ios_simulator__*` | 原生 `ctx.tools.register()`，模型看到 `ios_*` |
| 用户配置 | `plugin.json` 的 `userConfig`（2 项），经环境变量注入 | 配置页面 17 字段 + schemastery `Config`，全部 `.volatile()` 实时生效；原环境变量仍作回落 |
| 宿主检查 | 仅 `ios_preflight` 里检查一次 `process.platform` | 中央化的 `requireMacOS()`：每个需要 Apple 工具链的入口都会先拒绝；配置页面同步 + 权威双重判定 |
| 工作目录 | `process.cwd()` | `exec.agent.session.header.cwd`（会话工作区） |
| 数据目录 | `IOS_SIM_PLUGIN_DATA` / 临时目录 | `$DSH_HOME/ios-simulator-helper`，可在配置页面配置 |
| 路径安全 | `inside(cwd, path)` 拒绝逃逸 | 同一语义；另区分「只读路径」（`ios_install_app` 允许绝对路径）与「写入目标」（必须在会话工作区内） |
| 截图返回 | MCP image content（base64） | host 附件引用生成的图像块，失败时退化为文本 + 磁盘路径 |
| 结果归一 | providers 直接返回含 `undefined` 的对象 | 所有工具结果经 `toLosslessJson()` 归一（注册表拒绝 `undefined`） |
| 斜杠命令 | 注入一段提示词给模型 | 直接运行诊断并输出结论 |
| 进程调用 | `node:child_process` 直接 spawn | 保持一致 |

## 已知限制

- **仅支持 macOS**：非 macOS 上 `ios_preflight` 会把 `Host OS (macOS)` 标为失败并跳过其余探测（不做无意义的 spawn）；所有需要 Apple 工具链的工具都会拒绝执行，`ios_discover_project`、`ios_create_app` 与 `ios_ui_status` 仍可正常返回，配置页面顶部常驻提示。
- `idb` 未安装时 `ios_ui_*` 不可用，`ios_ui_status` 会说明原因；`xcodebuildmcp` 只是保留值（与原插件的 `reservedBackends` 一致），尚未实现。
- 原插件的 `ios_build_and_run` 会无条件打开 Simulator 窗口；本插件把它交给 `autoOpenSimulator` 设置（默认开，行为与原插件一致），`ios_build_app` / `ios_screenshot` 仍按原语义不主动开窗。窗口应用在 Xcode 25 及更早是 Simulator.app，在 Xcode 26 及以后是 Device Hub；窗口打不开时只在结果里报告（`opened: false` 与 `openWarning`），不会让 `simctl` 步骤失败。
- `ios_logs` 与原插件一样只做 `log show`（不做实时流），窗口与长度可配置且有上限。
- Swift 宏（`@State`、`#Preview` 等）需要 `swift-plugin-server` 启动 `sandbox-exec`；调用方本身已在沙箱内时这一步会失败，`ios_build_app` 会自动补上 `OTHER_SWIFT_FLAGS=-disable-sandbox` 重试一次，并在结果里标记 `macroSandboxRetry: true`。从未处于沙箱内的调用方不会触发重试。
- 生成工程模板与原插件逐字保留（`project.pbxproj` 为 Xcode 14 兼容格式、`objectVersion = 56`），未跟随新版 Xcode 的模板变化。
- **配置页面只在 DSH Desktop 里做过人工目视确认**：插件装在 `desktop` profile，`assets/` 里那四张按顺序就是最近一次手动检查的界面。暗色主题、窄屏换行与非 macOS 提示条仍只有渲染测试覆盖，没有目视。
- 插件不触碰凭据：不读取、不转发任何含 key/token/secret 的环境变量。

## 版本与发布

每个版本都是同一个提交出现在两处：在 `main` 上打 `vX.Y.Z` tag，并从该 tag 发布到 npm，npm 记录的 `gitHead` 就是这个提交。版本列表见 [Releases](https://github.com/zhz8888/dsh-ios-simulator-helper/releases)——最新为 [`v1.1.3`](https://github.com/zhz8888/dsh-ios-simulator-helper/releases/tag/v1.1.3)（2026-10-20），其前是 [`v1.1.2`](https://github.com/zhz8888/dsh-ios-simulator-helper/releases/tag/v1.1.2)（2026-10-19）、[`v1.1.1`](https://github.com/zhz8888/dsh-ios-simulator-helper/releases/tag/v1.1.1)、[`v1.1.0`](https://github.com/zhz8888/dsh-ios-simulator-helper/releases/tag/v1.1.0) 与 [`v1.0.0`](https://github.com/zhz8888/dsh-ios-simulator-helper/releases/tag/v1.0.0)，后三个版本同为 2026-10-17。

## 参与贡献

问题与 PR 都欢迎提到 [github.com/zhz8888/dsh-ios-simulator-helper](https://github.com/zhz8888/dsh-ios-simulator-helper/issues)。每个改动都要保持 `pnpm check` 全绿——它会跑单元测试、host/client 一致性闸门与真实 Cordis 宿主挂载——没有 CLA，也没有需要填的表单：一个说明改了什么、为什么改的聚焦 PR 就够了。

本包按 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 市场的要求整理。开发规范——命令、不变式、测试、提交与发布规则——见 [AGENTS.md](AGENTS.md)。

## 许可

[MIT](LICENSE)，版权所有 (c) 2026 zhz8888。工具与 provider 逻辑移植自 ZCode 官方 `ios-simulator` 插件（同样以 MIT 分发，版权归 Z.ai），SwiftUI 工程模板逐字保留；完整的来源与版权说明见 [LICENSE](LICENSE) 末尾的归属章节。
