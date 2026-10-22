import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readSettings } from '../lib/settings.js'
import { defaultDataRoot, displayPath, inside, readablePath, rel } from '../lib/util/path.js'
import { run, splitArgumentLines } from '../lib/util/run.js'
import { toLosslessJson, truncate } from '../lib/util/content.js'
import { hostInfo, isSupportedHost, platformLabel, requireMacOS } from '../lib/providers/host.js'
import { alreadyShutdownText, chooseSimulator, isIosRuntime, parseRuntimes, parseSimulators, simulatorAppAttempts, validUdid, list } from '../lib/providers/sim.js'
import { clampLimit, clampSeconds, logLengths, logPredicate } from '../lib/providers/logs.js'
import { appBundleId, cleanAppName, deploymentTarget, slugify } from '../lib/providers/project.js'
import { macroSandboxDenied, pickAppProduct, requestedTimeoutMs } from '../lib/providers/build.js'
import { PAGE_LOCATION, preflight } from '../lib/providers/preflight.js'
import { status as uiStatus, unavailableMessage } from '../lib/providers/ui.js'

/**
 * Pure-function tests for the ported providers.
 *
 * Everything the port changed or added is covered here without touching the
 * machine: the selection order, the parsers, the macOS gate, the argv assembly
 * and the lossless-JSON projection.
 */

/** A runtime stub: no subprocess is spawned by anything invoked with `platform: 'linux'`. */
function fakeRuntime(overrides = {}) {
  const settings = { ...readSettings({}, {}), ...(overrides.settings ?? {}) }
  return {
    cwd: '/tmp/ios-helper-test',
    settings,
    platform: 'darwin',
    env: {},
    dataRoot: '/tmp/ios-helper-test-data',
    logger: { info() {}, warn() {}, error() {} },
    ...overrides,
    settings,
  }
}

/** One `simctl list devices --json` fixture. */
const DEVICES_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-27-1': [
      { name: 'iPhone Duo', udid: '92350092-8BAE-4B37-98DF-4A9E28D0AD5A', state: 'Shutdown', isAvailable: true },
      { name: 'iPhone Broken', udid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', state: 'Shutdown', isAvailable: false },
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
      { name: 'iPhone 18 Pro', udid: 'E799AFD7-C83C-4DD2-AD27-B11DDA87EFAC', state: 'Booted', isAvailable: true },
      { name: 'iPad mini (A17 Pro)', udid: 'DFE2014B-F70A-4263-89E7-39018BE4E2A2', state: 'Shutdown', isAvailable: true },
      {
        name: 'iPhone 17',
        udid: 'BE512F00-415F-46FC-B9ED-B12A73C7EBDA',
        state: 'Shutdown',
        isAvailable: true,
        availabilityError: 'runtime profile not found',
      },
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-27-0': [
      { name: 'Apple Watch', udid: '11111111-2222-3333-4444-555555555555', state: 'Shutdown', isAvailable: true },
    ],
  },
})

test('device parsing keeps only iOS/iPadOS simulators and honours availability', () => {
  const sims = parseSimulators(DEVICES_JSON)
  assert.equal(sims.length, 5, 'the watchOS device must be dropped')
  assert.deepEqual(sims.map((item) => item.name), [
    'iPhone Duo',
    'iPhone Broken',
    'iPhone 18 Pro',
    'iPad mini (A17 Pro)',
    'iPhone 17',
  ])
  const byName = new Map(sims.map((item) => [item.name, item]))
  assert.equal(byName.get('iPhone Broken').available, false, 'isAvailable false is unavailable')
  assert.equal(byName.get('iPhone 17').available, false, 'availabilityError makes a device unavailable')
  assert.equal(byName.get('iPhone 18 Pro').available, true)
  assert.equal(byName.get('iPhone 18 Pro').runtime, 'com.apple.CoreSimulator.SimRuntime.iOS-27-0')
})

test('runtime detection accepts iOS and iPadOS keys only', () => {
  assert.equal(isIosRuntime('com.apple.CoreSimulator.SimRuntime.iOS-27-0'), true)
  assert.equal(isIosRuntime('iOS 27.0'), true)
  assert.equal(isIosRuntime('com.apple.CoreSimulator.SimRuntime.iPadOS-27-0'), true)
  assert.equal(isIosRuntime('com.apple.CoreSimulator.SimRuntime.watchOS-27-0'), false)
  assert.equal(isIosRuntime('com.apple.CoreSimulator.SimRuntime.tvOS-27-0'), false)
  assert.equal(isIosRuntime('com.apple.CoreSimulator.SimRuntime.xrOS-27-0'), false)
  assert.equal(isIosRuntime(undefined), false)
})

test('runtime parsing keeps usable iOS runtimes', () => {
  const runtimes = parseRuntimes(
    JSON.stringify({
      runtimes: [
        { name: 'iOS 27.1', identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-1', version: '27.1', platform: 'iOS', isAvailable: true },
        { name: 'iOS 26.4', identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-4', version: '26.4', platform: 'iOS', isAvailable: false },
        { name: 'watchOS 27.0', identifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-27-0', version: '27.0', platform: 'watchOS' },
      ],
    }),
  )
  assert.deepEqual(runtimes.map((item) => item.name), ['iOS 27.1', 'iOS 26.4'])
  assert.equal(runtimes[1].available, false)
})

test('UDID validation rejects anything simctl would not accept', () => {
  assert.equal(validUdid('E799AFD7-C83C-4DD2-AD27-B11DDA87EFAC'), true)
  assert.equal(validUdid('booted'), false)
  assert.equal(validUdid('$(rm -rf /)'), false)
  assert.equal(validUdid(undefined), false)
})

test('an explicit UDID wins, and an unknown one is an error', () => {
  const sims = parseSimulators(DEVICES_JSON)
  const chosen = chooseSimulator(sims, { udid: 'DFE2014B-F70A-4263-89E7-39018BE4E2A2' }, {})
  assert.equal(chosen.name, 'iPad mini (A17 Pro)')
  assert.throws(() => chooseSimulator(sims, { udid: '11111111-1111-1111-1111-111111111111' }, {}), /Simulator not found/)
})

test('a booted simulator is reused unless the call names one', () => {
  const sims = parseSimulators(DEVICES_JSON)
  assert.equal(chooseSimulator(sims, {}, {}).name, 'iPhone 18 Pro')
  assert.equal(chooseSimulator(sims, { device: 'iPad' }, {}).name, 'iPad mini (A17 Pro)')
  // The original plugin preferred a booted device over the configured default,
  // so a saved default must not silently retarget a session that is already running.
  assert.equal(chooseSimulator(sims, {}, { defaultDevice: 'iPad mini' }).name, 'iPhone 18 Pro')
})

/** The same devices with none booted, for the selection-order tests. */
const SHUTDOWN_ONLY = parseSimulators(
  JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
        { name: 'iPhone 18 Pro', udid: 'E799AFD7-C83C-4DD2-AD27-B11DDA87EFAC', state: 'Shutdown', isAvailable: true },
        { name: 'iPad mini (A17 Pro)', udid: 'DFE2014B-F70A-4263-89E7-39018BE4E2A2', state: 'Shutdown', isAvailable: true },
        { name: 'iPhone Duo', udid: '92350092-8BAE-4B37-98DF-4A9E28D0AD5A', state: 'Shutdown', isAvailable: true },
      ],
    },
  }),
)

test('the configured default device is preferred, then any iPhone, then the first', () => {
  assert.equal(chooseSimulator(SHUTDOWN_ONLY, {}, { defaultDevice: 'iPad mini' }).name, 'iPad mini (A17 Pro)')
  assert.equal(chooseSimulator(SHUTDOWN_ONLY, {}, { defaultDevice: 'iPhone 16' }).name, 'iPhone 18 Pro', 'no exact match falls back to an iPhone')
  assert.equal(chooseSimulator(SHUTDOWN_ONLY, { device: 'iPhone Duo' }, {}).name, 'iPhone Duo')
  assert.equal(chooseSimulator(SHUTDOWN_ONLY, { name: 'iPad Pro' }, {}).name, 'iPhone 18 Pro', 'a miss still falls back')
  assert.throws(() => chooseSimulator(SHUTDOWN_ONLY, { runtime: 'iOS-99' }, {}), /matches runtime "iOS-99"/)
})

test('a runtime fragment filters the candidates', () => {
  const sims = parseSimulators(DEVICES_JSON)
  const chosen = chooseSimulator(sims, { runtime: 'iOS-27-0', device: 'iPhone' }, {})
  assert.equal(chosen.name, 'iPhone 18 Pro')
  const first = chooseSimulator(sims, { runtime: 'iOS-27-1', device: 'iPhone' }, {})
  assert.equal(first.name, 'iPhone Duo')
  assert.throws(
    () => chooseSimulator(sims, { runtime: 'iOS-99' }, {}),
    /No available iOS simulator matches runtime "iOS-99"/,
  )
  // A configured runtime is a preference: a stale value must not break the call.
  const configured = chooseSimulator(SHUTDOWN_ONLY, {}, { defaultDevice: 'iPhone', defaultRuntime: 'iOS-99' })
  assert.equal(configured.name, 'iPhone 18 Pro')
})

/**
 * Xcode 26 replaced Simulator.app with Device Hub under Contents/Applications,
 * so `open -a Simulator` alone can no longer show a window. The attempt list is
 * what the `show` tool walks, and the focus argument stays on Simulator.app
 * only because Device Hub's per-device argument is not documented.
 */
test('the window app attempts cover both Xcode layouts, most likely first', () => {
  const developer = '/Applications/Xcode.app/Contents/Developer'
  const installed = new Set([
    path.join(developer, '..', 'Applications', 'DeviceHub.app'),
    '/Applications/Simulator.app',
  ])
  const attempts = simulatorAppAttempts(developer, 'BE512F00-415F-46FC-B9ED-B12A73C7EBDA', (file) => installed.has(path.resolve(file)))
  assert.deepEqual(
    attempts.map((item) => item.app),
    ['Simulator', 'DeviceHub', 'Simulator', 'Simulator', 'DeviceHub'],
    'the apps of the selected developer directory come before /Applications, and the bundle ids last',
  )
  assert.deepEqual(attempts[0].args, ['open', '-a', 'Simulator'], 'the focus-less name form is still tried when a UDID was given')
  assert.deepEqual(
    attempts[1].args,
    ['open', path.join(developer, '..', 'Applications', 'DeviceHub.app')],
    'Device Hub is opened by path, without an unverifiable focus argument',
  )
  assert.deepEqual(
    attempts[2].args,
    ['open', '/Applications/Simulator.app', '--args', '-CurrentDeviceUDID', 'BE512F00-415F-46FC-B9ED-B12A73C7EBDA'],
  )
  assert.deepEqual(attempts.at(-1).args, ['open', '-b', 'com.apple.dt.Devices'], 'the bundle id is the last resort')

  // With nothing installed the list still carries the bundle-id forms, and no
  // path is invented for an app that is not there.
  const bare = simulatorAppAttempts(undefined, undefined, () => false)
  assert.deepEqual(bare.map((item) => item.args), [['open', '-b', 'com.apple.iphonesimulator'], ['open', '-b', 'com.apple.dt.Devices']])
})

test('an unusable device list is reported with the fix', () => {
  assert.throws(
    () => chooseSimulator([{ name: 'iPhone', udid: 'A1000000-0000-0000-0000-000000000001', available: false }], {}, {}),
    /Install an iOS Simulator runtime/,
  )
})

/**
 * The installed list holds "iPhone 17e" before "iPhone 17" on a current Xcode,
 * so a fragment that is also somebody's full name must not resolve to the
 * longer device.
 */
test('an exact device name beats a longer name that contains it', () => {
  const sims = parseSimulators(
    JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
          { name: 'iPhone 17e', udid: '094A1DAB-AB04-4DAB-B088-43BD0FBBA89E', state: 'Shutdown', isAvailable: true },
          { name: 'iPhone 17', udid: 'BE512F00-415F-46FC-B9ED-B12A73C7EBDA', state: 'Shutdown', isAvailable: true },
        ],
      },
    }),
  )
  assert.equal(chooseSimulator(sims, { device: 'iPhone 17' }, {}).name, 'iPhone 17')
  assert.equal(chooseSimulator(sims, {}, { defaultDevice: 'iPhone 17' }).name, 'iPhone 17')
  assert.equal(chooseSimulator(sims, { device: 'iphone 17' }, {}).name, 'iPhone 17', 'the match ignores case')
  // A fragment that matches nothing exactly still falls back to the longer name.
  assert.equal(chooseSimulator(sims, { device: 'iPhone 17e' }, {}).name, 'iPhone 17e')
  assert.equal(chooseSimulator(sims, { device: 'iPhone 1' }, {}).name, 'iPhone 17e')
})

test('the macOS-only gate explains itself in one sentence', () => {
  assert.equal(isSupportedHost('darwin'), true)
  assert.equal(isSupportedHost('linux'), false)
  assert.equal(platformLabel('win32'), 'Windows')
  assert.equal(platformLabel('somethingelse'), 'somethingelse')
  const mac = hostInfo({ platform: 'darwin', arch: 'arm64' })
  assert.equal(mac.supported, true)
  assert.match(mac.detail, /macOS detected/)
  const linux = hostInfo({ platform: 'linux', arch: 'x64' })
  assert.equal(linux.supported, false)
  assert.equal(linux.requiredPlatformLabel, 'macOS')
  assert.match(linux.detail, /only supports macOS/)
  assert.doesNotThrow(() => requireMacOS(fakeRuntime()))
  assert.throws(() => requireMacOS(fakeRuntime({ platform: 'linux' })), /only supports macOS/)
})

test('preflight short-circuits on a non-macOS host instead of probing Xcode', async () => {
  const report = await preflight(fakeRuntime({ platform: 'linux' }))
  assert.equal(report.ok, false)
  assert.equal(report.supported, false)
  assert.equal(report.platform, 'linux')
  assert.deepEqual(report.checks.map((check) => check.name), ['Host OS (macOS)', 'iOS plugin defaults'])
  assert.equal(report.checks[0].ok, false)
  assert.equal(report.checks[1].ok, true)
  assert.match(report.note, /macOS is required/)
})

test('every simulator command refuses to run off macOS', async () => {
  await assert.rejects(() => list(fakeRuntime({ platform: 'linux' })), /only supports macOS/)
})

test('the UI backend setting is honoured without probing idb when it cannot help', async () => {
  const disabled = await uiStatus(fakeRuntime({ settings: { uiBackend: 'none' } }))
  assert.equal(disabled.available, false)
  assert.equal(disabled.backend, 'none')
  assert.match(disabled.detail, /turned off/)
  const reserved = await uiStatus(fakeRuntime({ settings: { uiBackend: 'xcodebuildmcp' } }))
  assert.equal(reserved.available, false)
  assert.equal(reserved.backend, 'xcodebuildmcp')
  assert.deepEqual(reserved.reservedBackends, ['xcodebuildmcp'])
  const auto = await uiStatus(fakeRuntime({ settings: { uiBackend: 'auto', idbBinary: 'definitely-not-idb-12345' } }))
  assert.equal(auto.available, false)
  assert.equal(auto.backend, 'none')
  assert.match(auto.detail, /definitely-not-idb-12345/)
})

/**
 * The refusal is the only thing a user sees when idb is missing, so it has to
 * read as two sentences whatever shape the status detail arrived in.
 */
test('the idb refusal reads as sentences even when the detail ends in a period', () => {
  const withPeriod = unavailableMessage({ backend: 'none', detail: 'UI automation is turned off by the plugin setting.' })
  assert.match(withPeriod, /setting\. Install idb and idb-companion/)
  assert.doesNotMatch(withPeriod, /\.\./)
  const withoutPeriod = unavailableMessage({ backend: 'none', detail: 'uiBackend = auto found no automation binary' })
  assert.match(withoutPeriod, /binary\. Install idb/)
  assert.match(withoutPeriod, /^UI automation backend unavailable \(none\): /)
})

test('the log window and limit are clamped, never trusted', () => {
  assert.equal(clampSeconds(undefined), 120)
  assert.equal(clampSeconds(0), 120)
  assert.equal(clampSeconds(-5), 120)
  assert.equal(clampSeconds(30), 30)
  assert.equal(clampSeconds(99999), 3600)
  assert.equal(clampLimit(undefined), 20000)
  assert.equal(clampLimit(10), 1000)
  assert.equal(clampLimit(999999), 200000)
})

test('argv assembly ignores blanks and comments and keeps inner spaces', () => {
  assert.deepEqual(splitArgumentLines('-quiet\n# a comment\n\nARCHS=arm64\n  -destination   generic/x  '), [
    '-quiet',
    'ARCHS=arm64',
    '-destination   generic/x',
  ])
  assert.deepEqual(splitArgumentLines(undefined), [])
})

test('provider results are projected into the harness lossless-JSON domain', () => {
  const value = toLosslessJson({
    a: undefined,
    b: Number.NaN,
    c: [1, undefined, Number.POSITIVE_INFINITY],
    d: { e: undefined, f: 'ok' },
    g: null,
    h: true,
  })
  assert.deepEqual(value, { b: null, c: [1, null, null], d: { f: 'ok' }, g: null, h: true })
  assert.equal(toLosslessJson(undefined), null)
  assert.match(truncate('abcdef', 3), /^abc\n\.\.\.\[truncated 3 characters\]$/)
})

test('workspace path resolution refuses to escape the session', () => {
  const base = '/Users/me/project'
  assert.equal(inside(base, 'build/out.app'), '/Users/me/project/build/out.app')
  assert.equal(inside(base, '/Users/me/project/shot.png'), '/Users/me/project/shot.png')
  assert.throws(() => inside(base, '../escape'), /escapes the session workspace/)
  assert.throws(() => inside(base, '/tmp/absolute.app'), /escapes the session workspace/)
  assert.equal(rel(base, '/Users/me/project/a.png'), 'a.png')
  assert.equal(rel(base, base), '.')
})

test('a read-only path may be absolute, but never implied by a relative escape', () => {
  const base = '/Users/me/project'
  assert.equal(readablePath(base, '/tmp/DerivedData/App.app'), '/tmp/DerivedData/App.app')
  assert.equal(readablePath(base, 'build/App.app'), '/Users/me/project/build/App.app')
  assert.throws(() => readablePath(base, '../App.app'), /escapes the session workspace/)
  assert.throws(() => readablePath(base, ''), /A path is required/)
})

test('the workspace guard resolves a symlink that leaves the workspace', async () => {
  // A path that only reads as inside the workspace is not inside it: the
  // symlink is followed when the file is written, so the boundary has to be
  // decided on the real path.
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-guard-'))
  try {
    const workspace = path.join(root, 'workspace')
    const outside = path.join(root, 'outside')
    await mkdir(workspace, { recursive: true })
    await mkdir(outside, { recursive: true })
    await symlink(outside, path.join(workspace, 'link'))
    assert.equal(inside(workspace, 'shot.png'), path.join(workspace, 'shot.png'))
    assert.throws(() => inside(workspace, 'link/escaped.png'), /escapes the session workspace/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a timeout the timer cannot represent does not kill the child instantly', async () => {
  // Node's timers take a 32-bit signed delay, so a larger one overflows to
  // 1 ms: the child would be killed before it started and the call would
  // report a timeout that never elapsed.
  const out = await run([process.execPath, '-e', 'setTimeout(() => {}, 300)'], { timeout: 2 ** 31 })
  assert.equal(out.code, 0)
  assert.equal(out.timed, false)
})

test('a child that traps SIGTERM does not keep the call open', async () => {
  const trap = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
  const raced = await Promise.race([
    run([process.execPath, '-e', trap], { timeout: 200 }).then((out) => ({ settled: true, out })),
    new Promise((resolve) => setTimeout(() => resolve({ settled: false }), 15_000)),
  ])
  assert.equal(raced.settled, true, 'the call must end once the timeout elapsed')
  assert.equal(raced.out.timed, true)
})

test('the build timeout argument is validated, not trusted', () => {
  assert.equal(requestedTimeoutMs(600_000), 600_000)
  assert.equal(requestedTimeoutMs(undefined), undefined)
  assert.equal(requestedTimeoutMs(0), undefined)
  assert.equal(requestedTimeoutMs(-1), undefined)
  assert.equal(requestedTimeoutMs(Number.NaN), undefined)
  assert.equal(requestedTimeoutMs(2 ** 31), undefined)
})

test('the log filter refuses an identifier with an empty segment', () => {
  // An empty last segment would build `process CONTAINS ""`, which matches
  // every line: the filter would answer with the whole log while reporting
  // itself as applied.
  assert.throws(() => logPredicate('com.example.'), /Invalid bundle id/)
  assert.throws(() => logPredicate('com..example'), /Invalid bundle id/)
  assert.throws(() => logPredicate('com.example"'), /Invalid bundle id/)
  assert.equal(
    logPredicate('com.example.demo'),
    'subsystem CONTAINS "com.example.demo" OR process CONTAINS "demo"',
  )
})

test('the truncation flag is read from the length before the truncation', () => {
  // The marker is longer than the text it replaces for a small overflow, so a
  // flag derived from the truncated text would report "not truncated" for a
  // log that visibly ends in the marker.
  assert.deepEqual(logLengths('x'.repeat(20_000), 20_000), { characters: 20_000, truncated: false })
  assert.deepEqual(logLengths('x'.repeat(20_001), 20_000), { characters: 20_000, truncated: true })
  assert.deepEqual(logLengths('x'.repeat(20_500), 20_000), { characters: 20_000, truncated: true })
})

test('a refused shutdown counts as a no-op only when the device was already down', () => {
  assert.equal(alreadyShutdownText('Unable to shutdown device in current state: Shutdown'), true)
  assert.equal(alreadyShutdownText('Unable to shutdown device in current state: Booting'), false)
  assert.equal(alreadyShutdownText('An error was encountered processing the command'), false)
})

test('a reported path is relative inside the workspace and absolute outside it', () => {
  const cwd = '/Users/me/project'
  assert.equal(displayPath(cwd, path.join(cwd, 'shot.png')), 'shot.png')
  assert.equal(displayPath(cwd, '/Users/me/elsewhere/shot.png'), '/Users/me/elsewhere/shot.png')
})

test('the data root falls back from DSH_HOME to the user home to temp', () => {
  assert.equal(defaultDataRoot({ DSH_HOME: '/opt/dsh' }), '/opt/dsh/ios-simulator-helper')
  assert.equal(defaultDataRoot({}), path.join(os.homedir(), '.dsh', 'ios-simulator-helper'))
})

test('the generated app name, bundle id and deployment target are validated', () => {
  assert.equal(cleanAppName('My App!'), 'MyApp')
  assert.equal(cleanAppName('7up'), 'App7up')
  assert.throws(() => cleanAppName('!!!'), /must contain letters or numbers/)
  assert.equal(appBundleId('com.example.demo'), 'com.example.demo')
  assert.throws(() => appBundleId('demo'), /Invalid bundle id/)
  assert.throws(() => appBundleId('com..demo'), /Invalid bundle id/)
  assert.equal(deploymentTarget('17.0'), '17.0')
  assert.equal(deploymentTarget('17'), '17')
  assert.throws(() => deploymentTarget('17.0.1.2'), /Invalid deployment target/)
  assert.equal(slugify('My App'), 'my-app')
  assert.equal(slugify('7up'), 'app-7up')
})

test('build product selection prefers the requested configuration', () => {
  const hits = [
    '/d/Build/Products/Release-iphonesimulator/App.app',
    '/d/Build/Products/Debug-iphonesimulator/App.app',
  ]
  assert.match(pickAppProduct(hits, 'Release'), /Release-iphonesimulator/)
  assert.match(pickAppProduct(hits, 'Debug'), /Debug-iphonesimulator/)
  assert.match(pickAppProduct(hits, 'Profile'), /Debug-iphonesimulator/, 'an unknown configuration falls back to Debug')
  assert.equal(pickAppProduct([], 'Debug'), undefined)
})

/**
 * The exact signature `swift-plugin-server` leaves behind when its nested
 * sandbox cannot start; the build retries with `-disable-sandbox` only for it.
 */
test('only a nested macro sandbox failure triggers the sandbox retry', () => {
  const denied = [
    'sandbox-exec: sandbox_apply: Operation not permitted',
    "ContentView.swift:4:24: error: external macro implementation type 'SwiftUIMacros.StateMacro' could not be found for macro 'State()'; '/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/usr/bin/swift-plugin-server' produced malformed response",
    '** BUILD FAILED **',
  ].join('\n')
  assert.equal(macroSandboxDenied(denied), true)
  // Each half alone is not enough: a real compile error, or a macro failure
  // whose cause is something else, must be reported instead of retried.
  assert.equal(macroSandboxDenied('sandbox-exec: sandbox_apply: Operation not permitted'), false)
  assert.equal(macroSandboxDenied('error: cannot find type "Foo" in scope'), false)
  assert.equal(macroSandboxDenied(''), false)
  assert.equal(macroSandboxDenied(undefined), false)
})

test('the diagnostic fix hints name the plugin page in the Plugins panel', () => {
  // Both hints used to send the user to the Settings dialog — a location that
  // no longer holds them after the form moved to the plugin detail view. The
  // phrase is one exported constant so a stale instruction is a test failure,
  // and each interpolation is counted so a hand-written replacement is caught.
  assert.match(PAGE_LOCATION, /Plugins panel/)
  assert.match(PAGE_LOCATION, /iOS Simulator Helper/)
  const source = readFileSync(new URL('../lib/providers/preflight.js', import.meta.url), 'utf8')
  assert.equal((source.match(/\$\{PAGE_LOCATION\}/g) ?? []).length, 2, 'both fix hints must interpolate PAGE_LOCATION')
})
