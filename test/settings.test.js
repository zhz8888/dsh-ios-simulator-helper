import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  Config,
  FIELD_GROUPS,
  FIELD_KEYS,
  FIELDS,
  UI_BACKENDS,
  defaultDeviceFragment,
  readSettings,
} from '../lib/settings.js'

/**
 * Settings projection tests.
 *
 * The two behaviours worth pinning are the live read (a volatile reference must
 * be unwrapped on every call, not captured once) and the legacy fallback chain
 * (configuration page -> `IOS_SIM_*` environment variable -> declared default),
 * because the original plugin's users depend on the middle rung.
 */

/** Build a config object shaped like the one Cordis hands to `apply`. */
function liveConfig(values) {
  const out = {}
  for (const [key, value] of Object.entries(values)) {
    out[key] = { get: () => value }
  }
  return out
}

test('the field table is 17 fields in 5 groups', () => {
  assert.equal(FIELD_KEYS.length, 17)
  assert.equal(FIELD_GROUPS.length, 5)
  assert.deepEqual(
    FIELD_GROUPS.map((group) => group.id),
    ['target', 'ui', 'build', 'logs', 'output'],
  )
})

test('every declared field is a volatile node in the Config schema', () => {
  const json = Config.toJSON()
  const root = json.refs[json.uid]
  assert.equal(root.type, 'object')
  assert.deepEqual(Object.keys(root.dict), FIELD_KEYS)
  for (const ref of Object.values(root.dict)) {
    assert.equal(json.refs[ref].meta.volatile, true, 'every field must be volatile to be live-editable')
  }
})

test('the host schema describes every field with its English hint', () => {
  // The configuration page carries both languages itself, so the host schema's
  // only free-text metadata is what a model reads. It must be English: the
  // repository's code language is English, and the Chinese copy belongs to the
  // page's own `zh` dictionary, not to the schema's description.
  const json = Config.toJSON()
  const root = json.refs[json.uid]
  const descriptions = new Map()
  for (const field of FIELDS.values()) {
    const description = json.refs[root.dict[field.key]]?.meta?.description
    assert.equal(description, field.hint.en, `${field.key} must describe itself with its English hint`)
    descriptions.set(field.key, description)
  }
  assert.equal(descriptions.size, FIELD_KEYS.length, 'every field must be described')
  // No description may carry a CJK character: the equality above is what
  // catches a wrong hint, and this is the language rule stated on its own.
  for (const [key, description] of descriptions) {
    assert.ok(
      !/[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(description),
      `${key} must not carry a CJK description`,
    )
  }
})

test('the projection fills exactly the declared fields, with the type each kind declares', () => {
  // The `Settings` interface in `lib/settings.js` is written by hand, and
  // `readSettings` asserts that its result has that shape. This test is where
  // that assertion is checked: a field added to the table without a matching
  // interface member — or a kind whose value type drifted — shows up here.
  const settings = readSettings({}, {})
  assert.deepEqual(Object.keys(settings).sort(), [...FIELD_KEYS].sort())
  for (const group of FIELD_GROUPS) {
    for (const field of group.fields) {
      const value = settings[field.key]
      switch (field.kind) {
        case 'boolean':
          assert.equal(typeof value, 'boolean', `${field.key} must project a boolean`)
          break
        case 'number':
          assert.equal(typeof value, 'number', `${field.key} must project a number`)
          break
        case 'select':
          assert.equal(typeof value, 'string', `${field.key} must project a string`)
          assert.ok(field.options.includes(value), `${field.key} must project one of its options`)
          break
        default:
          assert.equal(typeof value, 'string', `${field.key} must project a string`)
          break
      }
    }
  }
})

test('defaults are used when nothing is configured', () => {
  const settings = readSettings({}, {})
  assert.equal(settings.defaultDevice, 'iPhone 16')
  assert.equal(settings.defaultRuntime, '')
  assert.equal(settings.autoBootSimulator, true)
  assert.equal(settings.autoOpenSimulator, true)
  assert.equal(settings.bootTimeoutSeconds, 120)
  assert.equal(settings.uiBackend, 'auto')
  assert.equal(settings.idbBinary, 'idb')
  assert.equal(settings.uiTimeoutSeconds, 60)
  assert.equal(settings.defaultConfiguration, 'Debug')
  assert.equal(settings.buildTimeoutSeconds, 600)
  assert.equal(settings.extraBuildArgs, '')
  assert.equal(settings.derivedDataDir, '')
  assert.equal(settings.disableCodeSigning, true)
  assert.equal(settings.logSeconds, 120)
  assert.equal(settings.logLimit, 20000)
  assert.equal(settings.dataDir, '')
  assert.equal(settings.screenshotDir, '')
})

test('the original plugin env variables still configure it', () => {
  // IOS_SIM_DEFAULT_DEVICE / IOS_SIM_UI_BACKEND / IOS_SIM_PLUGIN_DATA are what
  // the ZCode plugin read, so an existing setup must keep working untouched.
  // The three timeout variables keep their original `_MS` spelling and are
  // converted: 45000 ms is the 45 seconds the setting now stores.
  const settings = readSettings({}, {
    IOS_SIM_DEFAULT_DEVICE: 'iPad mini',
    IOS_SIM_UI_BACKEND: 'none',
    IOS_SIM_PLUGIN_DATA: '/tmp/ios-sim-data',
    IOS_SIM_AUTO_OPEN: '0',
    IOS_SIM_BOOT_TIMEOUT_MS: '45000',
  })
  assert.equal(settings.defaultDevice, 'iPad mini')
  assert.equal(settings.uiBackend, 'none')
  assert.equal(settings.dataDir, '/tmp/ios-sim-data')
  assert.equal(settings.autoOpenSimulator, false)
  assert.equal(settings.bootTimeoutSeconds, 45)
})

test('a millisecond env value converts to whole seconds, never below one', () => {
  const seconds = (raw) => readSettings({}, { IOS_SIM_BUILD_TIMEOUT_MS: raw }).buildTimeoutSeconds
  assert.equal(seconds('600000'), 600)
  assert.equal(seconds('1500'), 2, 'the nearest second wins')
  assert.equal(seconds('400'), 1, 'a sub-second timeout still has to be positive')
  assert.equal(seconds('soon'), 600, 'an unusable value falls back to the default')
})

test('a volatile reference is read fresh on every projection', () => {
  let value = 'iPhone 15'
  const config = { defaultDevice: { get: () => value } }
  assert.equal(readSettings(config, {}).defaultDevice, 'iPhone 15')
  value = 'iPhone 17'
  assert.equal(readSettings(config, {}).defaultDevice, 'iPhone 17', 'a settings save must reach the next call')
})

test('the configuration page wins over the environment variable', () => {
  const settings = readSettings(liveConfig({ defaultDevice: 'iPhone Air', uiBackend: 'idb' }), {
    IOS_SIM_DEFAULT_DEVICE: 'iPad',
    IOS_SIM_UI_BACKEND: 'none',
  })
  assert.equal(settings.defaultDevice, 'iPhone Air')
  assert.equal(settings.uiBackend, 'idb')
})

test('an out-of-range select value falls back to the declared default', () => {
  assert.equal(readSettings(liveConfig({ uiBackend: 'appium' }), {}).uiBackend, 'auto')
  assert.equal(readSettings({}, { IOS_SIM_UI_BACKEND: 'appium' }).uiBackend, 'auto')
  assert.deepEqual(UI_BACKENDS, ['auto', 'idb', 'xcodebuildmcp', 'none'])
})

test('an invalid select still falls through to a valid environment value', () => {
  // number and boolean fields already continue down the fallback chain; a
  // select that stopped at an invalid stored value used to shadow the env var.
  const settings = readSettings(liveConfig({ uiBackend: 'appium' }), { IOS_SIM_UI_BACKEND: 'none' })
  assert.equal(settings.uiBackend, 'none')
})

test('a malformed number falls back instead of reaching the providers', () => {
  const settings = readSettings(
    liveConfig({ bootTimeoutSeconds: 'soon', buildTimeoutSeconds: -5, logSeconds: 12.5, logLimit: 0 }),
    {},
  )
  assert.equal(settings.bootTimeoutSeconds, 120)
  assert.equal(settings.buildTimeoutSeconds, 600)
  assert.equal(settings.logSeconds, 120)
  assert.equal(settings.logLimit, 20000)
})

test('the log limits are clamped by the projection, without rejecting an old profile', () => {
  // The schema stays permissive on purpose: an out-of-range value written by
  // an older build must not make the plugin fail to mount. The browser half
  // refuses to stage a new one, and the projection clamps the stored one.
  assert.doesNotThrow(() => Config({ logSeconds: 7200 }))
  assert.doesNotThrow(() => Config({ logLimit: 500 }))
  const settings = readSettings(liveConfig({ logSeconds: 7200, logLimit: 500 }), {})
  assert.equal(settings.logSeconds, 3600, 'a stored over-limit value is clamped, not used as-is')
  assert.equal(settings.logLimit, 1000, 'the renderer keeps 24k characters, so the limit has a floor')
  assert.equal(readSettings({}, { IOS_SIM_LOG_SECONDS: '999999' }).logSeconds, 3600)
})

test('an out-of-range stored value projects clamped and is never rejected at mount', () => {
  // The trade this pins: a profile written by an older build (or by hand) may
  // hold a value the field's declared range no longer admits. The schema
  // declares no upper bound, so mounting and defaulting accept it and the
  // stored value is kept; the per-call projection clamps it. The browser half
  // refuses to stage a new out-of-range value, so only a value that was
  // already stored can make the page's draft and the provider's value differ.
  assert.doesNotThrow(() => Config())
  assert.doesNotThrow(() => Config({ logSeconds: 5000 }))
  assert.doesNotThrow(() => Config({ logLimit: 50000 }))
  assert.equal(Config({ logSeconds: 5000 }).logSeconds.get(), 5000, 'the schema must not clamp what the profile stores')
  assert.equal(Config({ logLimit: 50000 }).logLimit.get(), 50000, 'the schema must not clamp what the profile stores')
  const settings = readSettings(liveConfig({ logSeconds: 5000, logLimit: 50000 }), {})
  assert.equal(settings.logSeconds, 3600, 'the projection clamps the stored value')
  assert.equal(settings.logLimit, 20000, 'the projection clamps the stored value')
})

test('the number fields refuse a zero, which is no usable timeout or limit', () => {
  // The schema is what the configuration page validates against, so a zero has
  // to be refused there. Stored, it would read back as the field's default,
  // and the page would show a value the plugin does not use.
  assert.throws(() => Config({ bootTimeoutSeconds: 0 }), /bootTimeoutSeconds/)
  assert.throws(() => Config({ buildTimeoutSeconds: 0 }), /buildTimeoutSeconds/)
  assert.throws(() => Config({ logLimit: 0 }), /logLimit/)
  assert.doesNotThrow(() => Config({ bootTimeoutSeconds: 1 }))
})

test('booleans accept the shell spellings and otherwise keep the default', () => {
  assert.equal(readSettings(liveConfig({ autoBootSimulator: 'yes' }), {}).autoBootSimulator, true)
  assert.equal(readSettings(liveConfig({ autoBootSimulator: false }), {}).autoBootSimulator, false)
  assert.equal(readSettings(liveConfig({ autoBootSimulator: 'maybe' }), {}).autoBootSimulator, true)
  assert.equal(readSettings({}, { IOS_SIM_DISABLE_CODE_SIGNING: 'false' }).disableCodeSigning, false)
  assert.equal(readSettings({}, { IOS_SIM_AUTO_BOOT: 'off' }).autoBootSimulator, false)
})

test('a whitespace-only text setting is treated as unset', () => {
  const settings = readSettings(liveConfig({ defaultDevice: '   ', idbBinary: '\t' }), {})
  assert.equal(settings.defaultDevice, 'iPhone 16')
  assert.equal(settings.idbBinary, 'idb')
})

test('the default device fragment never returns an empty string', () => {
  assert.equal(defaultDeviceFragment({ defaultDevice: '' }), 'iPhone 16')
  assert.equal(defaultDeviceFragment({ defaultDevice: 'iPad mini' }), 'iPad mini')
  assert.equal(defaultDeviceFragment(undefined), 'iPhone 16')
})

