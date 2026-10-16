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
 * @module dsh-ios-simulator-helper/settings
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
export const UI_BACKENDS = ['auto', 'idb', 'xcodebuildmcp', 'none']

/**
 * Every user-editable field, in the order the settings page groups them.
 *
 * Each entry carries the metadata both halves need: the host builds the
 * schemastery schema from it, and the same metadata is mirrored in
 * `lib/client.js` to render the controls. `env` names the environment variable
 * the original ZCode plugin read for that value (`IOS_SIM_*`), so an existing
 * CI or MCP configuration keeps working without touching the settings page.
 */
export const FIELD_GROUPS = [
  {
    id: 'target',
    title: { zh: '模拟器与设备', en: 'Simulator and device' },
    hint: {
      zh: '选择哪个模拟器，以及需要时是否自动启动并打开 Simulator 窗口。',
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
        label: { zh: '自动打开 Simulator 窗口', en: 'Open the Simulator window automatically' },
        hint: {
          zh: '原插件在启动/显示/打开 URL/构建并运行时默认打开 Simulator.app；关闭后只做 simctl 操作，不弹出窗口。',
          en: 'The original plugin opened Simulator.app for boot/show/open-url/build-and-run; turn this off to stay headless.',
        },
      },
      {
        key: 'bootTimeoutMs',
        kind: 'number',
        env: 'IOS_SIM_BOOT_TIMEOUT_MS',
        default: 120000,
        label: { zh: '模拟器启动超时 (ms)', en: 'Simulator boot timeout (ms)' },
        hint: {
          zh: '单条 simctl boot / bootstatus 命令的最长等待时间，默认 120000。',
          en: 'Longest wait for one simctl boot / bootstatus command; 120000 by default.',
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
        key: 'uiTimeoutMs',
        kind: 'number',
        env: 'IOS_SIM_UI_TIMEOUT_MS',
        default: 60000,
        label: { zh: 'UI 操作超时 (ms)', en: 'UI action timeout (ms)' },
        hint: { zh: '单次 idb UI 命令的最长运行时间，默认 60000。', en: 'Longest runtime of one idb UI command; 60000 by default.' },
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
        key: 'buildTimeoutMs',
        kind: 'number',
        env: 'IOS_SIM_BUILD_TIMEOUT_MS',
        default: 600000,
        label: { zh: '构建超时 (ms)', en: 'Build timeout (ms)' },
        hint: { zh: '一次 xcodebuild build 的最长运行时间，默认 600000。', en: 'Longest runtime of one xcodebuild build; 600000 by default.' },
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
]

/** Flat `key -> field descriptor` view of {@link FIELD_GROUPS}. */
export const FIELDS = new Map(FIELD_GROUPS.flatMap((group) => group.fields.map((field) => [field.key, field])))

/** Every field key, in declaration order. */
export const FIELD_KEYS = [...FIELDS.keys()]

/** Build the schemastery node for one field descriptor. */
function schemaFor(field) {
  let node
  switch (field.kind) {
    case 'boolean':
      node = z.boolean()
      break
    case 'number':
      node = z.natural()
      break
    default:
      node = z.string()
      break
  }
  node = node.default(field.default)
  const description = field.hint?.zh ?? field.hint?.en
  if (description) node = node.description(description)
  // `.volatile()` is what makes the value live: DSH stores the reference and
  // the plugin re-reads `.get()` on every call, so a settings save reaches the
  // next tool invocation without remounting the entry.
  return node.volatile()
}

/**
 * The plugin's `Config` export.
 *
 * One volatile node per field, so every field is both persisted as a normal
 * Cordis patch value and re-read live by {@link readSettings}.
 */
export const Config = z.object(Object.fromEntries([...FIELDS].map(([key, field]) => [key, schemaFor(field)])))

/** Unwrap a live (volatile) reference, a plain value, or a missing field. */
function liveValue(node, fallback) {
  if (node === undefined || node === null) return fallback
  if (typeof node === 'object' && typeof node.get === 'function') {
    const value = node.get()
    return value === undefined || value === null ? fallback : value
  }
  return node
}

/** Coerce one setting to a non-empty trimmed string, else `undefined`. */
function stringFrom(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Coerce one setting to a positive integer, else `undefined`. */
function positiveIntFrom(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Coerce one setting to a boolean, else `undefined`.
 *
 * Booleans also come from the environment (`IOS_SIM_AUTO_BOOT=0`), so the usual
 * shell spellings are accepted rather than only `true`/`false`.
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
 * Called once per tool invocation, so a value saved in the settings page is
 * visible to the very next call. Empty text fields fall back to the historical
 * environment variable, then to the declared default, mirroring the ZCode
 * plugin's `userConfig` and `IOS_SIM_*` environment behaviour.
 *
 * @param {Record<string, unknown>} config - the entry config handed to `apply`.
 * @param {NodeJS.ProcessEnv} [env] - process environment for the legacy fallback.
 * @returns {Record<string, unknown>} plain, validated setting values.
 */
export function readSettings(config, env = process.env) {
  const raw = config ?? {}
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
        out[key] = positiveIntFrom(live) ?? positiveIntFrom(fromEnv) ?? field.default
        break
      }
      case 'select': {
        const value = stringFrom(live) ?? stringFrom(fromEnv) ?? field.default
        out[key] = field.options.includes(value) ? value : field.default
        break
      }
      default: {
        out[key] = stringFrom(live) ?? stringFrom(fromEnv) ?? field.default
        break
      }
    }
  }
  return out
}

/**
 * The name fragment the simulator picker should look for.
 *
 * @param {Record<string, unknown>} settings - output of {@link readSettings}.
 * @returns {string} a non-empty fragment; the original plugin's `iPhone 16` last.
 */
export function defaultDeviceFragment(settings) {
  return String(settings?.defaultDevice ?? '').trim() || 'iPhone 16'
}
