import z from '@deepseek-ai/schemastery'
import { text } from './i18n.js'

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
 * `select` and `discovery` are both choices and differ in where the list
 * comes from. A `select`'s options are the fixed `options` its descriptor
 * carries, so both halves of the plugin can hold them; a `discovery` field's
 * options are found on the host and served through the inventory route, so its
 * descriptor carries no list and the page renders whatever this machine has.
 *
 * @typedef {'text' | 'multiline' | 'number' | 'boolean' | 'select' | 'discovery'} FieldKind
 */

/**
 * One label or hint in both languages.
 *
 * @typedef {{zh: string, en: string}} LocalizedText
 */

/**
 * The metadata every field carries, whatever its kind.
 *
 * `label`, `hint` and `placeholder` are not written here: they are looked up in
 * `locale/en.json` and `locale/zh.json` by key, so the copy has exactly one
 * home. A key that is missing from either file throws at import time, which is
 * what keeps a half-translated field from rendering as its own key.
 *
 * @typedef {object} FieldMetaBase
 * @property {string} key - the settings key; also the schema key and the client field key.
 * @property {string} [env] - the legacy environment variable that configures the same value.
 * @property {LocalizedText} [placeholder] - the placeholder the configuration page shows.
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
 * A field the user picks from a list discovered on this machine.
 *
 * The options are deliberately not part of the table: the host serves them
 * through the inventory route, so an option list here would be a second,
 * staler copy. The value is therefore an ordinary string and the schema cannot
 * police the set; a saved value the discovery did not return is still shown by
 * the page, because the user has to be able to see, and fix, what is stored.
 *
 * `suggest` names the discovery list the field's options come from, so the two
 * halves of the plugin agree on which list a field reads.
 *
 * @typedef {FieldMetaBase & {kind: 'discovery', default: string, suggest: string}} DiscoveryFieldMeta
 */

/**
 * One field of the configuration page.
 *
 * The union is discriminated on `kind`, so the `default` a field carries is
 * narrowed with it: a `boolean` field's default is a boolean, a `number`
 * field's is a number, and a text or select field's is a string.
 *
 * @typedef {TextFieldMeta | NumberFieldMeta | BooleanFieldMeta | SelectFieldMeta | DiscoveryFieldMeta} FieldMeta
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
 * The 18 live settings, as {@link readSettings} projects them.
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
 * @property {string} defaultDevice - the simulator the user picked; empty means the plugin's own fallback.
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
 * @property {boolean} showInSettings - whether the page also appears in the Settings dialog.
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
 * Xcode build configurations accepted by the `defaultConfiguration` setting.
 *
 * These are the three configurations a generated project declares, and the
 * only ones `xcodebuild -configuration` can name for it, so the setting is a
 * dropdown over them rather than free text: a hand-typed value would always
 * fail the build it was meant to configure.
 */
export const XCODE_CONFIGURATIONS = /** @type {const} */ (['Debug', 'Release', 'Profile'])

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
    title: text('group.target'),
    hint: text('group.target.hint'),
    fields: [
      {
        key: 'defaultDevice',
        kind: 'discovery',
        env: 'IOS_SIM_DEFAULT_DEVICE',
        // Unset, not a device name: the setting holds the simulator the user
        // picked, and the plugin's own fallback is not one of them. A default of
        // 'iPhone 16' would be a name this machine may not have, so the page
        // would open on a value it has to mark as missing, and clearing the
        // field would snap straight back to it — the schema default repopulates
        // a cleared value, so a not-set entry could never survive a save. The
        // fragment the picker looks for is a separate question, and
        // {@link defaultDeviceFragment} answers it with the original plugin's
        // 'iPhone 16'.
        default: '',
        suggest: 'devices',
        label: text('field.defaultDevice'),
        hint: text('field.defaultDevice.hint'),
      },
      {
        key: 'defaultRuntime',
        kind: 'discovery',
        env: 'IOS_SIM_DEFAULT_RUNTIME',
        default: '',
        suggest: 'runtimes',
        label: text('field.defaultRuntime'),
        hint: text('field.defaultRuntime.hint'),
      },
      {
        key: 'autoBootSimulator',
        kind: 'boolean',
        env: 'IOS_SIM_AUTO_BOOT',
        default: true,
        label: text('field.autoBootSimulator'),
        hint: text('field.autoBootSimulator.hint'),
      },
      {
        key: 'autoOpenSimulator',
        kind: 'boolean',
        env: 'IOS_SIM_AUTO_OPEN',
        default: true,
        label: text('field.autoOpenSimulator'),
        hint: text('field.autoOpenSimulator.hint'),
      },
      {
        key: 'bootTimeoutSeconds',
        kind: 'number',
        env: 'IOS_SIM_BOOT_TIMEOUT_MS',
        envUnit: 'ms',
        default: 120,
        label: text('field.bootTimeoutSeconds'),
        hint: text('field.bootTimeoutSeconds.hint'),
      },
    ],
  },
  {
    id: 'ui',
    title: text('group.ui'),
    hint: text('group.ui.hint'),
    fields: [
      {
        key: 'uiBackend',
        kind: 'select',
        env: 'IOS_SIM_UI_BACKEND',
        default: 'auto',
        options: [
          'auto',
          'idb',
          'xcodebuildmcp',
          'none',
        ],
        label: text('field.uiBackend'),
        hint: text('field.uiBackend.hint'),
      },
      {
        key: 'idbBinary',
        kind: 'text',
        env: 'IOS_SIM_IDB_BINARY',
        default: 'idb',
        placeholder: text('field.idbBinary.placeholder'),
        label: text('field.idbBinary'),
        hint: text('field.idbBinary.hint'),
      },
      {
        key: 'uiTimeoutSeconds',
        kind: 'number',
        env: 'IOS_SIM_UI_TIMEOUT_MS',
        envUnit: 'ms',
        default: 60,
        label: text('field.uiTimeoutSeconds'),
        hint: text('field.uiTimeoutSeconds.hint'),
      },
    ],
  },
  {
    id: 'build',
    title: text('group.build'),
    hint: text('group.build.hint'),
    fields: [
      {
        key: 'defaultConfiguration',
        kind: 'select',
        env: 'IOS_SIM_CONFIGURATION',
        default: 'Debug',
        options: XCODE_CONFIGURATIONS,
        label: text('field.defaultConfiguration'),
        hint: text('field.defaultConfiguration.hint'),
      },
      {
        key: 'buildTimeoutSeconds',
        kind: 'number',
        env: 'IOS_SIM_BUILD_TIMEOUT_MS',
        envUnit: 'ms',
        default: 600,
        label: text('field.buildTimeoutSeconds'),
        hint: text('field.buildTimeoutSeconds.hint'),
      },
      {
        key: 'extraBuildArgs',
        kind: 'multiline',
        env: 'IOS_SIM_EXTRA_BUILD_ARGS',
        default: '',
        placeholder: text('field.extraBuildArgs.placeholder'),
        label: text('field.extraBuildArgs'),
        hint: text('field.extraBuildArgs.hint'),
      },
      {
        key: 'derivedDataDir',
        kind: 'text',
        env: 'IOS_SIM_DERIVED_DATA_DIR',
        default: '',
        placeholder: text('field.derivedDataDir.placeholder'),
        label: text('field.derivedDataDir'),
        hint: text('field.derivedDataDir.hint'),
      },
      {
        key: 'disableCodeSigning',
        kind: 'boolean',
        env: 'IOS_SIM_DISABLE_CODE_SIGNING',
        default: true,
        label: text('field.disableCodeSigning'),
        hint: text('field.disableCodeSigning.hint'),
      },
    ],
  },
  {
    id: 'logs',
    title: text('group.logs'),
    hint: text('group.logs.hint'),
    fields: [
      {
        key: 'logSeconds',
        kind: 'number',
        env: 'IOS_SIM_LOG_SECONDS',
        default: 120,
        max: 3600,
        label: text('field.logSeconds'),
        hint: text('field.logSeconds.hint'),
      },
      {
        key: 'logLimit',
        kind: 'number',
        env: 'IOS_SIM_LOG_LIMIT',
        default: 20000,
        min: 1000,
        max: 20000,
        label: text('field.logLimit'),
        hint: text('field.logLimit.hint'),
      },
    ],
  },
  {
    id: 'output',
    title: text('group.output'),
    hint: text('group.output.hint'),
    fields: [
      {
        key: 'dataDir',
        kind: 'text',
        env: 'IOS_SIM_PLUGIN_DATA',
        default: '',
        placeholder: text('field.dataDir.placeholder'),
        label: text('field.dataDir'),
        hint: text('field.dataDir.hint'),
      },
      {
        key: 'screenshotDir',
        kind: 'text',
        env: 'IOS_SIM_SCREENSHOT_DIR',
        default: '',
        placeholder: text('field.screenshotDir.placeholder'),
        label: text('field.screenshotDir'),
        hint: text('field.screenshotDir.hint'),
      },
    ],
  },
  {
    id: 'interface',
    title: text('group.interface'),
    hint: text('group.interface.hint'),
    fields: [
      {
        key: 'showInSettings',
        kind: 'boolean',
        default: false,
        label: text('field.showInSettings'),
        hint: text('field.showInSettings.hint'),
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
      // A `discovery` field lands here too: its value is an ordinary string,
      // because the set of names this machine has is discovered at run time and
      // a schema that policed it would need to spawn `simctl` on every write.
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
        // A `discovery` field lands here too: the value is whatever name the
        // user picked, and the page is what keeps it one of the names this
        // machine has. The stored value wins, as in every branch above; the
        // environment variable is what an empty field falls back to, so a CI
        // configuration keeps working until someone picks a device on the
        // page.
        //
        // The empty value is the field's own default, not a fallback to
        // another name: a discovery field whose default was a device name
        // would shadow the environment variable for good — the live config
        // resolves a default even when the user stored nothing, so the
        // environment could never reach this projection.
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
 * The setting and the fragment are two different questions. The setting holds
 * the simulator the user picked and is empty when they picked none — the
 * plugin's own fallback is not a name this machine necessarily has. The
 * fragment is what to look for when nothing was picked, and the original
 * plugin's answer is `iPhone 16`, which falls through to the first available
 * iPhone when no device carries that name.
 *
 * @param {Settings} settings - output of {@link readSettings}.
 * @returns {string} a non-empty fragment; the original plugin's `iPhone 16` last.
 */
export function defaultDeviceFragment(settings) {
  return String(settings?.defaultDevice ?? '').trim() || 'iPhone 16'
}
