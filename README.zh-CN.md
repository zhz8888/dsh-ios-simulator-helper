# dsh-ios-simulator-helper

[English](README.md) | [简体中文](README.zh-CN.md)

把 ZCode 官方 `ios-simulator@0.1.0` 插件移植为 **DSH（DeepSeek Harness）原生插件**：原有 20 个 MCP 工具全部保留为 DSH 原生工具，并新增一个完整的 **设置页面**（设置 → iOS 模拟器），让默认设备、运行时、UI 后端、构建参数与输出目录都能在应用里配置，而不是靠环境变量。

- 工具名、参数名与原插件完全一致，为原 MCP 服务器写的工作流可直接迁移；另新增 1 个 `ios_shutdown_simulator`（原插件能启动模拟器却无法停止它）。
- 设置页 5 组 17 个字段，全部实时生效；空值按「设置页 → 原插件环境变量 → 内置默认值」顺序回落。
- 设置页会检测宿主系统：**非 macOS 时直接提示该插件仅支持 macOS**，且所有 `ios_*` 工具都会以一句话拒绝执行，而不是抛出 `spawn xcrun ENOENT`。

## 目录

- [环境要求](#环境要求)
- [安装](#安装)
- [设置页面](#设置页面)
- [工具清单](#工具清单)
- [Skill 与斜杠命令](#skill-与斜杠命令)
- [与原插件的差异](#与原插件的差异)
- [架构](#架构)
- [开发与验证](#开发与验证)
- [已知限制](#已知限制)

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

### 1. 安装依赖

包本身只发布源码与手写的客户端 bundle，运行依赖由 DSH profile 提供。

```bash
cd /path/to/dsh-ios-simulator-helper
pnpm install
```

`@deepseek-ai/schemastery` 是普通依赖；`@deepseek-ai/dsh-tools` 与 `@deepseek-ai/cordis` 声明为 peer 依赖，由宿主提供。DSH 的兼容性闸门按 `peerDependencies` 里 `@deepseek-ai/dsh*` 的版本区间与运行时版本比对，不匹配会明确拒装。

### 2. 装进 profile

**DSH Desktop（本机 GUI）**：`desktop` profile 由 Electron 应用自身管理，请在应用内的**插件管理器**里添加本目录（本地路径安装）。

**CLI / 其他 profile**：

```bash
dsh plugin --profile <profile> add /absolute/path/to/dsh-ios-simulator-helper
```

`package.json` 已声明 `dsh.bundle.patch`，因此安装后 DSH 的 reconcile 会自动把本包追加到 `dsh.profile.bundles`，profile 启动时合并 `cordis.patch.yml`，挂载唯一一行 host 入口。

**手工安装**（没有 CLI 时）：在 profile 目录里把本包作为 `file:` 依赖加入，并把包名追加到 `dsh.profile.bundles`：

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-ios-simulator-helper": "file:/absolute/path/to/dsh-ios-simulator-helper"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "…", "dsh-ios-simulator-helper"]
    }
  }
}
```

```bash
cd ~/.dsh/profiles/<profile> && pnpm install
```

**不要**再手动往 profile 自己的 `cordis.patch.yml` 里加同一行：重复挂载会让同名工具二次注册并在加载期报错，只能二选一。

### 3. 打开设置页

重载/重启后打开 **设置 → iOS 模拟器**。页面在 host 半侧真正提供了该设置命名空间时才会出现；反之不会留下任何痕迹。

## 设置页面

设置命名空间 = profile patch 行 id = `ios-simulator-helper`（同时是 `dsh.name`）。页面通过 `ctx.configForms` 读写，因此具备暂存编辑、脏值检测、内联校验、乐观并发（revision）与「已覆盖/恢复默认」语义。

| 分组 | 设置项 | 类型 | 默认值 | 原插件环境变量回落 | 说明 |
|---|---|---|---|---|---|
| 模拟器与设备 | `defaultDevice` | 文本（建议来自本机模拟器） | `iPhone 16` | `IOS_SIM_DEFAULT_DEVICE` | 设备名片段；工具未指定 `udid`/`device` 时优先使用，找不到时退回第一个可用 iPhone |
| | `defaultRuntime` | 文本（建议来自已装运行时） | 空 | `IOS_SIM_DEFAULT_RUNTIME` | 运行时名片段，例如 `iOS-27`；留空不限运行时。**偏好而非要求**：值过期时自动放宽而不是报错 |
| | `autoBootSimulator` | 开关 | 开 | `IOS_SIM_AUTO_BOOT` | 关闭后，目标未启动时直接报错，不替你执行 `simctl boot` |
| | `autoOpenSimulator` | 开关 | 开 | `IOS_SIM_AUTO_OPEN` | 与原插件一致地打开 Simulator 窗口（启动/显示/打开 URL/构建并运行）；关闭后只做 `simctl` 操作 |
| | `bootTimeoutMs` | 整数 | `120000` | `IOS_SIM_BOOT_TIMEOUT_MS` | 单条 `simctl boot` / `bootstatus` 的最长等待 |
| UI 自动化 | `uiBackend` | 下拉 | `auto` | `IOS_SIM_UI_BACKEND` | `auto` 探测 idb；`idb` 强制要求；`none` 关闭 UI 工具；`xcodebuildmcp` 为保留值 |
| | `idbBinary` | 文本 | `idb` | `IOS_SIM_IDB_BINARY` | idb 命令名或绝对路径 |
| | `uiTimeoutMs` | 整数 | `60000` | `IOS_SIM_UI_TIMEOUT_MS` | 单次 idb UI 命令的最长运行时间 |
| 构建与 DerivedData | `defaultConfiguration` | 文本 | `Debug` | `IOS_SIM_CONFIGURATION` | 工具未指定 `configuration` 时使用 |
| | `buildTimeoutMs` | 整数 | `600000` | `IOS_SIM_BUILD_TIMEOUT_MS` | 一次 `xcodebuild build` 的最长运行时间 |
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
├── cordis.patch.yml        # - insert: [{ id: ios-simulator-helper, name: 'dsh-ios-simulator-helper' }]
├── ios.svg                 # 插件图标：iOS 字标，沿用原版取色，深色模式自适应反色
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

三个约束决定了上面的形状：

1. **设置命名空间只有一个真相来源**：profile patch 行 id。`cordis.patch.yml` 的 `id`、`lib/settings.js` 的 `SETTINGS_NAMESPACE`、`lib/client.js` 的字面量必须一致；`scripts/check-bundle.mjs` 会校验它们，也会校验 host 与 client 两份字段表无漂移、三个路由两侧一致、macOS 判定逻辑仍在。
2. **browser bundle 不能 import host 模块**（客户端纯度闸门禁止跨插件值导入），因此字段表被写了两遍，靠闸门保持一致；bundle 只能 `require` 宿主的 9 个静态模块（React、Cordis、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit` 等）。
3. **平台检查中央化**：`lib/providers/host.js` 的 `hostInfo()` / `requireMacOS()` 是唯一读取 `process.platform` 语义的地方，且平台是可注入参数，因此非 macOS 分支可以在 macOS 上被测试。

## 开发与验证

```bash
pnpm install                  # schemastery + react/react-dom（测试用）
pnpm test                     # 80 个测试（不需要 Xcode，不需要模拟器）
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

## 已知限制

- **仅支持 macOS**：非 macOS 上 `ios_preflight` 会把 `Host OS (macOS)` 标为失败并跳过其余探测（不做无意义的 spawn），所有 `ios_*` 工具直接拒绝；设置页顶部常驻提示。
- `idb` 未安装时 `ios_ui_*` 不可用，`ios_ui_status` 会说明原因；`xcodebuildmcp` 只是保留值（与原插件的 `reservedBackends` 一致），尚未实现。
- 原插件的 `ios_build_and_run` 会无条件打开 Simulator 窗口；本插件把它交给 `autoOpenSimulator` 设置（默认开，行为与原插件一致），`ios_build_app` / `ios_screenshot` 仍按原语义不主动开窗。
- `ios_logs` 与原插件一样只做 `log show`（不做实时流），窗口与长度可配置且有上限。
- Swift 宏（`@State`、`#Preview` 等）需要 `swift-plugin-server` 启动 `sandbox-exec`；**在沙箱内调用本插件时这类工程无法编译**（真机集成测试因此提供 `--no-macros`）。DSH 宿主半侧的代码运行在 bash 沙箱之外，正常使用不受影响。
- 生成工程模板与原插件逐字保留（`project.pbxproj` 为 Xcode 14 兼容格式、`objectVersion = 56`），未跟随新版 Xcode 的模板变化。
- **设置页尚未在真实 GUI 中人工目视确认**：交付方式为「只交付包 + 安装说明」，未写入你正在使用的 profile。渲染层已由真实 React 服务端渲染测试覆盖，但视觉细节（间距、暗色主题、窄屏换行）需要装上后自行核对。
- `@deepseek-ai/dsh-client-ui-primitives` 是浏览器打包产物（依赖 `*.module.css`、`simple-icons`、`zustand/vanilla`），Node 无法直接 import，因此渲染测试对该包使用忠实替身；真实 React 与 `react-dom/server` 仍是真件。
- 插件不触碰凭据：不读取、不转发任何含 key/token/secret 的环境变量。

## 许可

[MIT](LICENSE)，版权所有 (c) 2026 zhz8888。

工具与 provider 逻辑移植自 ZCode 官方 `ios-simulator` 插件（同样以 MIT 分发，版权归 Z.ai），
SwiftUI 工程模板逐字保留；完整的来源与版权说明见 [LICENSE](LICENSE) 末尾的归属章节。
