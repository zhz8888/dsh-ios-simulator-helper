import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  Config,
  FIELD_GROUPS,
  FIELD_KEYS,
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

