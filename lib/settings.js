import z from '@deepseek-ai/schemastery'

/**
 * The plugin's live-editable configuration.
 *
 * `@deepseek-ai/dsh-settings` projects one form per profile entry from the
 * entry's own `Config`. Every field this plugin wants a user to edit must be
 * marked `.volatile()`: the marker is what makes the value a live reference
 * that is re-read on each use instead of being frozen into the entry at mount
 * time, and it is also what the settings service projects into its form.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/settings
 */

/**
 * The kind of control the configuration page renders for a field.
 *
 * The kind decides both the control and the value's type, so the two are
 * declared together: a `boolean` field carries a boolean default, a `number`
 * field a number, and a text-like field a string.
 *
 * @typedef {'text' | 'multiline' | 'number' | 'boolean' | 'select'} FieldKind
 */

/**
 * One label or hint in both languages.
 *
 * @typedef {{zh: string, en: string}} LocalizedText
 */

/**
 * The metadata every field carries, whatever its kind.
 *
 * @typedef {object} FieldMetaBase
 * @property {string} key - the settings key; also the schema key and the client field key.
 * @property {string} [env] - the legacy environment variable that configures the same value.
 * @property {string} [placeholder] - the placeholder the configuration page shows.
 * @property {LocalizedText} label - the field label.
 * @property {LocalizedText} [hint] - the field hint.
 */

/**
 * A free-text field.
 *
 * @typedef {FieldMetaBase & {kind: 'text' | 'multiline', default: string}} TextFieldMeta
 */

/**
 * A numeric field.
 *
 * @typedef {FieldMetaBase & {kind: 'number', default: number, envUnit?: 'ms', min?: number, max?: number}} NumberFieldMeta
 */

/**
 * A boolean field.
 *
 * @typedef {FieldMetaBase & {kind: 'boolean', default: boolean}} BooleanFieldMeta
 */

/**
 * A field the user picks from a fixed list.
 *
 * @typedef {FieldMetaBase & {kind: 'select', default: string, options: readonly string[]}} SelectFieldMeta
 */

/**
 * One field of the configuration page.
 *
 * The union is discriminated on `kind`, so the `default` a field carries is
 * narrowed with it: a `boolean` field's default is a boolean, a `number`
 * field's is a number, and a text or select field's is a string.
 *
 * @typedef {TextFieldMeta | NumberFieldMeta | BooleanFieldMeta | SelectFieldMeta} FieldMeta
 */

/**
 * One group of fields on the configuration page.
 *
 * @typedef {object} FieldGroup
 * @property {string} id - the group id, also the dictionary namespace prefix.
 * @property {LocalizedText} title - the group title.
 * @property {LocalizedText} [hint] - the group hint.
 * @property {FieldMeta[]} fields - the group's fields, in page order.
 */

/**
 * The UI automation backends the `uiBackend` setting accepts.
 *
 * @typedef {'auto' | 'idb' | 'xcodebuildmcp' | 'none'} UIBackend
 */

/**
 * The 17 live settings, as {@link readSettings} projects them.
 *
 * This interface is written by hand rather than derived from the schemastery
 * schema, because schemastery widens every object to `Record<string, any>`:
 * a derived type would accept a key nobody declared, which is exactly the
 * mistake this interface exists to catch. Eleven places in this plugin read a
 * setting, and a key renamed at the table would leave every one of them
 * reading `undefined` — a timeout that collapses to a millisecond, or a UI
 * backend the user switched off coming back on.
 *
 * `readSettings` fills one key per field of {@link FIELD_GROUPS}, so the two
 * declarations describe the same set; `test/settings.test.js` pins the
 * defaults, and `scripts/check-bundle.mjs` pins the key set against the
 * configuration page.
 *
 * @typedef {object} Settings
 * @property {string} defaultDevice - device-name fragment used when a tool names no device.
 * @property {string} defaultRuntime - runtime-name fragment used when a tool names no runtime.
 * @property {boolean} autoBootSimulator - whether a tool may boot the simulator on demand.
 * @property {boolean} autoOpenSimulator - whether a tool may open the simulator window.
 * @property {number} bootTimeoutSeconds - longest wait for one `simctl boot` command.
 * @property {UIBackend} uiBackend - the UI automation backend.
 * @property {string} idbBinary - the `idb` executable the UI backend runs.
 * @property {number} uiTimeoutSeconds - longest wait for one `idb` command.
 * @property {string} defaultConfiguration - the Xcode configuration a build uses.
 * @property {number} buildTimeoutSeconds - longest wait for one `xcodebuild` command.
 * @property {string} extraBuildArgs - extra `xcodebuild` arguments, one per line.
 * @property {string} derivedDataDir - DerivedData root, relative to the workspace when set.
 * @property {boolean} disableCodeSigning - whether builds pass `CODE_SIGNING_ALLOWED=NO`.
 * @property {number} logSeconds - longest wait for one log query.
 * @property {number} logLimit - how many log lines one call returns.
 * @property {string} dataDir - the plugin's data root, relative to the workspace when set.
 * @property {string} screenshotDir - the screenshot root, relative to the workspace when set.
 */

/**
 * Settings namespace = the `cordis.patch.yml` insert row id = the id the DSH
 * settings service keys this plugin's form by. The browser half spells this
 * same string literally (a client package must not import a host package), so
 * the three places must move together.
 */
export const SETTINGS_NAMESPACE = 'ios-simulator-helper'

/**
 * UI automation backends accepted by the `uiBackend` setting.
 *
 * The original plugin declared the same four values in its `userConfig` and
 * only ever implemented `idb`; `auto` probes for `idb`, `none` disables the
 * `ios_ui_*` tools, and `xcodebuildmcp` stays reserved so a future backend can
 * take the slot without changing the setting.
 */
export const UI_BACKENDS = /** @type {const} */ (['auto', 'idb', 'xcodebuildmcp', 'none'])

/**
 * Every user-editable field, in the order the configuration page groups them.
 *
 * Each entry carries the metadata both halves need: the host builds the
 * schemastery schema from it, and the same metadata is mirrored in
 * `lib/client.js` to render the controls. `env` names the environment variable
 * the original ZCode plugin read for that value (`IOS_SIM_*`), so an existing
 * CI or MCP configuration keeps working without touching the configuration page.
 */
export const FIELD_GROUPS = /** @type {FieldGroup[]} */ ([
  {
    id: 'target',
    title: { zh: '模拟器与设备', en: 'Simulator and device' },
    hint: {
      zh: '选择哪个模拟器，以及需要时是否自动启动并打开模拟器窗口。',
      en: 'Which simulator to use, and whether it is booted and shown automatically when needed.',
    },
    fields: [
      {
        key: 'defaultDevice',
        kind: 'text',
        env: 'IOS_SIM_DEFAULT_DEVICE',
        default: 'iPhone 16',
        placeholder: 'iPhone 16',
        label: { zh: '默认设备', en: 'Default device' },
        hint: {
          zh: '设备名片段，例如 iPhone 17 或 iPad mini。工具未指定 udid/device 时优先使用；找不到时退回第一个可用的 iPhone。',
          en: 'A device-name fragment such as "iPhone 17" or "iPad mini". Used when a tool names no udid/device; falls back to the first available iPhone.',
        },
      },
      {
        key: 'defaultRuntime',
        kind: 'text',
        env: 'IOS_SIM_DEFAULT_RUNTIME',
        default: '',
        placeholder: 'iOS-27',
        label: { zh: '默认运行时', en: 'Default runtime' },
        hint: {
          zh: '运行时名片段，例如 iOS-27；留空表示不限运行时。',
          en: 'A runtime-name fragment such as "iOS-27"; empty matches any runtime.',
        },
      },
      {
        key: 'autoBootSimulator',
        kind: 'boolean',
        env: 'IOS_SIM_AUTO_BOOT',
        default: true,
        label: { zh: '自动启动模拟器', en: 'Boot the simulator automatically' },
        hint: {
          zh: '关闭后，目标模拟器未启动时相关工具会直接报错，而不是替你执行 simctl boot。',
          en: 'When off, tools fail instead of running simctl boot when the target simulator is not booted.',
        },
      },
      {
        key: 'autoOpenSimulator',
        kind: 'boolean',
        env: 'IOS_SIM_AUTO_OPEN',
        default: true,
        label: { zh: '自动打开模拟器窗口', en: 'Open the Simulator window automatically' },
        hint: {
          zh: '在启动/显示/打开 URL/构建并运行时打开模拟器窗口应用：Xcode 25 及更早为 Simulator.app，Xcode 26 及以后为 Device Hub。窗口打不开不会让 simctl 操作失败；关闭本项则完全不弹窗。',
          en: 'Open the simulator window app for boot/show/open-url/build-and-run: Simulator.app on Xcode 25 and earlier, Device Hub on Xcode 26 and later. A window that cannot open never fails the simctl work; turn this off to stay headless.',
        },
      },
      {
        key: 'bootTimeoutSeconds',
        kind: 'number',
        env: 'IOS_SIM_BOOT_TIMEOUT_MS',
        // The setting is stored in seconds, but the legacy variable keeps its
        // original millisecond spelling; `envUnit` is what converts it.
        envUnit: 'ms',
        default: 120,
        label: { zh: '模拟器启动超时（秒）', en: 'Simulator boot timeout (seconds)' },
        hint: {
          zh: '单条 simctl boot / bootstatus 命令的最长等待时间，默认 120 秒。',
          en: 'Longest wait for one simctl boot / bootstatus command; 120 seconds by default.',
        },
      },
    ],
  },
  {
    id: 'ui',
    title: { zh: 'UI 自动化', en: 'UI automation' },
    hint: {
      zh: 'ios_ui_tap / swipe / type_text / button / describe 使用的 idb 后端。',
      en: 'The idb backend behind ios_ui_tap / swipe / type_text / button / describe.',
    },
    fields: [
      {
        key: 'uiBackend',
        kind: 'select',
        env: 'IOS_SIM_UI_BACKEND',
        default: 'auto',
        options: UI_BACKENDS,
        label: { zh: 'UI 后端', en: 'UI backend' },
        hint: {
          zh: 'auto 探测 idb；idb 强制要求 idb；none 关闭 UI 工具；xcodebuildmcp 为保留值，尚未实现。',
          en: 'auto probes for idb; idb requires it; none disables the UI tools; xcodebuildmcp is reserved and not implemented.',
        },
      },
      {
        key: 'idbBinary',
        kind: 'text',
        env: 'IOS_SIM_IDB_BINARY',
        default: 'idb',
        placeholder: 'idb',
        label: { zh: 'idb 可执行文件', en: 'idb executable' },
        hint: {
          zh: 'idb 命令名或绝对路径；PATH 里已有 idb 时保持默认值即可。',
          en: 'Command name or absolute path of idb; keep the default when idb is already on PATH.',
        },
      },
      {
        key: 'uiTimeoutSeconds',
        kind: 'number',
        env: 'IOS_SIM_UI_TIMEOUT_MS',
        envUnit: 'ms',
        default: 60,
        label: { zh: 'UI 操作超时（秒）', en: 'UI action timeout (seconds)' },
        hint: {
          zh: '单次 idb UI 命令的最长运行时间，默认 60 秒。',
          en: 'Longest runtime of one idb UI command; 60 seconds by default.',
        },
      },
    ],
  },
  {
    id: 'build',
    title: { zh: '构建与 DerivedData', en: 'Build and DerivedData' },
    hint: {
      zh: 'xcodebuild 的配置、参数与产物目录。',
      en: 'The xcodebuild configuration, its extra arguments, and where products land.',
    },
    fields: [
      {
        key: 'defaultConfiguration',
        kind: 'text',
        env: 'IOS_SIM_CONFIGURATION',
        default: 'Debug',
        placeholder: 'Debug',
        label: { zh: '默认构建配置', en: 'Default configuration' },
        hint: {
          zh: '工具未指定 configuration 时使用；原插件同样默认 Debug。',
          en: 'Used when a tool names no configuration; the original plugin also defaulted to Debug.',
        },
      },
      {
        key: 'buildTimeoutSeconds',
        kind: 'number',
        env: 'IOS_SIM_BUILD_TIMEOUT_MS',
        envUnit: 'ms',
        default: 600,
        label: { zh: '构建超时（秒）', en: 'Build timeout (seconds)' },
        hint: {
          zh: '一次 xcodebuild build 的最长运行时间，默认 600 秒。',
          en: 'Longest runtime of one xcodebuild build; 600 seconds by default.',
        },
      },
      {
        key: 'extraBuildArgs',
        kind: 'multiline',
        env: 'IOS_SIM_EXTRA_BUILD_ARGS',
        default: '',
        placeholder: '-quiet\nARCHS=arm64\nSWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG',
        label: { zh: '额外 xcodebuild 参数', en: 'Extra xcodebuild arguments' },
        hint: {
          zh: '每行一个参数，`#` 开头为注释；追加在 -derivedDataPath 之后、build 之前。',
          en: 'One argument per line, `#` starts a comment; inserted after -derivedDataPath and before "build".',
        },
      },
      {
        key: 'derivedDataDir',
        kind: 'text',
        env: 'IOS_SIM_DERIVED_DATA_DIR',
        default: '',
        placeholder: '<数据目录>/DerivedData',
        label: { zh: 'DerivedData 目录', en: 'DerivedData directory' },
        hint: {
          zh: '留空时使用数据目录下的 DerivedData/<项目指纹>，与原插件一致。',
          en: 'Empty uses `DerivedData/<project fingerprint>` under the data directory, as the original did.',
        },
      },
      {
        key: 'disableCodeSigning',
        kind: 'boolean',
        env: 'IOS_SIM_DISABLE_CODE_SIGNING',
        default: true,
        label: { zh: '构建时禁用代码签名', en: 'Disable code signing while building' },
        hint: {
          zh: '原插件固定传入 CODE_SIGNING_ALLOWED=NO；关闭后交给 Xcode 自己决定。',
          en: 'The original always passed CODE_SIGNING_ALLOWED=NO; turn this off to let Xcode decide.',
        },
      },
    ],
  },
  {
    id: 'logs',
    title: { zh: '日志', en: 'Logs' },
    hint: { zh: 'ios_logs 读取模拟器日志的默认窗口与长度。', en: 'The window and size ios_logs reads by default.' },
    fields: [
      {
        key: 'logSeconds',
        kind: 'number',
        env: 'IOS_SIM_LOG_SECONDS',
        default: 120,
        max: 3600,
        label: { zh: '默认日志窗口 (秒)', en: 'Default log window (seconds)' },
        hint: {
          zh: 'ios_logs 未指定 seconds 时读取的最近秒数，最大 3600。',
          en: 'Seconds of recent log ios_logs reads when the call names none; capped at 3600.',
        },
      },
      {
        key: 'logLimit',
        kind: 'number',
        env: 'IOS_SIM_LOG_LIMIT',
        default: 20000,
        min: 1000,
        max: 20000,
        label: { zh: '默认日志字符上限', en: 'Default log character limit' },
        hint: {
          zh: 'ios_logs 未指定 limit 时返回的最大字符数，避免刷屏。',
          en: 'Largest rendered log ios_logs returns when the call names no limit.',
        },
      },
    ],
  },
  {
    id: 'output',
    title: { zh: '输出目录', en: 'Output directories' },
    hint: {
      zh: '截图、构建日志与 DerivedData 的落盘位置。',
      en: 'Where screenshots, build logs and DerivedData are written.',
    },
    fields: [
      {
        key: 'dataDir',
        kind: 'text',
        env: 'IOS_SIM_PLUGIN_DATA',
        default: '',
        placeholder: '~/.dsh/ios-simulator-helper',
        label: { zh: '数据目录', en: 'Data directory' },
        hint: {
          zh: '截图、日志与 DerivedData 的根目录；留空时使用 $DSH_HOME/ios-simulator-helper，其次 ~/.dsh/ios-simulator-helper。',
          en: 'Root for screenshots, logs and DerivedData; empty uses $DSH_HOME/ios-simulator-helper, then ~/.dsh/ios-simulator-helper.',
        },
      },
      {
        key: 'screenshotDir',
        kind: 'text',
        env: 'IOS_SIM_SCREENSHOT_DIR',
        default: '',
        placeholder: '<数据目录>/screenshots',
        label: { zh: '截图目录', en: 'Screenshot directory' },
        hint: { zh: '留空时使用数据目录下的 screenshots。', en: 'Empty uses `screenshots` under the data directory.' },
      },
    ],
  },
])

/** Flat `key -> field descriptor` view of {@link FIELD_GROUPS}. */
export const FIELDS = /** @type {Map<string, FieldMeta>} */ (
  new Map(FIELD_GROUPS.flatMap((group) => group.fields.map((field) => [field.key, field])))
)

/** Every field key, in declaration order. */
export const FIELD_KEYS = [...FIELDS.keys()]

/**
 * The three schemastery node shapes this module builds.
 *
 * The package does not export its `Schema` type alias, so each shape is
 * derived from the factory that produces it. The mode matters and moves twice:
 * a node is `plain` when it is created, `defined` once it carries a default,
 * and `volatile-defined` once it is made live.
 *
 * @typedef {ReturnType<ReturnType<typeof z.boolean>['default']>} BooleanDraft
 * @typedef {ReturnType<ReturnType<typeof z.natural>['default']>} NumberDraft
 * @typedef {ReturnType<ReturnType<typeof z.string>['default']>} StringDraft
 * @typedef {ReturnType<BooleanDraft['volatile']>} BooleanNode
 * @typedef {ReturnType<NumberDraft['volatile']>} NumberNode
 * @typedef {ReturnType<StringDraft['volatile']>} StringNode
 */

/**
 * Build the schemastery node for one field descriptor.
 *
 * The node is built per kind rather than through one variable, because the
 * three node types have different value types and a single variable would be
 * a union whose `default()` cannot be called. The field's own `kind` decides
 * which one, so the default that is passed along is always the right type.
 *
 * @param {FieldMeta} field - the field to describe.
 * @returns {BooleanNode | NumberNode | StringNode} the node.
 */
function schemaFor(field) {
  switch (field.kind) {
    case 'boolean':
      return describe(z.boolean().default(field.default), field).volatile()
    case 'number':
      // A timeout or a limit of zero is not a usable value: the schema refuses
      // it here, so the configuration page never stores a number that
      // {@link readSettings} would silently replace with the default. Declared
      // maxima are *not* schema constraints: a value written by an older build
      // (or by hand) must not make the plugin fail to mount. The projection
      // clamps it and the browser half refuses to stage a new one outside the
      // range.
      return describe(z.natural().min(1).default(field.default), field).volatile()
    default:
      return describe(z.string().default(field.default), field).volatile()
  }
}

/**
 * Attach the field's description to a node.
 *
 * The description is the field's **English** hint. The configuration page
 * carries its own bilingual label/hint pair (the browser half mirrors both
 * languages), so the host schema is the only free-text metadata a model can
 * read — and the repository's code language is English. Publishing the Chinese
 * copy here instead would put a language the source does not use in front of
 * every consumer of the schema, while the page still shows both.
 *
 * `.volatile()` is what makes the value live: DSH stores the reference and
 * the plugin re-reads `.get()` on every call, so a settings save reaches the
 * next tool invocation without remounting the entry. It is applied by the
 * caller, because it changes the node's mode and therefore its type.
 *
 * @param {BooleanDraft | NumberDraft | StringDraft} node - the node to describe.
 * @param {FieldMeta} field - the field the node describes.
 * @returns {BooleanDraft | NumberDraft | StringDraft} the described node.
 */
function describe(node, field) {
  const description = field.hint?.en
  return description ? node.description(description) : node
}

/**
 * The plugin's `Config` export.
 *
 * One volatile node per field, so every field is both persisted as a normal
 * Cordis patch value and re-read live by {@link readSettings}.
 */
export const Config = z.object(Object.fromEntries([...FIELDS].map(([key, field]) => [key, schemaFor(field)])))

/**
 * Unwrap a live (volatile) reference, a plain value, or a missing field.
 *
 * @param {unknown} node - the stored value, which may be a live reference.
 * @param {unknown} fallback - the value to use when the node holds nothing usable.
 * @returns {unknown} the live value, or the fallback.
 */
function liveValue(node, fallback) {
  if (node === undefined || node === null) return fallback
  if (typeof node === 'object' && typeof /** @type {{get?: unknown}} */ (node).get === 'function') {
    const value = /** @type {{get: () => unknown}} */ (node).get()
    return value === undefined || value === null ? fallback : value
  }
  return node
}

/**
 * Coerce one setting to a non-empty trimmed string, else `undefined`.
 *
 * @param {unknown} value - the raw value.
 * @returns {string | undefined} the trimmed string, or `undefined`.
 */
function stringFrom(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Clamp one projected number to the range its field declares.
 *
 * This is the per-call projection, not a constraint on what the profile may
 * hold. The stored value is left exactly as it was written, because a value
 * written by an older build (or by hand) must not make the plugin fail to
 * mount — the schema deliberately declares no upper bound. The browser half
 * refuses to *stage* a new value outside the range, so the page and the
 * provider can differ only for a value that was already stored.
 *
 * @param {number} value - the value to clamp.
 * @param {NumberFieldMeta} field - the field that declares the range.
 * @returns {number} the value inside the declared range.
 */
function clampNumber(value, field) {
  const lower = field.min ?? 1
  const upper = field.max
  return upper === undefined ? Math.max(lower, value) : Math.min(upper, Math.max(lower, value))
}

/**
 * Coerce one setting to a positive integer, else `undefined`.
 *
 * @param {unknown} value - the raw value.
 * @returns {number | undefined} the positive integer, or `undefined`.
 */
function positiveIntFrom(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Convert a legacy `IOS_SIM_*_MS` value into the seconds the setting stores.
 *
 * The three timeout fields moved from milliseconds to seconds so the settings
 * page reads `120` instead of `120000`, but the environment variables keep the
 * original plugin's spelling. Reading them as milliseconds is what lets an
 * existing CI or MCP configuration keep working untouched; rounding to the
 * nearest second (and never below one) matches the `z.natural()` schema.
 *
 * @param {unknown} value - the raw environment value, in milliseconds.
 * @returns {number|undefined} whole seconds, or `undefined` when unusable.
 */
function secondsFromMilliseconds(value) {
  const ms = positiveIntFrom(value)
  return ms === undefined ? undefined : Math.max(1, Math.round(ms / 1000))
}

/**
 * Coerce one setting to a boolean, else `undefined`.
 *
 * Booleans also come from the environment (`IOS_SIM_AUTO_BOOT=0`), so the usual
 * shell spellings are accepted rather than only `true`/`false`.
 *
 * @param {unknown} value - the raw value.
 * @returns {boolean | undefined} the boolean, or `undefined`.
 */
function booleanFrom(value) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const text = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(text)) return true
  if (['0', 'false', 'no', 'off'].includes(text)) return false
  return undefined
}

/**
 * Project the entry's live config into plain values for one call.
 *
 * Called once per tool invocation, so a value saved in the configuration page is
 * visible to the very next call. Empty text fields fall back to the historical
 * environment variable, then to the declared default, mirroring the ZCode
 * plugin's `userConfig` and `IOS_SIM_*` environment behaviour.
 *
 * @param {Record<string, unknown>} config - the entry config handed to `apply`.
 * @param {NodeJS.ProcessEnv} [env] - process environment for the legacy fallback.
 * @returns {Settings} plain, validated setting values.
 */
export function readSettings(config, env = process.env) {
  const raw = config ?? {}
  /** @type {Record<string, string | number | boolean>} */
  const out = {}
  for (const [key, field] of FIELDS) {
    const live = liveValue(raw[key], undefined)
    const fromEnv = field.env === undefined ? undefined : env[field.env]
    switch (field.kind) {
      case 'boolean': {
        out[key] = booleanFrom(live) ?? booleanFrom(fromEnv) ?? field.default
        break
      }
      case 'number': {
        // A timeout still declared in the legacy millisecond unit converts;
        // every other number is taken as it is. A zero is never a usable value
        // for a timeout or a limit, so it falls back to the default — the
        // schema refuses to store one in the first place. A stored value
        // outside the field's declared range is clamped for this projection
        // only: the profile keeps the value it already holds (a legacy value
        // must not stop the plugin from mounting), so what the page shows and
        // what the provider uses differ only when the stored value is the
        // out-of-range one. The browser half refuses to stage a new value
        // outside the range, so no new divergence can be created from the page.
        const legacy = field.envUnit === 'ms' ? secondsFromMilliseconds(fromEnv) : positiveIntFrom(fromEnv)
        out[key] = clampNumber(positiveIntFrom(live) ?? legacy ?? field.default, field)
        break
      }
      case 'select': {
        // An invalid stored value must not shadow a valid environment
        // fallback: number and boolean fields already continue down the chain.
        const selected = [stringFrom(live), stringFrom(fromEnv)].find(
          (candidate) => candidate !== undefined && field.options.includes(candidate),
        )
        out[key] = selected ?? field.default
        break
      }
      default: {
        out[key] = stringFrom(live) ?? stringFrom(fromEnv) ?? field.default
        break
      }
    }
  }
  // The loop writes exactly one key per field of `FIELD_GROUPS`, and each
  // branch writes the value type that field's `kind` declares, so the
  // accumulator has the shape of `Settings`. The cast is where that is
  // asserted; `test/settings.test.js` checks the key set and the value types
  // of the result against the same field table.
  return /** @type {Settings} */ (out)
}

/**
 * The name fragment the simulator picker should look for.
 *
 * @param {Settings} settings - output of {@link readSettings}.
 * @returns {string} a non-empty fragment; the original plugin's `iPhone 16` last.
 */
export function defaultDeviceFragment(settings) {
  return String(settings?.defaultDevice ?? '').trim() || 'iPhone 16'
}
