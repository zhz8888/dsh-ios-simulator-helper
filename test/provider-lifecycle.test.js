import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
// Before the plugin, deliberately: `lib/util/run.js` takes `spawn` as an ESM
// named import of a CommonJS builtin, and the binding is taken when the
// importing module is instantiated. Every plugin module below is therefore
// loaded dynamically, after the seam has replaced `spawn`.
import { seam } from './helpers/offline-seam.mjs'

/**
 * End-to-end provider cases for the simulator lifecycle the seam can answer.
 *
 * The unit suites pin the parsers one field at a time; these cases pin the
 * orchestration around them — which command line a capture runs, which device
 * an unnamed build or capture targets, how many times one boot enumerates the
 * device list, what a refused path costs, and what the build report says about
 * a failure. They are the behaviours the release verification found untested
 * (`docs/verification/2026-10-22-release-verification-findings.md`, G1–G3, W3)
 * plus the device-pair capture defect (D1) and the macro-sandbox retry budget
 * (D6).
 *
 * Apple's tools are answered by `test/helpers/offline-seam.mjs`, so nothing
 * here reaches Xcode, `simctl` or a simulator.
 */

const { shot } = await import('../lib/providers/screenshot.js')
const { app } = await import('../lib/providers/build.js')
const { create } = await import('../lib/providers/project.js')
const { boot, chooseSimulator, parseSimulators, shutdown } = await import('../lib/providers/sim.js')
const { createRuntime } = await import('../lib/runtime.js')

/** The runtime key the seam's device and runtime payloads use. */
const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-27-1'

/** The booted device the seam's default payload lists. */
const DEFAULT_UDID = '2F4A1B3C-5D6E-4F70-8A9B-0C1D2E3F4A5B'

/** A device pair, as `simctl` lists one. */
const PAIR_UDID = 'A1B2C3D4-1111-2222-3333-444455556666'

/** A single iPhone. */
const PHONE_UDID = 'B1B2C3D4-7777-8888-9999-000011112222'

/** The device-type identifiers the pair and the single device carry. */
const PAIR_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo'
const PHONE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro'

/**
 * The exact text a sandboxed build fails with, which `macroSandboxDenied` recognises.
 *
 * It has to carry all three fragments the predicate matches: the nested
 * `sandbox_apply` refusal, the plugin server's path, and the malformed response
 * Xcode reports for every macro in the file.
 */
const MACRO_SANDBOX_DENIED = [
  'sandbox-exec: sandbox_apply: Operation not permitted',
  "error: external macro implementation type 'SwiftUIMacros.StateMacro' could not be found for macro 'State()';",
  "  '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/host/plugins/"
    + "swift-plugin-server' produced malformed response",
  '** BUILD FAILED **',
  '',
].join('\n')

/**
 * A runtime rooted at `root`, on a macOS platform.
 *
 * `platform` is passed rather than read from the process so the cases do not
 * depend on the host running the suite; the providers only ever see this field.
 *
 * @param {string} root - the session workspace.
 * @param {{config?: Record<string, unknown>, logger?: {info: (m: string) => void,
 *   warn: (m: string) => void, error: (m: string) => void}}} [options] - overrides.
 * @returns {import('../lib/runtime.js').Runtime} the call runtime.
 */
function runtimeFor(root, options = {}) {
  return createRuntime({
    config: { dataDir: path.join(root, 'data'), ...(options.config ?? {}) },
    exec: { agent: { session: { header: { cwd: root } } } },
    logger: options.logger ?? { info() {}, warn() {}, error() {} },
    platform: 'darwin',
  })
}

/**
 * A workspace holding the project `ios_create_app` writes, plus its runtime.
 *
 * @param {string} root - the session workspace.
 * @returns {Promise<import('../lib/runtime.js').Runtime>} the runtime.
 */
async function projectRuntime(root) {
  const rt = runtimeFor(root)
  await create(rt, { name: 'Demo' })
  return rt
}

/**
 * Every `xcodebuild … build` command line the seam answered.
 *
 * @returns {string[]} the build command lines, in call order.
 */
function builds() {
  return seam.calls.map((item) => item.line).filter((line) => line.startsWith('xcodebuild ') && line.endsWith(' build'))
}

/** A `simctl list devices --json` payload with the given device entries. */
function devicesPayload(entries) {
  return JSON.stringify({ devices: { [RUNTIME]: entries } })
}

test('a capture asks for the primary display, the one that holds the real frame', async () => {
  // Without `--display`, `simctl io screenshot` grabs the secondary display of a
  // device pair, which renders a uniformly black frame. The flag is the fix; on
  // a normal device the bytes are identical to the plain call.
  seam.reset()
  seam.allowMutations = true
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-capture-'))
  try {
    const result = await shot(runtimeFor(root), {})
    const call = seam.calls.find((item) => item.argv[1] === 'simctl' && item.argv[2] === 'io')
    assert.ok(call, 'the capture must run `simctl io`')
    assert.deepEqual(call.argv.slice(3, 7), [DEFAULT_UDID, 'screenshot', '--display', 'primary'])
    assert.equal(call.argv[7], result.absolutePath, 'the capture writes the file it reports')
    assert.ok(result.bytes > 0)
    assert.equal(seam.calls.filter((item) => item.argv[2] === 'io').length, 1, 'a capture the flag works for is one call')
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a simctl that rejects --display is retried once with the plain command', async () => {
  seam.reset()
  seam.allowMutations = true
  // An older `simctl` reports the option it did not understand and exits 1.
  seam.io.push({ code: 1, stderr: 'unknown option: --display\nUsage: simctl io <device> screenshot <file>\n' })
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-capture-old-'))
  try {
    const result = await shot(runtimeFor(root), {})
    const io = seam.calls.filter((item) => item.argv[1] === 'simctl' && item.argv[2] === 'io')
    assert.equal(io.length, 2, 'exactly one retry, never a loop')
    assert.deepEqual(io[1]?.argv.slice(3), [DEFAULT_UDID, 'screenshot', result.absolutePath], 'the retry drops the flag')
    assert.ok(result.bytes > 0, 'the plain command is the one that captured the PNG')
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a capture that failed for any other reason is not retried', async () => {
  seam.reset()
  seam.allowMutations = true
  // A device that cannot be captured is not an old `simctl`; retrying would only
  // run the failing command twice and report the second failure as the cause.
  seam.io.push({ code: 1, stderr: 'An error was encountered processing the command (code=2): unable to boot device\n' })
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-capture-fail-'))
  try {
    await assert.rejects(() => shot(runtimeFor(root), {}), /unable to boot device/)
    assert.equal(seam.calls.filter((item) => item.argv[2] === 'io').length, 1, 'a failed capture is reported, not retried')
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a device pair is never the fallback target, but naming one still selects it', () => {
  // A pair is one `simctl` entry driving two displays; it is a valid explicit
  // target, and a machine that has nothing else must still return it.
  const list = parseSimulators(
    devicesPayload([
      { name: 'iPhone Duo', udid: PAIR_UDID, state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: PAIR_TYPE },
      { name: 'iPhone 18 Pro', udid: PHONE_UDID, state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: PHONE_TYPE },
    ]),
  )
  assert.equal(list[0]?.deviceType, PAIR_TYPE, 'the device type is parsed out of the payload')
  assert.equal('deviceType' in (list[1] ?? {}), true)
  assert.equal(chooseSimulator(list, {}).name, 'iPhone 18 Pro', 'an unnamed request must not fall back to the pair')
  assert.equal(chooseSimulator(list, { device: 'Duo' }).name, 'iPhone Duo', 'an explicit name is a request, not a fallback')
  assert.equal(chooseSimulator(list, { device: 'iPhone Duo' }).name, 'iPhone Duo')

  const pairOnly = parseSimulators(
    devicesPayload([{ name: 'iPhone Duo', udid: PAIR_UDID, state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: PAIR_TYPE }]),
  )
  assert.equal(chooseSimulator(pairOnly, {}).name, 'iPhone Duo', 'a pair is still a target when it is the only device')
})

test('a payload without a device type leaves the field out rather than setting it', () => {
  // An older `simctl` carries no `deviceTypeIdentifier`; an absent field and a
  // field holding `undefined` are the same thing to a JSON value, and only the
  // first is what the record type describes.
  const [first] = parseSimulators(devicesPayload([{ name: 'iPhone 17', udid: PHONE_UDID, state: 'Booted', isAvailable: true }]))
  assert.ok(first)
  assert.equal('deviceType' in first, false)
  assert.equal(chooseSimulator([first], {}).name, 'iPhone 17')
})

test('the default capture target is a single device on a machine that lists a pair first', async () => {
  // The reported path: no device matches the configured default, `simctl` lists
  // the pair first, and the capture then came back black. The whole provider
  // path is exercised here, not only the picker.
  seam.reset()
  seam.allowMutations = true
  seam.devices = devicesPayload([
    { name: 'iPhone Duo', udid: PAIR_UDID, state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: PAIR_TYPE },
    { name: 'iPhone 18 Pro', udid: PHONE_UDID, state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: PHONE_TYPE },
  ])
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-pair-'))
  try {
    const result = await shot(runtimeFor(root), {})
    assert.equal(result.simulator.udid, PHONE_UDID)
    assert.equal(result.simulator.name, 'iPhone 18 Pro')
    assert.deepEqual(
      seam.calls.filter((item) => item.line.includes(PAIR_UDID)).map((item) => item.line),
      [],
      'the pair must be neither booted nor captured',
    )
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('booting a shut-down simulator enumerates the device list exactly once', async () => {
  // The device is proven running by `boot` + `bootstatus` returning; reading the
  // list again to learn that doubles the enumeration and adds a second failure
  // point after the simulator is already up.
  seam.reset()
  seam.allowMutations = true
  seam.devices = devicesPayload([
    { name: 'iPhone 18 Pro', udid: PHONE_UDID, state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: PHONE_TYPE },
  ])
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-boot-'))
  try {
    const sim = await boot(runtimeFor(root), {})
    assert.equal(sim.state, 'Booted')
    assert.equal(seam.calls.filter((item) => item.line === 'xcrun simctl list devices --json').length, 1)
    assert.deepEqual(
      seam.calls.filter((item) => item.argv[1] === 'simctl').map((item) => item.argv[2]),
      ['list', 'boot', 'bootstatus'],
      'the boot verbs run in order, with no list after them',
    )
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a build whose DerivedData escapes the workspace is refused before any simulator exists', async () => {
  seam.reset()
  seam.allowMutations = true
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-escape-'))
  const outside = path.join(os.tmpdir(), `dsh-outside-${process.pid}-${Date.now()}`)
  try {
    const rt = await projectRuntime(root)
    const before = seam.commands.length
    await assert.rejects(
      () => app(rt, { derivedDataPath: path.relative(root, outside) }),
      /escapes the session workspace/,
    )
    const added = seam.commands.slice(before)
    assert.deepEqual(added.filter((line) => line.includes('simctl')), [], 'a refused build must not resolve a simulator')
    // The discovery that runs first is expected; the refusal is what must come
    // before the boot.
    assert.ok(added.some((line) => line.startsWith('xcodebuild -list')), 'the project was discovered first')
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a capture whose path escapes the workspace is refused before any simulator exists', async () => {
  seam.reset()
  seam.allowMutations = true
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-shot-escape-'))
  try {
    const before = seam.commands.length
    await assert.rejects(() => shot(runtimeFor(root), { path: '../../escape.png' }), /escapes the session workspace/)
    assert.deepEqual(seam.commands.slice(before), [], 'a refused capture must not touch a simulator')
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed build reports the end of the output, where the failure summary is', async () => {
  // xcodebuild prints the compiler warm-up first and the diagnosis last, so a
  // report that keeps the head shows everything except the reason.
  seam.reset()
  seam.allowMutations = true
  const warmUp = Array.from({ length: 400 }, (_, index) => `CompileC SomeFile${index}.swift normal arm64`).join('\n')
  seam.build = { code: 65, stdout: `${warmUp}\n** BUILD FAILED **\n` }
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-tail-'))
  try {
    const report = await app(await projectRuntime(root), {})
    assert.equal(report.ok, false)
    assert.ok(report.output.endsWith('** BUILD FAILED **'), 'the report must end with the line that names the failure')
    assert.match(report.output, /^\.\.\.\[truncated \d+ characters\]/, 'the head is what gets cut, not the tail')
    assert.doesNotMatch(report.output, /CompileC SomeFile0\.swift/, 'the compiler warm-up is what was cut')
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed build resolves no bundle id and names no product', async () => {
  // A bundle id resolved through `-showBuildSettings` after a failed build is a
  // value that was never built: two extra xcodebuild calls and a report the
  // next step cannot use.
  seam.reset()
  seam.allowMutations = true
  seam.build = { code: 65, stdout: '** BUILD FAILED **\n' }
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-nobundle-'))
  try {
    const report = await app(await projectRuntime(root), {})
    assert.equal(report.ok, false)
    const lines = seam.calls.map((item) => item.line)
    assert.deepEqual(lines.filter((line) => line.includes('-showBuildSettings')), [], 'no build settings were read')
    assert.deepEqual(lines.filter((line) => line.startsWith('plutil ')), [], 'no product Info.plist was read')
    assert.equal('bundleId' in report, false)
    assert.equal('bundleIdSource' in report, false)
    assert.equal('appPath' in report, false)
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a build whose log cannot be written still reports its real verdict', async () => {
  // The log is a convenience. A data directory that cannot hold one — here it is
  // a regular file — must not turn a finished build into a failed tool call, and
  // the host logger is where the user can still learn the log is missing.
  seam.reset()
  seam.allowMutations = true
  seam.build = { code: 65, stdout: '** BUILD FAILED **\n' }
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-nolog-'))
  const blocker = path.join(root, 'data-is-a-file')
  try {
    await writeFile(blocker, 'not a directory\n', 'utf8')
    const warnings = []
    const rt = runtimeFor(root, {
      config: { dataDir: blocker },
      logger: { info() {}, warn: (message) => warnings.push(message), error() {} },
    })
    await create(rt, { name: 'Demo' })
    const report = await app(rt, { derivedDataPath: 'DerivedData' })
    assert.equal(report.ok, false, 'the build verdict is the one that was produced')
    assert.equal(report.code, 65)
    assert.equal('logPath' in report, false)
    assert.equal(warnings.length, 1, `expected one warning, got ${JSON.stringify(warnings)}`)
    assert.match(warnings[0], /could not write the build log/)
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a huge build log keeps both ends and stays under the cap', async () => {
  // The command line is at the top of a log and the failure summary at the
  // bottom, so a cap that keeps only one end throws away half the evidence; the
  // cap itself is what keeps a runaway build from filling the disk.
  seam.reset()
  seam.allowMutations = true
  const headMarker = 'HEAD-MARKER the command line follows'
  const tailMarker = 'TAIL-MARKER ** BUILD FAILED **'
  const middle = 'CompileC SomeSwiftFile.swift normal arm64\n'.repeat(20_000)
  seam.build = { code: 65, stdout: `${headMarker}\n${middle}${tailMarker}\n` }
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-caplog-'))
  try {
    const report = await app(await projectRuntime(root), {})
    assert.equal(report.ok, false)
    assert.ok(report.logPath, 'the log was written')
    const log = await readFile(path.resolve(root, report.logPath), 'utf8')
    assert.ok(log.includes(headMarker), 'the head of the log must survive the cap')
    assert.ok(log.includes(tailMarker), 'the tail of the log must survive the cap')
    assert.match(log, /\[truncated \d+ characters\]/, 'the cut must be visible in the file')
    assert.ok(Buffer.byteLength(log, 'utf8') < 512 * 1024, `the log is ${Buffer.byteLength(log, 'utf8')} bytes`)
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a macro-sandbox retry with almost no budget left is skipped, and the report says so', async () => {
  // A retry started with the last few milliseconds of the budget is killed
  // inside its own timeout and its empty output makes the report look as if the
  // repair had been attempted and failed. The budget is shared across both
  // attempts, so the retry must not run at all here — and the report must not
  // claim a retry that never happened.
  seam.reset()
  seam.allowMutations = true
  seam.build = { code: 1, stderr: MACRO_SANDBOX_DENIED, delayMs: 600 }
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-macro-'))
  try {
    const report = await app(await projectRuntime(root), { timeoutMs: 700 })
    assert.equal(builds().length, 1, 'the retry must not be attempted with a spent budget')
    assert.equal('macroSandboxRetry' in report, false, 'the flag is reserved for a retry that ran')
    assert.match(report.output, /--- macro sandbox retry skipped: only \d+ ms of the build budget was left/)
    assert.match(report.output, /sandbox_apply: Operation not permitted/)
    assert.equal(report.ok, false)
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a macro-sandbox failure with budget left is retried once, with the sandbox off', async () => {
  // The positive control for the case above: the same failure, with a budget the
  // retry can use, still runs it — once — and the report keeps both attempts.
  seam.reset()
  seam.allowMutations = true
  seam.build = { code: 1, stderr: MACRO_SANDBOX_DENIED, delayMs: 200 }
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-macro-retry-'))
  try {
    const report = await app(await projectRuntime(root), { timeoutMs: 20_000 })
    const attempts = builds()
    assert.equal(attempts.length, 2, 'one retry, not a loop')
    assert.doesNotMatch(attempts[0] ?? '', /OTHER_SWIFT_FLAGS/)
    assert.match(attempts[1] ?? '', /OTHER_SWIFT_FLAGS=-disable-sandbox build$/)
    assert.equal(report.macroSandboxRetry, true)
    assert.match(report.output, /^--- first attempt \(macro sandbox\) ---\n/)
    assert.match(report.output, /\n--- retry ---\n/)
    assert.equal(report.ok, false)
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a shutdown refused because the device is still running is a failure, not a no-op', async () => {
  // The no-op is only for a device that is already down. Any other state named
  // in the refusal means the simulator is still running, and reporting that as a
  // successful shutdown leaves the user with a device they believe is stopped.
  seam.reset()
  seam.allowMutations = true
  seam.simctl.shutdown = { code: 1, stderr: 'Unable to shutdown device in current state: Booted' }
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-shutdown-fail-'))
  try {
    await assert.rejects(() => shutdown(runtimeFor(root), {}), /current state: Booted/)
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('a shutdown refused because the device is already down is the documented no-op', async () => {
  seam.reset()
  seam.allowMutations = true
  seam.simctl.shutdown = { code: 1, stderr: 'Unable to shutdown device in current state: Shutdown' }
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-life-shutdown-noop-'))
  try {
    const result = await shutdown(runtimeFor(root), {})
    assert.equal(result.shutdown, true, 'the device is down either way')
    assert.equal(result.alreadyShutdown, true)
    assert.equal(result.wasBooted, true, 'the device was running before the command')
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

test('the cases above reach no unstubbed command', () => {
  assert.deepEqual(seam.unknown, [], 'an unstubbed command was reached; stub it in test/helpers/offline-seam.mjs')
})
