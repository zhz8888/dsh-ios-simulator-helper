import { existsSync } from 'node:fs'
import path from 'node:path'
import { brief, ok, run } from '../util/run.js'
import { defaultDeviceFragment } from '../settings.js'
import { requireMacOS } from './host.js'

/**
 * `simctl` device operations.
 *
 * Ported from the ZCode plugin's `providers/sim.ts`. The command lines, the
 * UDID validation and the fallback order are unchanged; what changed is that
 * the selection rules are a pure function of (simulators, arguments, settings)
 * instead of reading `process.env.IOS_SIM_DEFAULT_DEVICE` inside the picker —
 * so the order is testable and the default device is editable in the app.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/providers/sim
 */

/**
 * One simulator device, as `simctl` reports it.
 *
 * @typedef {object} SimulatorRecord
 * @property {string} name - the device name, e.g. "iPhone 17".
 * @property {string} udid - the device UDID.
 * @property {string} state - the device state, e.g. "Booted" or "Shutdown".
 * @property {string} runtime - the runtime key the device belongs to.
 * @property {boolean} available - whether the device can be used at all.
 */

/**
 * One installed iOS runtime.
 *
 * @typedef {object} RuntimeRecord
 * @property {string} name - the runtime name, e.g. "iOS 27.1".
 * @property {string} identifier - the runtime identifier.
 * @property {string} version - the runtime version.
 * @property {string} platform - the platform name, e.g. "iOS".
 * @property {boolean} available - whether the runtime can be used.
 */

/**
 * A booted simulator, plus what happened to the window.
 *
 * @typedef {SimulatorRecord & {opened: boolean, openWarning?: string}} BootResult
 */

/**
 * The outcome of an install.
 *
 * @typedef {object} InstallResult
 * @property {boolean} installed - whether the bundle was installed.
 * @property {string} udid - the device it was installed on.
 * @property {string} app - the absolute path of the installed bundle.
 */

/**
 * The outcome of a launch.
 *
 * @typedef {object} LaunchResult
 * @property {boolean} launched - whether the app started.
 * @property {string} udid - the device it was started on.
 * @property {string} bundle - the bundle identifier that was launched.
 * @property {string[]} launchArgs - the arguments it was launched with.
 * @property {string} output - what `simctl` printed.
 */

/**
 * The outcome of a terminate.
 *
 * @typedef {object} TerminateResult
 * @property {boolean} terminated - whether the app was stopped.
 * @property {string} udid - the device it ran on.
 * @property {string} bundle - the bundle identifier that was stopped.
 */

/**
 * The outcome of an open-url.
 *
 * @typedef {object} OpenUrlResult
 * @property {boolean} opened - whether the URL was opened.
 * @property {string} udid - the device it was opened on.
 * @property {string} url - the URL that was opened.
 */

/**
 * The outcome of a shutdown.
 *
 * @typedef {object} ShutdownResult
 * @property {boolean} shutdown - whether the shutdown command was accepted.
 * @property {boolean} wasBooted - whether the device was running before.
 * @property {boolean} alreadyShutdown - whether there was nothing to stop.
 * @property {SimulatorRecord} simulator - the device the call targeted.
 * @property {string} output - what `simctl` printed.
 */

/**
 * One `open` command line the window-app search tries.
 *
 * @typedef {object} AppRecord
 * @property {string} app - the display name of the window app.
 * @property {string[]} args - the argv vector to run.
 */

/** A UDID as `simctl` prints it: hex groups with dashes. */
const UDID = /^[0-9A-Fa-f-]{8,}$/

/**
 * Whether a string is a plausible simulator UDID.
 *
 * @param {unknown} udid - the candidate; anything that is not a string fails.
 * @returns {boolean} true when it looks like a UDID.
 */
export function validUdid(udid) {
  return typeof udid === 'string' && UDID.test(udid)
}

/**
 * Whether a `simctl` runtime key denotes iOS or iPadOS (not watchOS/tvOS/visionOS).
 *
 * @param {unknown} runtime - the runtime key or name.
 * @returns {boolean} true for iOS and iPadOS only.
 */
export function isIosRuntime(runtime) {
  return /(?:^|[.\s-])(iOS|iPadOS)(?:$|[.\s-])/.test(String(runtime ?? ''))
}

/**
 * Read a `simctl --json` payload as an object.
 *
 * `JSON.parse('null')` yields `null`, and a property read on it throws a
 * `TypeError` that says nothing about the plugin — so a payload that is not an
 * object reads as "nothing here", the same way an empty device list does.
 *
 * @param {string} value - the raw JSON.
 * @returns {Record<string, unknown> | undefined} the payload, when it is an object.
 */
function parsePayload(value) {
  const raw = /** @type {unknown} */ (JSON.parse(value))
  if (typeof raw !== 'object' || raw === null) return undefined
  return /** @type {Record<string, unknown>} */ (raw)
}

/**
 * Flatten `simctl list devices --json` into the plugin's device records.
 *
 * @param {string} value - the raw JSON.
 * @returns {SimulatorRecord[]} iOS devices.
 */
export function parseSimulators(value) {
  const raw = parsePayload(value)
  const devices = raw?.devices
  if (typeof devices !== 'object' || devices === null) return []
  return Object.entries(/** @type {Record<string, unknown>} */ (devices)).flatMap(([runtime, list]) => {
    if (!isIosRuntime(runtime)) return []
    if (!Array.isArray(list)) return []
    return /** @type {unknown[]} */ (list)
      .flatMap((item) => {
        if (typeof item !== 'object' || item === null) return []
        const device = /** @type {Record<string, unknown>} */ (item)
        return [{
          name: String(device.name ?? ''),
          udid: String(device.udid ?? ''),
          state: String(device.state ?? ''),
          runtime,
          available: device.isAvailable !== false && device.availabilityError === undefined,
        }]
      })
      .filter((item) => item.name && item.udid)
  })
}

/**
 * Flatten `simctl list runtimes --json` into runtime records.
 *
 * The original plugin never listed runtimes; preflight only inferred their
 * presence from the device list. A runtime is what an iOS SDK lives in, so the
 * diagnostic names them and the configuration page offers them as suggestions.
 *
 * @param {string} value - the raw JSON.
 * @returns {RuntimeRecord[]} iOS runtimes.
 */
export function parseRuntimes(value) {
  const raw = parsePayload(value)
  const runtimes = raw?.runtimes
  if (!Array.isArray(runtimes)) return []
  return /** @type {unknown[]} */ (runtimes)
    .flatMap((item) => {
      if (typeof item !== 'object' || item === null) return []
      const runtime = /** @type {Record<string, unknown>} */ (item)
      return [{
        name: String(runtime.name ?? ''),
        identifier: String(runtime.identifier ?? ''),
        version: String(runtime.version ?? ''),
        platform: String(runtime.platform ?? ''),
        available: runtime.isAvailable !== false,
      }]
    })
    .filter((item) => item.identifier && isIosRuntime(`${item.platform} ${item.identifier} ${item.name}`))
}

/**
 * Choose one simulator from a device list.
 *
 * The order is the original plugin's:
 *
 *   1. an explicit UDID, which must exist;
 *   2. an already-booted simulator, but only when the call named neither a
 *      device nor a runtime (naming either is an explicit request);
 *   3. the configured default device fragment (`iPhone 16` by default), then
 *      any iPhone, then the first available device — each filtered by the
 *      requested or configured runtime.
 *
 * `device` is the tool-facing argument name and `name` the provider-facing one;
 * both are accepted so a tool can hand its arguments straight through.
 *
 * @param {SimulatorRecord[]} simulators - parsed device records.
 * @param {{udid?: string | undefined, device?: string | undefined, name?: string | undefined,
 *   runtime?: string | undefined}} input - the tool arguments.
 * @param {import('../settings.js').Settings} [settings] - live plugin settings.
 * @returns {SimulatorRecord} the chosen device record.
 * @throws {Error} when the list holds no usable device.
 */
export function chooseSimulator(simulators, input = {}, settings = /** @type {import('../settings.js').Settings} */ ({})) {
  const list = Array.isArray(simulators) ? simulators : []
  const name = input.name ?? input.device
  if (input.udid !== undefined) {
    const hit = list.find((item) => item.udid === input.udid)
    if (hit) return hit
    throw new Error(`Simulator not found: ${input.udid}`)
  }

  const available = list.filter((item) => item.available)
  if (available.length === 0) throw noSimulatorError()

  // An explicit runtime is a requirement; the configured one is only a
  // preference, so a stale default silently widens the pool instead of
  // breaking every call.
  const requested = stringOrUndefined(input.runtime)
  const pool = byRuntime(available, requested)
  if (pool.length === 0) {
    throw new Error(
      `No available iOS simulator matches runtime "${requested}". Installed runtimes: ${knownRuntimes(available)}.`,
    )
  }
  const preferred = byRuntime(pool, stringOrUndefined(settings.defaultRuntime))
  const candidates = preferred.length > 0 ? preferred : pool

  const booted = candidates.find((item) => item.state === 'Booted')
  if (booted && name === undefined && requested === undefined) return booted

  const want = String(name || defaultDeviceFragment(settings)).toLowerCase()
  // An exact name beats a substring hit, because the installed list holds both
  // "iPhone 17" and "iPhone 17e" and a request for the first used to resolve to
  // whichever `simctl` happened to list first.
  const exact = candidates.find((item) => item.name.toLowerCase() === want)
  if (exact) return exact
  const byName = candidates.find((item) => item.name.toLowerCase().includes(want))
  if (byName) return byName

  const phone = candidates.find((item) => item.name.startsWith('iPhone'))
  if (phone) return phone

  // The pool was checked to hold a device above, so the first candidate exists.
  return /** @type {SimulatorRecord} */ (candidates[0])
}

/**
 * Narrow a device list to one runtime fragment, or return it unchanged.
 *
 * @param {SimulatorRecord[]} items - the candidates.
 * @param {string | undefined} runtime - the runtime fragment to match.
 * @returns {SimulatorRecord[]} the candidates that match.
 */
function byRuntime(items, runtime) {
  if (runtime === undefined) return items
  return items.filter((item) => String(item.runtime).includes(runtime))
}

/**
 * `undefined` for a missing or blank string.
 *
 * @param {unknown} value - the candidate.
 * @returns {string | undefined} the trimmed string, when it carries anything.
 */
function stringOrUndefined(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * The distinct runtimes in a device list, for an error message.
 *
 * @param {SimulatorRecord[]} items - the devices.
 * @returns {string} the runtime names, comma separated.
 */
function knownRuntimes(items) {
  const names = [...new Set(items.map((item) => item.runtime))].sort()
  return names.length > 0 ? names.join(', ') : 'none'
}

/**
 * The one "no device" error, shared by both paths.
 *
 * @returns {Error} the error to throw.
 */
function noSimulatorError() {
  return new Error(
    'No available iOS simulators found. Install an iOS Simulator runtime from Xcode > Settings > Platforms.',
  )
}

/**
 * List every iOS simulator `simctl` reports.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @returns {Promise<SimulatorRecord[]>} the device records.
 */
export async function list(rt) {
  requireMacOS(rt)
  const out = await run(['xcrun', 'simctl', 'list', 'devices', '--json'], { timeout: 20_000 })
  if (!ok(out)) throw new Error(brief(out))
  return parseSimulators(out.stdout)
}

/**
 * List every installed iOS runtime.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @returns {Promise<RuntimeRecord[]>} the runtime records.
 */
export async function listRuntimes(rt) {
  requireMacOS(rt)
  const out = await run(['xcrun', 'simctl', 'list', 'runtimes', '--json'], { timeout: 20_000 })
  if (!ok(out)) throw new Error(brief(out))
  return parseRuntimes(out.stdout)
}

/**
 * Resolve the simulator a call targets.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {{udid?: string | undefined, name?: string | undefined, device?: string | undefined,
 *   runtime?: string | undefined}} [input] - the tool arguments.
 * @returns {Promise<SimulatorRecord>} the chosen device record.
 */
export async function pick(rt, input = {}) {
  if (input.udid !== undefined && !validUdid(input.udid)) {
    throw new Error(`Invalid simulator UDID: ${input.udid}`)
  }
  return chooseSimulator(await list(rt), input, rt.settings)
}

/**
 * Boot the target simulator (unless it already is) and optionally show it.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {{udid?: string | undefined, name?: string | undefined, device?: string | undefined,
 *   runtime?: string | undefined, open?: boolean | undefined}} [input] - the tool arguments.
 * @returns {Promise<BootResult>} the booted device record, plus `opened` (whether the window actually opened) and
 *   `openWarning` when a requested window could not be opened.
 */
export async function boot(rt, input = {}) {
  const sim = await pick(rt, input)
  const open = input.open ?? false
  let opened = false
  /** @type {string | undefined} */
  let openWarning
  if (sim.state !== 'Booted') {
    if (!rt.settings.autoBootSimulator) {
      throw new Error(
        `Simulator ${sim.name} (${sim.udid}) is not booted, and "Boot the simulator automatically" is off on the `
          + 'Settings -> iOS Simulator page. Boot it in the Simulator app (Device Hub on Xcode 26 and later), or '
          + 'enable that setting.',
      )
    }
    // The setting is in seconds; a child-process timeout is milliseconds.
    const bootTimeout = rt.settings.bootTimeoutSeconds * 1000
    const out = await run(['xcrun', 'simctl', 'boot', sim.udid], { timeout: bootTimeout })
    if (!ok(out) && !brief(out).includes('current state: Booted')) throw new Error(brief(out))
    const ready = await run(['xcrun', 'simctl', 'bootstatus', sim.udid, '-b'], { timeout: bootTimeout })
    if (!ok(ready)) throw new Error(brief(ready))
  }
  if (open) {
    try {
      const shown = await show(rt, sim.udid)
      opened = shown.opened
    } catch (error) {
      // Showing the window is a convenience, never the operation itself. A Mac
      // where the window app cannot be launched — Xcode 26 replaced
      // Simulator.app with Device Hub, and a headless CI session has no GUI at
      // all — must still boot, install, launch and capture. The failure is
      // reported in the result instead of thrown.
      openWarning = error instanceof Error ? error.message : String(error)
    }
  }
  return {
    ...(await pick(rt, { udid: sim.udid })),
    opened,
    ...(openWarning === undefined ? {} : { openWarning }),
  }
}

/** The window apps Xcode has shipped, by display name, app file and bundle id. */
const SIMULATOR_APPS = [
  { app: 'Simulator', file: 'Simulator.app', bundle: 'com.apple.iphonesimulator' },
  { app: 'DeviceHub', file: 'DeviceHub.app', bundle: 'com.apple.dt.Devices' },
]

/**
 * Every remaining way to open a simulator window, in the order to try them.
 *
 * Xcode has shipped the window app in two layouts and both are in the wild:
 * Xcode 25 and earlier put `Simulator.app` under `Contents/Developer/
 * Applications`, while Xcode 26 replaced it with `DeviceHub.app` under
 * `Contents/Applications` (bundle id `com.apple.dt.Devices`, display name
 * "DeviceHub"). Only `open -a Simulator` is documented to focus one device, so
 * that attempt is made separately and first, and a Device Hub is simply opened
 * — its per-device argument is not something this can verify.
 *
 * @param {string | undefined} developerDir - `xcode-select -p` when it could be read.
 * @param {string | undefined} [udid] - the device to focus, when the app supports it.
 * @param {(file: string) => boolean} [exists] - existence probe, injectable for tests.
 * @returns {AppRecord[]} ordered `open` command lines.
 */
export function simulatorAppAttempts(developerDir, udid, exists = existsSync) {
  /** @type {AppRecord[]} */
  const attempts = []
  const focus = udid === undefined ? [] : ['--args', '-CurrentDeviceUDID', udid]
  if (focus.length > 0) attempts.push({ app: 'Simulator', args: ['open', '-a', 'Simulator'] })

  const roots = [
    ...(developerDir === undefined
      ? []
      : [path.join(developerDir, 'Applications'), path.join(developerDir, '..', 'Applications')]),
    '/Applications',
  ]
  const seen = new Set()
  for (const root of roots) {
    for (const candidate of SIMULATOR_APPS) {
      const file = path.resolve(root, candidate.file)
      if (seen.has(file) || !exists(file)) continue
      seen.add(file)
      attempts.push({
        app: candidate.app,
        args: candidate.app === 'Simulator' ? ['open', file, ...focus] : ['open', file],
      })
    }
  }
  for (const candidate of SIMULATOR_APPS) {
    attempts.push({ app: candidate.app, args: ['open', '-b', candidate.bundle] })
  }
  return attempts
}

/**
 * Open the macOS app that displays simulators, focused on one device when the
 * app supports it.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} [udid] - the device to focus.
 * @returns {Promise<{opened: boolean, udid?: string, app: string}>} the outcome.
 * @throws {Error} when no installed app could be opened.
 */
export async function show(rt, udid) {
  requireMacOS(rt)
  /** @type {string[]} */
  const failures = []
  /**
   * One `open` attempt.
   *
   * @param {string} app - the display name of the window app.
   * @param {string[]} args - the argv vector to run.
   * @returns {Promise<{opened: boolean, udid?: string, app: string} | undefined>} the outcome, when it worked.
   */
  const attempt = async (app, args) => {
    const out = await run(args, { timeout: 10_000 })
    // The udid is left out rather than set to `undefined` when no device was
    // named: an absent field and a field holding `undefined` are the same
    // thing to a JSON value, and only the first is a value the type of the
    // result can describe.
    if (ok(out)) return { opened: true, ...(udid === undefined ? {} : { udid }), app }
    const reason = brief(out)
    if (reason.length > 0 && !failures.includes(reason)) failures.push(reason)
    return undefined
  }

  // The historical incantation, kept first so an Xcode that still ships
  // Simulator.app needs nothing else and pays for nothing else.
  const focus = udid === undefined ? [] : ['--args', '-CurrentDeviceUDID', udid]
  const named = await attempt('Simulator', ['open', '-a', 'Simulator', ...focus])
  if (named !== undefined) return named

  // The developer directory is read only now, once the cheap attempt failed.
  const dir = await run(['xcode-select', '-p'], { timeout: 10_000 })
  for (const candidate of simulatorAppAttempts(ok(dir) ? dir.stdout.trim() : undefined, udid)) {
    const opened = await attempt(candidate.app, candidate.args)
    if (opened !== undefined) return opened
  }

  throw new Error(
    'No simulator window app could be opened: neither Simulator.app (Xcode 25 and earlier) nor Device Hub '
      + '(Xcode 26 and later) was found for the selected developer directory. Simulators still run headlessly, '
      + `so every other tool keeps working. Tried: ${failures.join('; ') || 'open, which reported nothing'}.`,
  )
}

/**
 * Install an `.app` bundle on a simulator.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} udid - the target device.
 * @param {string} app - absolute path of the `.app` bundle.
 * @returns {Promise<InstallResult>} the outcome.
 */
export async function install(rt, udid, app) {
  requireMacOS(rt)
  if (!validUdid(udid)) throw new Error(`Invalid simulator UDID: ${udid}`)
  const out = await run(['xcrun', 'simctl', 'install', udid, app], { timeout: 120_000 })
  if (!ok(out)) throw new Error(brief(out))
  return { installed: true, udid, app }
}

/**
 * Launch an installed app.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} udid - the target device.
 * @param {string} bundle - the bundle identifier.
 * @param {string[]} [args] - launch arguments.
 * @returns {Promise<LaunchResult>} the outcome.
 */
export async function launch(rt, udid, bundle, args = []) {
  requireMacOS(rt)
  if (!validUdid(udid)) throw new Error(`Invalid simulator UDID: ${udid}`)
  const out = await run(['xcrun', 'simctl', 'launch', udid, bundle, ...args], { timeout: 60_000 })
  if (!ok(out)) throw new Error(brief(out))
  return { launched: true, udid, bundle, launchArgs: args, output: brief(out) }
}

/**
 * Terminate an installed app.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} udid - the target device.
 * @param {string} bundle - the bundle identifier.
 * @returns {Promise<TerminateResult>} the outcome.
 */
export async function terminate(rt, udid, bundle) {
  requireMacOS(rt)
  if (!validUdid(udid)) throw new Error(`Invalid simulator UDID: ${udid}`)
  const out = await run(['xcrun', 'simctl', 'terminate', udid, bundle], { timeout: 30_000 })
  if (!ok(out)) throw new Error(brief(out))
  return { terminated: true, udid, bundle }
}

/**
 * Open a URL in a simulator.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} udid - the target device.
 * @param {string} value - the URL.
 * @returns {Promise<OpenUrlResult>} the outcome.
 */
export async function openUrl(rt, udid, value) {
  requireMacOS(rt)
  if (!validUdid(udid)) throw new Error(`Invalid simulator UDID: ${udid}`)
  if (String(value).length > 2048) throw new Error('URL is too long.')
  const out = await run(['xcrun', 'simctl', 'openurl', udid, value], { timeout: 30_000 })
  if (!ok(out)) throw new Error(brief(out))
  return { opened: true, udid, url: value }
}

/**
 * Shut a simulator down.
 *
 * Not part of the original tool set — the original plugin could boot a
 * simulator but never stop one, which left every session with a device running
 * until the user closed it by hand. Shutting down an already-shut device is
 * reported as a successful no-op rather than an error, because the target is
 * resolved by `pick` and may legitimately be idle.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {{udid?: string | undefined, name?: string | undefined, device?: string | undefined,
 *   runtime?: string | undefined}} [input] - the tool arguments.
 * @returns {Promise<ShutdownResult>} the outcome.
 */
export async function shutdown(rt, input = {}) {
  requireMacOS(rt)
  const sim = await pick(rt, input)
  const wasBooted = sim.state === 'Booted'
  const out = await run(['xcrun', 'simctl', 'shutdown', sim.udid], { timeout: 30_000 })
  const text = brief(out)
  const alreadyShutdown = /current state: Shutdown|Unable to shutdown device in current state/i.test(text)
  if (!ok(out) && !alreadyShutdown) throw new Error(text)
  return {
    shutdown: true,
    wasBooted,
    alreadyShutdown: !wasBooted || alreadyShutdown,
    simulator: sim,
    output: text,
  }
}
