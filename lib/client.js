window.__ModuleLoader__.load({
	id: "@zhz8888/dsh-ios-simulator-helper",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const P = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = React.createElement;

		/**
		 * Browser half of @zhz8888/dsh-ios-simulator-helper: the "iOS Simulator"
		 * settings section.
		 *
		 * The page is a whole navigation section rather than a tab, because the
		 * values it edits are the plugin's own simulator parameters and nothing
		 * else owns them. It registers only while the Host actually serves this
		 * plugin's settings namespace, so a deployment without the host half
		 * shows no trace of the page.
		 *
		 * Everything the user edits goes through the shared config form
		 * (`ctx.configForms.get`): staged edits, invalid-draft detection,
		 * optimistic-concurrency revisions and the write itself are the
		 * harness' behaviour, not reimplemented here.
		 *
		 * The page answers one question before anything else: is this host
		 * macOS? Apple's simulator only exists there, so the answer is read
		 * twice — synchronously from the browser's own platform string, and
		 * authoritatively from the host half's `/host` route — and a non-macOS
		 * host gets a standing notice that this plugin only supports macOS.
		 *
		 * @module @zhz8888/dsh-ios-simulator-helper/client
		 */

		/** Settings namespace = the profile entry id, spelled literally. */
		const NS = "ios-simulator-helper";
		/** Dictionary namespace owned by this page. */
		const LOCALE_NS = "settings.iosSimulatorHelper";
		/** Exact Fetch routes registered by the host half. */
		const HOST_ROUTE = "/api/ios-simulator-helper/host";
		const STATUS_ROUTE = "/api/ios-simulator-helper/status";
		const INVENTORY_ROUTE = "/api/ios-simulator-helper/inventory";

		/** The one platform this plugin works on. */
		const REQUIRED_PLATFORM = "darwin";
		const REQUIRED_PLATFORM_LABEL = "macOS";

		/** CSS ownership tag; the framework reclaims this on unload. */
		const CSS_TAG = "@zhz8888/dsh-ios-simulator-helper/Settings.module.css";

		const CSS = [
			// Page frame. The shell renders the section's nav label but no title of
			// its own, so the page carries one, then a secondary intro. Below that
			// it is one card per category: the card outline is what separates the
			// categories, so no rule is needed between them and each group reads as
			// one block. The metrics are read from the platform's own field kit —
			// `@deepseek-ai/dsh-client-ui-primitives/lib/settings-form/fields.module.css`
			// (MIT), which every built-in settings page uses — so the page sits
			// beside them: a 13/1.5 label, a 12px hint, a 34px control on a 0.5px
			// border-l4 edge. The composition above those pieces is this page's own.
			".ismh_page{flex-direction:column;display:flex;max-width:720px;color:var(--dsw-alias-label-primary)}",
			".ismh_title{margin:0;font-size:16px;font-weight:600;line-height:1.5}",
			".ismh_intro{margin:6px 0 0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}",
			".ismh_alert{margin-top:14px;border:.5px solid var(--dsw-alias-state-error-primary);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);flex-direction:column;gap:4px;padding:10px 14px;display:flex}",
			".ismh_alertTitle{margin:0;font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-state-error-primary)}",
			".ismh_alertBody{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0;font-size:12px;line-height:1.6}",
			".ismh_readOnly{margin:12px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}",
			".ismh_group{margin-top:20px;padding:14px 16px 16px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);flex-direction:column;display:flex}",
			".ismh_groupHead{align-items:baseline;gap:8px;display:flex}",
			".ismh_groupTitle{margin:0;font-size:14px;font-weight:600;line-height:1.5}",
			".ismh_groupHint{color:var(--dsw-alias-label-tertiary);margin:2px 0 4px;font-size:12px;line-height:1.6}",
			".ismh_field{flex-direction:column;gap:6px;display:flex;padding:10px 0;min-width:0}",
			".ismh_head{align-items:center;gap:8px;display:flex;min-width:0}",
			".ismh_label{font-size:13px;font-weight:500;line-height:1.5}",
			".ismh_reset{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);text-decoration:underline;cursor:pointer;background:none;border:0;padding:0}",
			".ismh_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
			".ismh_reset:disabled{cursor:default;opacity:.5}",
			".ismh_control{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);outline:none;padding:0 12px;font-size:13px;line-height:1.5;width:100%}",
			".ismh_control:focus-visible{border-color:var(--dsw-alias-state-business-primary)}",
			".ismh_control[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}",
			".ismh_control:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
			".ismh_short{max-width:200px}",
			".ismh_area{height:auto;min-height:96px;padding:10px 12px;line-height:1.6;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}",
			".ismh_selectWrap{position:relative;display:block}",
			".ismh_selectWrap::after{content:\"\";position:absolute;right:12px;top:calc(50% - 2px);border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--dsw-alias-label-tertiary);pointer-events:none}",
			".ismh_select{appearance:none;cursor:pointer;padding-right:28px}",
			".ismh_hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}",
			".ismh_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.6}",
			".ismh_toolRow{flex-wrap:wrap;align-items:center;gap:10px;display:flex}",
			".ismh_checks{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}",
			".ismh_check{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:flex-start;gap:10px;padding:8px 0;display:flex}",
			".ismh_check:last-child{border-bottom:0}",
			".ismh_checkBody{flex-direction:column;gap:2px;min-width:0;flex:1;display:flex}",
			".ismh_checkName{font-size:13px;line-height:1.5}",
			".ismh_checkDetail{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;white-space:pre-wrap;margin:0;font-size:12px;line-height:1.6}",
			".ismh_checkFix{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));overflow-wrap:anywhere;margin:0;font-size:12px;line-height:1.6}",
			".ismh_verdict{align-items:center;gap:8px;font-size:13px;line-height:1.5;display:flex}",
			".ismh_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.6}",
			".ismh_mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);overflow-wrap:anywhere}",
			// A small pill, not a full-width panel: it hugs its message and buttons and
			// centres itself in the page column with auto margins, so it reads as a
			// floating notice. It is still one in-flow child held at the bottom by
			// `position: sticky`, so it never covers a field and nothing has to
			// reserve room for it.
			".ismh_actions{position:sticky;bottom:16px;z-index:1;box-sizing:border-box;margin:20px auto 0;padding:6px 8px 6px 14px;width:max-content;max-width:min(560px,100%);border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft,0 4px 14px -6px rgba(0,0,0,.2));align-items:center;gap:8px;display:flex}",
			".ismh_actionsText{flex:0 1 auto;min-width:0;margin:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:1.5}",
			".ismh_actionsError .ismh_actionsText{color:var(--dsw-alias-state-error-primary)}",
		].join("");

		/**
		 * Field metadata, mirrored from `lib/settings.js`.
		 *
		 * The browser bundle cannot import a Host module (the client purity gate
		 * forbids cross-plugin value imports), so the descriptors are spelled
		 * here as well. `key`, `kind` and `options` must match the host schema:
		 * the host is what validates and persists, and the client only renders.
		 */
		const GROUPS = [
			{
				id: "target",
				title: { zh: "模拟器与设备", en: "Simulator and device" },
				hint: {
					zh: "选择哪个模拟器，以及需要时是否自动启动并打开模拟器窗口。",
					en: "Which simulator to use, and whether it is booted and shown automatically when needed.",
				},
				fields: [
					{
						key: "defaultDevice",
						kind: "text",
						suggest: "devices",
						placeholder: "iPhone 16",
						label: { zh: "默认设备", en: "Default device" },
						hint: {
							zh: "设备名片段，例如 iPhone 17 或 iPad mini。工具未指定 udid/device 时优先使用；找不到时退回第一个可用的 iPhone。",
							en: "A device-name fragment such as \"iPhone 17\" or \"iPad mini\". Used when a tool names no udid/device; falls back to the first available iPhone.",
						},
					},
					{
						key: "defaultRuntime",
						kind: "text",
						suggest: "runtimes",
						placeholder: "iOS-27",
						label: { zh: "默认运行时", en: "Default runtime" },
						hint: {
							zh: "运行时名片段，例如 iOS-27；留空表示不限运行时。",
							en: "A runtime-name fragment such as \"iOS-27\"; empty matches any runtime.",
						},
					},
					{
						key: "autoBootSimulator",
						kind: "boolean",
						label: { zh: "自动启动模拟器", en: "Boot the simulator automatically" },
						hint: {
							zh: "关闭后，目标模拟器未启动时相关工具会直接报错，而不是替你执行 simctl boot。",
							en: "When off, tools fail instead of running simctl boot when the target simulator is not booted.",
						},
					},
					{
						key: "autoOpenSimulator",
						kind: "boolean",
						label: { zh: "自动打开模拟器窗口", en: "Open the Simulator window automatically" },
						hint: {
							zh: "原插件在启动/显示/打开 URL/构建并运行时默认打开模拟器应用（Simulator.app）；关闭后只做 simctl 操作，不弹出窗口。",
							en: "The original plugin opened Simulator.app for boot/show/open-url/build-and-run; turn this off to stay headless.",
						},
					},
					{
						key: "bootTimeoutSeconds",
						kind: "number",
						label: { zh: "模拟器启动超时（秒）", en: "Simulator boot timeout (seconds)" },
						hint: {
							zh: "单条 simctl boot / bootstatus 命令的最长等待时间，默认 120 秒。",
							en: "Longest wait for one simctl boot / bootstatus command; 120 seconds by default.",
						},
					},
				],
			},
			{
				id: "ui",
				title: { zh: "UI 自动化", en: "UI automation" },
				hint: {
					zh: "ios_ui_tap / swipe / type_text / button / describe 使用的 idb 后端。",
					en: "The idb backend behind ios_ui_tap / swipe / type_text / button / describe.",
				},
				fields: [
					{
						key: "uiBackend",
						kind: "select",
						options: ["auto", "idb", "xcodebuildmcp", "none"],
						// Only the option text is translated; the stored value stays the
						// raw backend id, so switching the UI language never rewrites the
						// saved configuration.
						optionLabels: {
							auto: { zh: "自动探测（推荐）", en: "Auto-detect (recommended)" },
							idb: { zh: "强制使用 idb", en: "Require idb" },
							xcodebuildmcp: { zh: "xcodebuildmcp（尚未实现）", en: "xcodebuildmcp (not implemented)" },
							none: { zh: "关闭 UI 工具", en: "Disable the UI tools" },
						},
						label: { zh: "UI 后端", en: "UI backend" },
						hint: {
							zh: "auto 探测 idb；idb 强制要求 idb；none 关闭 UI 工具；xcodebuildmcp 为保留值，尚未实现。",
							en: "auto probes for idb; idb requires it; none disables the UI tools; xcodebuildmcp is reserved and not implemented.",
						},
					},
					{
						key: "idbBinary",
						kind: "text",
						placeholder: "idb",
						label: { zh: "idb 可执行文件", en: "idb executable" },
						hint: {
							zh: "idb 命令名或绝对路径；PATH 里已有 idb 时保持默认值即可。",
							en: "Command name or absolute path of idb; keep the default when idb is already on PATH.",
						},
					},
					{
						key: "uiTimeoutSeconds",
						kind: "number",
						label: { zh: "UI 操作超时（秒）", en: "UI action timeout (seconds)" },
						hint: {
							zh: "单次 idb UI 命令的最长运行时间，默认 60 秒。",
							en: "Longest runtime of one idb UI command; 60 seconds by default.",
						},
					},
				],
			},
			{
				id: "build",
				title: { zh: "构建与 DerivedData", en: "Build and DerivedData" },
				hint: {
					zh: "xcodebuild 的配置、参数与产物目录。",
					en: "The xcodebuild configuration, its extra arguments, and where products land.",
				},
				fields: [
					{
						key: "defaultConfiguration",
						kind: "text",
						placeholder: "Debug",
						label: { zh: "默认构建配置", en: "Default configuration" },
						hint: {
							zh: "工具未指定 configuration 时使用；原插件同样默认 Debug。",
							en: "Used when a tool names no configuration; the original plugin also defaulted to Debug.",
						},
					},
					{
						key: "buildTimeoutSeconds",
						kind: "number",
						label: { zh: "构建超时（秒）", en: "Build timeout (seconds)" },
						hint: {
							zh: "一次 xcodebuild build 的最长运行时间，默认 600 秒。",
							en: "Longest runtime of one xcodebuild build; 600 seconds by default.",
						},
					},
					{
						key: "extraBuildArgs",
						kind: "multiline",
						placeholder: "-quiet\nARCHS=arm64\nSWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG",
						label: { zh: "额外 xcodebuild 参数", en: "Extra xcodebuild arguments" },
						hint: {
							zh: "每行一个参数，`#` 开头为注释；追加在 -derivedDataPath 之后、build 之前。",
							en: "One argument per line, `#` starts a comment; inserted after -derivedDataPath and before \"build\".",
						},
					},
					{
						key: "derivedDataDir",
						kind: "text",
						placeholder: "<数据目录>/DerivedData",
						label: { zh: "DerivedData 目录", en: "DerivedData directory" },
						hint: {
							zh: "留空时使用数据目录下的 DerivedData/<项目指纹>，与原插件一致。",
							en: "Empty uses `DerivedData/<project fingerprint>` under the data directory, as the original did.",
						},
					},
					{
						key: "disableCodeSigning",
						kind: "boolean",
						label: { zh: "构建时禁用代码签名", en: "Disable code signing while building" },
						hint: {
							zh: "原插件固定传入 CODE_SIGNING_ALLOWED=NO；关闭后交给 Xcode 自己决定。",
							en: "The original always passed CODE_SIGNING_ALLOWED=NO; turn this off to let Xcode decide.",
						},
					},
				],
			},
			{
				id: "logs",
				title: { zh: "日志", en: "Logs" },
				hint: {
					zh: "ios_logs 读取模拟器日志的默认窗口与长度。",
					en: "The window and size ios_logs reads by default.",
				},
				fields: [
					{
						key: "logSeconds",
						kind: "number",
						label: { zh: "默认日志窗口 (秒)", en: "Default log window (seconds)" },
						hint: {
							zh: "ios_logs 未指定 seconds 时读取的最近秒数，最大 3600。",
							en: "Seconds of recent log ios_logs reads when the call names none; capped at 3600.",
						},
					},
					{
						key: "logLimit",
						kind: "number",
						label: { zh: "默认日志字符上限", en: "Default log character limit" },
						hint: {
							zh: "ios_logs 未指定 limit 时返回的最大字符数，避免刷屏。",
							en: "Largest rendered log ios_logs returns when the call names no limit.",
						},
					},
				],
			},
			{
				id: "output",
				title: { zh: "输出目录", en: "Output directories" },
				hint: {
					zh: "截图、构建日志与 DerivedData 的落盘位置。",
					en: "Where screenshots, build logs and DerivedData are written.",
				},
				fields: [
					{
						key: "dataDir",
						kind: "text",
						placeholder: "~/.dsh/ios-simulator-helper",
						label: { zh: "数据目录", en: "Data directory" },
						hint: {
							zh: "截图、日志与 DerivedData 的根目录；留空时使用 $DSH_HOME/ios-simulator-helper，其次 ~/.dsh/ios-simulator-helper。",
							en: "Root for screenshots, logs and DerivedData; empty uses $DSH_HOME/ios-simulator-helper, then ~/.dsh/ios-simulator-helper.",
						},
					},
					{
						key: "screenshotDir",
						kind: "text",
						placeholder: "<数据目录>/screenshots",
						label: { zh: "截图目录", en: "Screenshot directory" },
						hint: {
							zh: "留空时使用数据目录下的 screenshots。",
							en: "Empty uses `screenshots` under the data directory.",
						},
					},
				],
			},
		];

		/** Flat field list, in declaration order. */
		const FIELDS = GROUPS.flatMap((group) => group.fields);

		/**
		 * Detect the host platform from the browser's own signals.
		 *
		 * This is the settings page's *synchronous* answer to "is this macOS?",
		 * available before any request: the simulator workflow needs Apple's
		 * tooling, so a Windows or Linux browser must be told immediately rather
		 * than after a failed fetch. The host half's `/host` route then confirms
		 * or contradicts it, and that verdict wins.
		 *
		 * @param {object|undefined} nav - `navigator`, or undefined when absent.
		 * @returns {{platform: string, label: string, supported: boolean|null}} the verdict;
		 *   `null` means "could not tell", which must not raise a warning.
		 */
		function detectClientPlatform(nav) {
			const raw =
				nav === undefined || nav === null
					? ""
					: String(nav.userAgentData?.platform || nav.platform || nav.userAgent || "");
			if (raw === "") return { platform: "unknown", label: "unknown", supported: null };
			if (/mac/i.test(raw)) return { platform: "darwin", label: "macOS", supported: true };
			if (/iphone|ipad|ipod|ios/i.test(raw)) return { platform: "ios", label: "iOS", supported: false };
			if (/win/i.test(raw)) return { platform: "win32", label: "Windows", supported: false };
			if (/android/i.test(raw)) return { platform: "android", label: "Android", supported: false };
			if (/cros/i.test(raw)) return { platform: "chromeos", label: "ChromeOS", supported: false };
			if (/linux|x11|bsd|sunos/i.test(raw)) return { platform: "linux", label: "Linux", supported: false };
			return { platform: raw, label: raw, supported: null };
		}

		/**
		 * Combine the browser verdict with the host half's authoritative one.
		 *
		 * @param {{platform: string, label: string, supported: boolean|null}} client - the browser verdict.
		 * @param {object|undefined} host - the `/host` payload, when it arrived.
		 * @returns {{supported: boolean|null, platform: string, label: string, source: string,
		 *   requiredLabel: string}} the verdict the page renders.
		 */
		function hostVerdict(client, host) {
			if (host !== undefined && host !== null && typeof host.supported === "boolean") {
				return {
					supported: host.supported,
					platform: host.platform,
					label: host.label ?? host.platform,
					requiredLabel: host.requiredPlatformLabel ?? REQUIRED_PLATFORM_LABEL,
					source: "host",
				};
			}
			return {
				supported: client.supported,
				platform: client.platform,
				label: client.label,
				requiredLabel: REQUIRED_PLATFORM_LABEL,
				source: client.supported === null ? "unknown" : "browser",
			};
		}

		/**
		 * A whole-value field whose draft is the exact text the user typed.
		 *
		 * Used for selects: the control can only produce one of its options, so
		 * every non-empty draft is a valid value and an empty draft clears the
		 * override.
		 */
		function wholeValueField(field) {
			return {
				field,
				format: (value) =>
					typeof value === "string" ? value : value === undefined || value === null ? "" : String(value),
				parse: (text) => {
					const trimmed = text.trim();
					return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
				},
			};
		}

		/**
		 * A non-negative whole-number field.
		 *
		 * Stricter than `settingsNumberField`, which accepts any finite number:
		 * the host schema is `Schema.natural()`, so a negative or fractional
		 * draft would be staged happily and then rejected by the write. Rejecting
		 * it here turns that into an inline message instead of a failed save.
		 */
		function naturalField(field) {
			return {
				field,
				format: (value) => (typeof value === "number" ? String(value) : ""),
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					if (!/^\d+$/.test(trimmed)) return undefined;
					return { kind: "set", value: Number(trimmed) };
				},
			};
		}

		/** A boolean field, staged as the literal `true`/`false` the switch renders. */
		function booleanField(field) {
			return {
				field,
				format: (value) => (value === true ? "true" : "false"),
				parse: (text) => {
					const trimmed = text.trim().toLowerCase();
					if (trimmed === "") return { kind: "clear" };
					if (trimmed === "true" || trimmed === "1") return { kind: "set", value: true };
					if (trimmed === "false" || trimmed === "0") return { kind: "set", value: false };
					return undefined;
				},
			};
		}

		/** The conversion spec for one field descriptor. */
		function specFor(field) {
			switch (field.kind) {
				case "number":
					return naturalField(field.key);
				case "boolean":
					return booleanField(field.key);
				case "select":
					return wholeValueField(field.key);
				case "multiline":
					return P.settingsTextField(field.key);
				default:
					return P.settingsTextField(field.key);
			}
		}

		/** The dictionary keys this page owns, generated from the metadata above. */
		function buildDictionaries() {
			const en = {
				nav: "iOS Simulator",
				title: "iOS Simulator Helper",
				intro:
					"Parameters for the ios_* tools: which simulator to target, how it is booted, how xcodebuild runs, and where captures and logs are written. Changes are saved to this profile and take effect on the next tool call.",
				invalid: "Enter a whole number, or leave blank to use the default.",
				overridden: "Overridden",
				reset: "Reset to default",
				save: "Save",
				saving: "Saving…",
				discard: "Discard changes",
				pendingWrite: "Unsaved changes",
				writeBlocked: "One value is invalid; fix it before saving",
				writeFailed: "These values were not accepted, so they are still staged.",
				written: "Saved to this profile",
				readOnly: "This deployment stores settings read-only.",
				unavailable: "This plugin's settings are not served, so it cannot be configured right now.",
				loading: "Loading saved values…",
				hostChecking: "Checking the host system…",
				hostSupported: "Host system: macOS — supported.",
				hostUnsupportedTitle: "This plugin only supports macOS",
				hostUnsupportedBody:
					"The host reports {platform}, which is not macOS. The iOS Simulator workflow needs Xcode, xcrun simctl and Simulator.app, so every ios_* tool refuses to run here.",
				hostUnknown: "Host system: could not be determined.",
				hostCheckFailed: "The host check request failed",
				toolsTitle: "Host check, diagnostics and discovery",
				toolsHint:
					"The diagnostic runs the same checks as ios_preflight in the app. Discovery refreshes the simulator and runtime suggestions offered by the fields above.",
				runCheck: "Run diagnostic",
				checking: "Checking…",
				refresh: "Refresh simulators and runtimes",
				refreshing: "Refreshing…",
				ready: "iOS Simulator environment: ready.",
				notReady: "iOS Simulator environment: not ready.",
				unsupported: "Unsupported host: no simulator tool can run here.",
				statusFailed: "The diagnostic request failed",
				inventoryFailed: "Discovery failed",
				xcode: "Xcode",
				macOSVersion: "macOS version",
				defaultTarget: "Default target simulator",
				runtimes: "Installed runtimes",
				simulators: "Available simulators",
				none: "none found",
			};
			const zh = {
				nav: "iOS 模拟器",
				title: "iOS 模拟器助手",
				intro:
					"ios_* 工具的运行参数：使用哪个模拟器、如何启动、xcodebuild 如何执行、截图与日志写到哪里。保存后写入当前 profile，并在下一次工具调用时生效。",
				invalid: "请填整数；留空表示使用默认值。",
				overridden: "已覆盖",
				reset: "恢复默认",
				save: "保存",
				saving: "保存中…",
				discard: "放弃改动",
				pendingWrite: "有改动尚未保存",
				writeBlocked: "有取值不合法，修正后才能保存",
				writeFailed: "这批取值未被接受，仍保留在表单里。",
				written: "已保存到当前 profile",
				readOnly: "本部署的设置为只读。",
				unavailable: "该插件的设置当前未被服务，暂时无法配置。",
				loading: "正在读取已保存的值…",
				hostChecking: "正在检测宿主系统…",
				hostSupported: "宿主系统：macOS —— 符合要求。",
				hostUnsupportedTitle: "该插件仅支持 macOS",
				hostUnsupportedBody:
					"当前宿主系统为 {platform}，不是 macOS。iOS 模拟器工作流依赖 Xcode、xcrun simctl 与模拟器应用（Simulator.app），因此所有 ios_* 工具在此系统上都会被拒绝执行。",
				hostUnknown: "宿主系统：无法识别。",
				hostCheckFailed: "宿主系统检测请求失败",
				toolsTitle: "宿主检测、环境检测与探测",
				toolsHint: "检测按钮在应用内运行与 ios_preflight 相同的检查；探测按钮刷新上方字段的模拟器与运行时建议。",
				runCheck: "检测环境",
				checking: "检测中…",
				refresh: "刷新模拟器与运行时",
				refreshing: "刷新中…",
				ready: "iOS 模拟器环境：就绪。",
				notReady: "iOS 模拟器环境：尚未就绪。",
				unsupported: "不支持的宿主系统：这里无法运行任何模拟器工具。",
				statusFailed: "检测请求失败",
				inventoryFailed: "探测失败",
				xcode: "Xcode",
				macOSVersion: "macOS 版本",
				defaultTarget: "默认目标模拟器",
				runtimes: "已安装运行时",
				simulators: "可用模拟器",
				none: "未发现",
			};
			for (const group of GROUPS) {
				en[`group.${group.id}`] = group.title.en;
				en[`group.${group.id}.hint`] = group.hint.en;
				zh[`group.${group.id}`] = group.title.zh;
				zh[`group.${group.id}.hint`] = group.hint.zh;
				for (const field of group.fields) {
					en[`field.${field.key}`] = field.label.en;
					en[`field.${field.key}.hint`] = field.hint.en;
					zh[`field.${field.key}`] = field.label.zh;
					zh[`field.${field.key}.hint`] = field.hint.zh;
					for (const [value, labels] of Object.entries(field.optionLabels ?? {})) {
						en[`option.${field.key}.${value}`] = labels.en;
						zh[`option.${field.key}.${value}`] = labels.zh;
					}
				}
			}
			return { zh, en };
		}

		/**
		 * The option list a select renders.
		 *
		 * A value persisted by an older version, or typed into the profile patch
		 * by hand, is kept visible rather than silently rendering as an empty
		 * selection: the user must be able to see what is stored in order to fix
		 * it.
		 */
		function selectOptions(field, current) {
			if (current === undefined || current === "" || field.options.includes(current)) return field.options;
			return [...field.options, current];
		}

		/**
		 * The display text of one select option.
		 *
		 * Only the label is translated, never the stored value, so a Chinese page
		 * still writes `auto` into the profile. A value kept visible from an older
		 * version has no label and is shown exactly as it is stored.
		 */
		function optionLabel(field, value, t) {
			if (field.optionLabels === undefined || field.optionLabels[value] === undefined) return value;
			return t(`option.${field.key}.${value}`);
		}

		/**
		 * The standing notice a non-macOS host produces.
		 *
		 * @param {object} verdict - {@link hostVerdict} output.
		 * @returns {object|null} `{title, body, platform}` when the host is wrong, else null.
		 */
		function unsupportedNotice(verdict) {
			if (verdict.supported !== false) return null;
			return {
				titleKey: "hostUnsupportedTitle",
				bodyKey: "hostUnsupportedBody",
				platform: verdict.label || verdict.platform,
			};
		}

		/**
		 * One labelled control.
		 *
		 * The chrome (label, hint, invalid message, override badge, reset) is
		 * rebuilt here rather than borrowed from `SettingsValueField`, because that
		 * control only renders a single-line text input and this page needs selects,
		 * switches and textareas to share one frame. The frame is the primitives'
		 * own field shape: the label row, then the control, then the hint.
		 */
		function Field(props) {
			const { field, state, disabled, onChange, onReset, t } = props;
			const id = React.useId();
			const listId = `${id}-options`;
			const suggestions = props.suggestions ?? [];
			const control = renderControl({ field, state, disabled, id, listId, suggestions, onChange, t });
			return h(
				"div",
				{ className: "ismh_field" },
				h(
					"div",
					{ className: "ismh_head" },
					h(
						"label",
						{ className: "ismh_label", htmlFor: field.kind === "boolean" ? undefined : id },
						t(`field.${field.key}`),
					),
					state.overridden ? h(P.Tag, { tone: "outline" }, t("overridden")) : null,
					state.overridden
						? h("button", { type: "button", className: "ismh_reset", onClick: onReset, disabled }, t("reset"))
						: null,
				),
				control,
				state.invalid
					? h("p", { className: "ismh_error", role: "status" }, t("invalid"))
					: h("span", { className: "ismh_hint" }, t(`field.${field.key}.hint`)),
			);
		}

		/** The control element for one field descriptor. */
		function renderControl(input) {
			const { field, state, disabled, id, listId, suggestions, onChange, t } = input;
			switch (field.kind) {
				case "boolean":
					// The switch is its own state indicator: a neighbouring "on"/"off"
					// label would only repeat what the track already shows.
					return h(P.Switch, {
						checked: state.text === "true",
						disabled,
						label: t(`field.${field.key}`),
						onChange: (next) => onChange(next ? "true" : "false"),
					});
				case "select":
					// The chevron is drawn by the wrapper: a native select cannot hold
					// an icon child, and a pseudo-element stays out of the a11y tree.
					return h(
						"div",
						{ className: "ismh_selectWrap" },
						h(
							"select",
							{
								id,
								className: "ismh_control ismh_select",
								value: state.text,
								disabled,
								"aria-invalid": state.invalid ? "true" : undefined,
								onChange: (event) => onChange(event.target.value),
							},
							selectOptions(field, state.text).map((value) =>
								h("option", { key: value === "" ? "__auto__" : value, value }, optionLabel(field, value, t)),
							),
						),
					);
				case "multiline":
					return h("textarea", {
						id,
						className: "ismh_control ismh_area",
						value: state.text,
						rows: 5,
						spellCheck: false,
						placeholder: field.placeholder,
						disabled,
						"aria-invalid": state.invalid ? "true" : undefined,
						onChange: (event) => onChange(event.target.value),
					});
				default:
					// A timeout is three digits wide and does not need the whole column;
					// a path or a device name does.
					return h(
						React.Fragment,
						null,
						h("input", {
							id,
							className: field.kind === "number" ? "ismh_control ismh_short" : "ismh_control",
							type: field.kind === "number" ? "number" : "text",
							inputMode: field.kind === "number" ? "numeric" : undefined,
							value: state.text,
							placeholder: field.placeholder,
							disabled,
							spellCheck: false,
							list: suggestions.length > 0 ? listId : undefined,
							"aria-invalid": state.invalid ? "true" : undefined,
							onChange: (event) => onChange(event.target.value),
						}),
						suggestions.length > 0
							? h(
									"datalist",
									{ id: listId },
									suggestions.map((value) => h("option", { key: value, value })),
								)
							: null,
					);
			}
		}

		/**
		 * The action bar's state for one projection of the form.
		 *
		 * The bar is the only place a save starts, and it exists only while there is
		 * something to act on: a staged edit waiting to be written, a write in
		 * flight, or a failure worth retrying. A clean form answers `null`, which is
		 * what removes the bar from the page — nothing lingers in a hidden state.
		 *
		 * The shape is flat on purpose: the component below only maps it to
		 * elements, so every rule about what may be pressed lives here, in one place.
		 *
		 * @param {{dirty: boolean, invalid: boolean, saving: boolean, failed: boolean}} shell -
		 *   the form-level state the shared model publishes.
		 * @param {Function} t - the page's dictionary lookup.
		 * @returns {{tone: string, message: string, canSave: boolean, canDiscard: boolean}|null}
		 *   the bar state, or `null` when the bar has nothing to say.
		 */
		function actionBarState(shell, t) {
			if (shell.failed) {
				return { tone: "error", message: t("writeFailed"), canDiscard: true, canSave: shell.dirty && !shell.invalid };
			}
			if (shell.saving) return { tone: "pending", message: t("writing"), canDiscard: false, canSave: false };
			if (!shell.dirty) return null;
			if (shell.invalid) return { tone: "error", message: t("writeBlocked"), canDiscard: true, canSave: false };
			return { tone: "pending", message: t("pendingWrite"), canDiscard: true, canSave: true };
		}

		/**
		 * The action bar: the staged form's status plus the two ways out of it.
		 *
		 * A plain element at the end of the page column, kept on screen by the
		 * stylesheet while the page scrolls. Both buttons are the shared `Button`
		 * primitive and the leading mark is the shared `StateDot`, so what it looks
		 * like comes from the platform rather than from this page.
		 *
		 * @param {object} props - the bar state, the form shell and the two actions.
		 * @returns {object|null} the bar, or nothing while the form is clean.
		 */
		function ActionBar(props) {
			const { view, shell, t, onDiscard, onSave } = props;
			if (view === null) return null;
			const failed = view.tone === "error";
			return h(
				"div",
				{ className: failed ? "ismh_actions ismh_actionsError" : "ismh_actions" },
				h(P.StateDot, { state: failed ? "error" : "warning", size: 8 }),
				// The pill is as wide as its content, so a long failure message is
				// truncated; the title attribute keeps the whole sentence reachable.
				h(
					"p",
					{ className: "ismh_actionsText", role: "status", "aria-live": "polite", title: view.message },
					view.message,
				),
				h(
					P.Button,
					{ variant: "ghost", size: "sm", disabled: !view.canDiscard || shell.saving, onClick: onDiscard },
					t("discard"),
				),
				h(
					P.Button,
					{ variant: "primary", size: "sm", disabled: !view.canSave || shell.saving, onClick: onSave },
					shell.saving ? t("saving") : t("save"),
				),
			);
		}

		/**
		 * The transient "written" confirmation.
		 *
		 * The shared `Toast` owns the hold, the fade and the teardown: it reports
		 * completion through `onDone`, which clears the sequence and unmounts it.
		 * Keying the toast by the sequence restarts the cycle when a later write
		 * lands, and a page that has never saved mounts nothing at all.
		 *
		 * @param {object} props - the landed-write counter and the dictionary lookup.
		 * @returns {object|null} the toast, or nothing.
		 */
		function SavedToast(props) {
			const { tick, t } = props;
			const [shown, setShown] = React.useState(0);
			React.useEffect(() => {
				if (tick > 0) setShown(tick);
			}, [tick]);
			if (shown === 0) return null;
			return h(P.Toast, { key: shown, tone: "success", text: t("written"), onDone: () => setShown(0) });
		}

		/** The full settings page. */
		function SettingsPage(props) {
			const state = props.useIosSimulatorSettings((snapshot) => snapshot);
			const { t } = props;
			const host = useRemote(props.loadHost);
			const diagnostics = useRemote(props.loadStatus);
			const inventory = useRemote(props.loadInventory);

			// The authoritative host check runs once on mount; the synchronous
			// browser verdict below already covers the first paint.
			React.useEffect(() => {
				void host.run();
			}, [host.run]);

			const clientPlatform = React.useMemo(
				() => detectClientPlatform(typeof navigator === "undefined" ? undefined : navigator),
				[],
			);
			const verdict = hostVerdict(clientPlatform, host.data);
			const notice = unsupportedNotice(verdict);

			const suggestions = {
				devices: unique((inventory.data?.simulators ?? []).map((item) => item.name)).sort(),
				runtimes: unique((inventory.data?.runtimes ?? []).map((item) => item.name)).sort(),
			};

			// Leaving the page abandons staged edits, exactly as the harness's own
			// settings forms do: the controller outlives the page, so without this a
			// half-finished edit would still be staged on the next visit.
			const discard = React.useRef(props.discard);
			discard.current = props.discard;
			React.useEffect(() => () => discard.current(), []);

			const bar = actionBarState(state, t);

			if (!state.available) {
				return h(
					"div",
					{ className: "ismh_page" },
					h("h2", { className: "ismh_title" }, t("title")),
					h("p", { className: "ismh_intro", role: "status" }, t(state.status === "loading" ? "loading" : "unavailable")),
				);
			}

			return h(
				"div",
				{ className: "ismh_page" },
				h("h2", { className: "ismh_title" }, t("title")),
				h("p", { className: "ismh_intro" }, t("intro")),
				notice === null
					? null
					: h(
							"div",
							{ className: "ismh_alert", role: "alert" },
							h("p", { className: "ismh_alertTitle" }, t(notice.titleKey)),
							h(
								"p",
								{ className: "ismh_alertBody" },
								t(notice.bodyKey, { platform: notice.platform }),
								" ",
								h("code", { className: "ismh_mono" }, `${verdict.platform}`),
							),
						),
				state.writable ? null : h("p", { className: "ismh_readOnly", role: "status" }, t("readOnly")),
				// One card per category: the outline is what separates them, so the
				// categories stay legible without a rule between every block.
				GROUPS.map((group) =>
					h(
						"section",
						{ className: "ismh_group", key: group.id },
						h(
							"div",
							{ className: "ismh_groupHead" },
							h("h3", { className: "ismh_groupTitle" }, t(`group.${group.id}`)),
						),
						h("p", { className: "ismh_groupHint" }, t(`group.${group.id}.hint`)),
						group.fields.map((field) =>
							h(Field, {
								key: field.key,
								field,
								state: state.fields[field.key],
								disabled: !state.writable || state.saving,
								suggestions: field.suggest ? suggestions[field.suggest] : undefined,
								onChange: (text) => props.edit(field.key, text),
								onReset: () => props.resetField(field.key),
								t,
							}),
						),
					),
				),
				h(
					"section",
					{ className: "ismh_group" },
					h("div", { className: "ismh_groupHead" }, h("h3", { className: "ismh_groupTitle" }, t("toolsTitle"))),
					h("p", { className: "ismh_groupHint" }, t("toolsHint")),
					renderHostLine(verdict, host, t),
					h(
						"div",
						{ className: "ismh_toolRow" },
						h(
							P.Button,
							{
								variant: "outline",
								size: "sm",
								disabled: diagnostics.loading,
								onClick: () => void diagnostics.run(),
							},
							diagnostics.loading ? t("checking") : t("runCheck"),
						),
						h(
							P.Button,
							{
								variant: "outline",
								size: "sm",
								disabled: inventory.loading,
								onClick: () => void inventory.run(),
							},
							inventory.loading ? t("refreshing") : t("refresh"),
						),
					),
					renderDiagnostics(diagnostics, t),
					renderInventory(inventory, t),
				),
				h(ActionBar, { view: bar, shell: state, t, onDiscard: props.discard, onSave: props.save }),
				h(SavedToast, { tick: state.savedCount, t }),
			);
		}

		/** The one-line host verdict inside the diagnostics section. */
		function renderHostLine(verdict, host, t) {
			if (host.loading && verdict.source === "unknown") {
				return h("p", { className: "ismh_note", role: "status" }, t("hostChecking"));
			}
			if (host.error !== undefined) {
				return h("p", { className: "ismh_error", role: "status" }, `${t("hostCheckFailed")}: ${host.error}`);
			}
			const text =
				verdict.supported === true
					? `${t("hostSupported")} (${verdict.platform}/${host.data?.arch ?? "?"})`
					: verdict.supported === false
						? `${t("unsupported")} (${verdict.label})`
						: t("hostUnknown");
			return h("p", { className: "ismh_note", "data-host-check": verdict.source }, text);
		}

		/** The diagnostic result list, or nothing before the first run. */
		function renderDiagnostics(diagnostics, t) {
			if (diagnostics.error !== undefined) {
				return h(
					"p",
					{ className: "ismh_error", role: "status" },
					`${t("statusFailed")}: ${diagnostics.error}`,
				);
			}
			const report = diagnostics.data;
			if (report === undefined) return null;
			return h(
				"div",
				{ className: "ismh_group" },
				h(
					"div",
					{ className: "ismh_verdict" },
					h(P.StateDot, { state: report.ok ? "done" : "error" }),
					h("span", null, report.ok ? t("ready") : report.supported === false ? t("unsupported") : t("notReady")),
				),
				h(
					"ul",
					{ className: "ismh_checks" },
					report.checks.map((check) =>
						h(
							"li",
							{ className: "ismh_check", key: check.name },
							h(P.StateDot, { state: check.ok ? "done" : "error", size: 8 }),
							h(
								"div",
								{ className: "ismh_checkBody" },
								h("span", { className: "ismh_checkName" }, check.name),
								h("p", { className: "ismh_checkDetail" }, check.detail),
								check.ok || !check.fix ? null : h("p", { className: "ismh_checkFix" }, check.fix),
							),
						),
					),
				),
			);
		}

		/** The discovery summary, or nothing before the first run. */
		function renderInventory(inventory, t) {
			if (inventory.error !== undefined) {
				return h("p", { className: "ismh_error", role: "status" }, `${t("inventoryFailed")}: ${inventory.error}`);
			}
			const data = inventory.data;
			if (data === undefined) return null;
			const runtimes = data.runtimes ?? [];
			const simulators = data.simulators ?? [];
			return h(
				"div",
				{ className: "ismh_group" },
				h(
					"p",
					{ className: "ismh_checkDetail" },
					`${t("xcode")}: ${data.xcodePath ?? t("none")}${data.xcodeVersion ? ` (${data.xcodeVersion})` : ""}`,
				),
				h("p", { className: "ismh_checkDetail" }, `${t("macOSVersion")}: ${data.macOSVersion ?? t("none")}`),
				h(
					"p",
					{ className: "ismh_checkDetail" },
					`${t("defaultTarget")}: ${data.defaultTarget ? `${data.defaultTarget.name} (${data.defaultTarget.state})` : data.defaultTargetError ?? t("none")}`,
				),
				h(
					"p",
					{ className: "ismh_checkDetail" },
					`${t("runtimes")} (${runtimes.length}): ${runtimes.length === 0 ? t("none") : runtimes.map((item) => item.name).join(", ")}`,
				),
				h(
					"p",
					{ className: "ismh_checkDetail" },
					`${t("simulators")} (${simulators.length}): ${simulators.length === 0 ? t("none") : simulators.map((item) => `${item.name}:${item.state}`).join(", ")}`,
				),
			);
		}

		/**
		 * Fetch-on-demand state for one host route.
		 *
		 * The loader is read through a ref so the returned `run` identity stays
		 * stable across renders: the injected face is rebuilt on every render,
		 * and a `run` that changed identity each time would defeat memoization
		 * deeper in the tree for no benefit.
		 */
		function useRemote(get) {
			const [state, setState] = React.useState({ loading: false, data: undefined, error: undefined });
			const latest = React.useRef(get);
			latest.current = get;
			const run = React.useCallback(async () => {
				setState({ loading: true, data: undefined, error: undefined });
				try {
					const data = await latest.current();
					setState({ loading: false, data, error: undefined });
				} catch (error) {
					setState({ loading: false, data: undefined, error: String(error?.message ?? error) });
				}
			}, []);
			return { ...state, run };
		}

		/** Order-preserving de-duplication for suggestion lists. */
		function unique(items) {
			return [...new Set(items)];
		}

		/** Fetch one JSON host route, failing loudly on a non-2xx answer. */
		async function fetchJson(url) {
			const response = await fetch(url, { headers: { accept: "application/json" } });
			const body = await response.json().catch(() => undefined);
			if (!response.ok) {
				throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
			}
			return body;
		}

		/**
		 * How far one control's text is from the value the Host already serves.
		 *
		 * The shared model stages every keystroke and treats any staged draft as an
		 * edit: its `overridden` means "a save would leave a value in the user
		 * layer", which is right when reviewing a write but wrong for the page's
		 * badge and bar. Flipping a switch back, or retyping the value already in
		 * effect, otherwise left the form dirty and the control flagged as overridden
		 * while a save would write nothing. This classifies the draft by comparing
		 * the value it would write with the one in effect, so the page can present a
		 * control that has not actually changed as unchanged.
		 *
		 * It asks the model rather than the raw snapshot, so a draft staged against
		 * an older baseline is judged by the same value the model's own `stored`
		 * check uses.
		 *
		 * @param {object} model - the bound `SettingsFormModel`.
		 * @param {object} field - the field descriptor.
		 * @param {string} text - the control's current text.
		 * @returns {"noop"|"real"|"invalid"} `noop` when a save would change nothing,
		 *   `invalid` when the draft is not a value the field accepts.
		 */
		function draftDelta(model, field, text) {
			const write = specFor(field).parse(text);
			if (write === undefined) return "invalid";
			if (write.kind === "clear") return model.stored(field.key) ? "real" : "noop";
			return Object.is(write.value, model.sectionValue(field.key)) ? "noop" : "real";
		}

		/**
		 * Own the page's staged form and the face its slot entry injects.
		 *
		 * Mirrors the pattern the shipped settings pages use: the model is built
		 * once per mount over the shared config form, the projection is published
		 * through a snapshot store so the component reads it with a selector, and
		 * disposal releases the subscription.
		 */
		function Controller(scope) {
			this.scope = scope;
			this.model = new P.SettingsFormModel(
				scope,
				FIELDS.map((field) => specFor(field)),
			);
			/** Saves that landed; the page flashes its confirmation when this grows. */
			this.savedCount = 0;
			/** Whether a write was in flight at the last projection. */
			this.saveInFlight = false;
			this.store = this.model.bind(() => this.projection());
		}

		Controller.prototype.projection = function projection() {
			const shell = this.model.shell();
			// The primitive reports its state, not its outcome, so a save that landed
			// is observed as the transition out of "saving" with no failure and no
			// edits left staged. Counting it here keeps the page's confirmation free
			// of timers of its own.
			if (shell.saving) this.saveInFlight = true;
			else if (this.saveInFlight) {
				this.saveInFlight = false;
				if (!shell.failed && !shell.dirty) this.savedCount += 1;
			}
			const snapshot = this.scope.getSnapshot();
			const fields = {};
			let changes = 0;
			for (const field of FIELDS) {
				const state = this.model.field(field.key);
				const delta = draftDelta(this.model, field, state.text);
				if (delta !== "noop") changes += 1;
				fields[field.key] =
					delta === "noop" && state.overridden
						? { ...state, overridden: this.model.stored(field.key) }
						: state;
			}
			return {
				...shell,
				// The model counts any staged draft as dirty, including one that would
				// write the value already in effect; the bar and the save button follow
				// this count instead, so reverting an edit really does clean the form.
				dirty: shell.dirty && changes > 0,
				savedCount: this.savedCount,
				status: snapshot.status,
				fields,
			};
		};

		Controller.prototype.inject = function inject() {
			return {
				hooks: { iosSimulatorSettings: this.store },
				...this.model.actions(),
				loadHost: () => fetchJson(HOST_ROUTE),
				loadStatus: () => fetchJson(STATUS_ROUTE),
				loadInventory: () => fetchJson(INVENTORY_ROUTE),
			};
		};

		Controller.prototype.dispose = function dispose() {
			this.model.dispose();
		};

		/** Required services: the slot registry, the dictionary, and the shared config forms. */
		const inject = ["slots", "locale", "configForms"];

		/**
		 * Mount the iOS Simulator settings section.
		 *
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			const NS_T = LOCALE_NS;
			const t = ctx.locale.bind(NS_T);
			const dictionaries = buildDictionaries();
			ctx.effect(
				() => ctx.locale.register(NS_T, { zh: dictionaries.zh, en: dictionaries.en }),
				"ios-simulator-helper: dictionaries",
			);

			const controller = new Controller(ctx.configForms.get(NS));
			ctx.effect(() => () => controller.dispose(), "ios-simulator-helper: settings form");

			ctx.effect(() => {
				if (typeof document === "undefined") return () => {};
				if (document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG)}]`) !== null) return () => {};
				const tag = document.createElement("style");
				tag.dataset.plugin = "@zhz8888/dsh-ios-simulator-helper";
				tag.dataset.pluginCss = CSS_TAG;
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, "ios-simulator-helper: settings styles");

			ctx.effect(
				() =>
					ctx.configForms.whileServed([NS], () =>
						ctx.slots.inject("settings.section", () =>
							ctx.slots.register(
								{
									name: "settings.section",
									id: "ios-simulator",
									order: 17,
									label: () => t("nav"),
									locale: NS_T,
									inject: () => controller.inject(),
								},
								SettingsPage,
							),
						),
					),
				"ios-simulator-helper: settings page",
			);
		}

		exports.NS = NS;
		/**
		 * Field descriptors as this half sees them.
		 *
		 * Exported for the drift check in `scripts/check-bundle.mjs` only: the
		 * browser cannot import the host's `lib/settings.js`, so the two field
		 * tables are written twice and must be kept identical by construction.
		 * Nothing at runtime reads this.
		 */
		exports.FIELD_META = FIELDS.map((field) => ({
			key: field.key,
			kind: field.kind,
			options: field.options,
			label: field.label.en,
		}));
		/**
		 * The macOS host-check logic, exported for the render test.
		 *
		 * `detectClientPlatform` reads `navigator` synchronously and
		 * `hostVerdict` merges it with the host route's answer, so the
		 * "only supports macOS" decision is a pure function of two inputs and
		 * can be asserted without a browser.
		 */
		exports.HOST_API = { detectClientPlatform, hostVerdict, requiredPlatform: REQUIRED_PLATFORM };
		/**
		 * The action bar's state machine, exported for the render test.
		 *
		 * The bar is the page's only save control, and its states depend on a staged
		 * form the server render cannot drive; asserting the pure function directly
		 * is what keeps every message and button rule pinned.
		 */
		exports.ACTION_BAR_API = { actionBarState };
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
