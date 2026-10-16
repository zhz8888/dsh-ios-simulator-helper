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
 * @module dsh-ios-simulator-helper/providers/sim
 */

/** A UDID as `simctl` prints it: hex groups with dashes. */
const UDID = /^[0-9A-Fa-f-]{8,}$/

/** Whether a string is a plausible simulator UDID. */
export function validUdid(udid) {
  return typeof udid === 'string' && UDID.test(udid)
}

/** Whether a `simctl` runtime key denotes iOS or iPadOS (not watchOS/tvOS/visionOS). */
export function isIosRuntime(runtime) {
  return /(?:^|[.\s-])(iOS|iPadOS)(?:$|[.\s-])/.test(String(runtime ?? ''))
}

/**
 * Flatten `simctl list devices --json` into the plugin's device records.
 *
 * @param {string} value - the raw JSON.
 * @returns {Array<{name: string, udid: string, state: string, runtime: string, available: boolean}>} iOS devices.
 */
export function parseSimulators(value) {
  const raw = JSON.parse(value)
  return Object.entries(raw.devices ?? {}).flatMap(([runtime, devices]) => {
    if (!isIosRuntime(runtime)) return []
    return (Array.isArray(devices) ? devices : [])
      .filter((item) => typeof item === 'object' && item !== null)
      .map((item) => ({
        name: String(item.name ?? ''),
        udid: String(item.udid ?? ''),
        state: String(item.state ?? ''),
        runtime,
        available: item.isAvailable !== false && item.availabilityError === undefined,
      }))
      .filter((item) => item.name && item.udid)
  })
}

/**
 * Flatten `simctl list runtimes --json` into runtime records.
 *
 * The original plugin never listed runtimes; preflight only inferred their
 * presence from the device list. A runtime is what an iOS SDK lives in, so the
 * diagnostic names them and the settings page offers them as suggestions.
 *
 * @param {string} value - the raw JSON.
 * @returns {Array<{name: string, identifier: string, version: string, platform: string, available: boolean}>} iOS runtimes.
 */
export function parseRuntimes(value) {
  const raw = JSON.parse(value)
  const runtimes = Array.isArray(raw.runtimes) ? raw.runtimes : []
  return runtimes
    .filter((item) => typeof item === 'object' && item !== null)
    .map((item) => ({
      name: String(item.name ?? ''),
      identifier: String(item.identifier ?? ''),
      version: String(item.version ?? ''),
      platform: String(item.platform ?? ''),
      available: item.isAvailable !== false,
    }))
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
 * @param {Array<object>} simulators - parsed device records.
 * @param {{udid?: string, device?: string, name?: string, runtime?: string}} input - the tool arguments.
 * @param {Record<string, unknown>} [settings] - live plugin settings.
 * @returns {object} the chosen device record.
 * @throws {Error} when the list holds no usable device.
 */
export function chooseSimulator(simulators, input = {}, settings = {}) {
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
  const byName = candidates.find((item) => item.name.toLowerCase().includes(want))
  if (byName) return byName

  const phone = candidates.find((item) => item.name.startsWith('iPhone'))
  if (phone) return phone

  return candidates[0]
}

/** Narrow a device list to one runtime fragment, or return it unchanged. */
function byRuntime(items, runtime) {
  if (runtime === undefined) return items
  return items.filter((item) => String(item.runtime).includes(runtime))
}

/** `undefined` for a missing or blank string. */
function stringOrUndefined(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/** The distinct runtimes in a device list, for an error message. */
function knownRuntimes(items) {
  const names = [...new Set(items.map((item) => item.runtime))].sort()
  return names.length > 0 ? names.join(', ') : 'none'
}

/** The one "no device" error, shared by both paths. */
function noSimulatorError() {
  return new Error(
    'No available iOS simulators found. Install an iOS Simulator runtime from Xcode > Settings > Platforms.',
  )
}

/**
 * List every iOS simulator `simctl` reports.
 *
 * @param {object} rt - the call runtime.
 * @returns {Promise<Array<object>>} the device records.
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
 * @param {object} rt - the call runtime.
 * @returns {Promise<Array<object>>} the runtime records.
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
 * @param {object} rt - the call runtime.
 * @param {{udid?: string, name?: string, runtime?: string}} [input] - the tool arguments.
 * @returns {Promise<object>} the chosen device record.
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
 * @param {object} rt - the call runtime.
 * @param {{udid?: string, name?: string, runtime?: string, open?: boolean}} [input] - the tool arguments.
 * @returns {Promise<object>} the booted device record plus `opened`.
 */
export async function boot(rt, input = {}) {
  const sim = await pick(rt, input)
  const open = input.open ?? false
  if (sim.state !== 'Booted') {
    if (!rt.settings.autoBootSimulator) {
      throw new Error(
        `Simulator ${sim.name} (${sim.udid}) is not booted, and "Boot the simulator automatically" is off on the `
          + 'Settings -> iOS Simulator page. Boot it in Simulator.app or enable that setting.',
      )
    }
    const out = await run(['xcrun', 'simctl', 'boot', sim.udid], { timeout: rt.settings.bootTimeoutMs })
    if (!ok(out) && !brief(out).includes('current state: Booted')) throw new Error(brief(out))
    const ready = await run(['xcrun', 'simctl', 'bootstatus', sim.udid, '-b'], { timeout: rt.settings.bootTimeoutMs })
    if (!ok(ready)) throw new Error(brief(ready))
  }
  if (open) await show(rt, sim.udid)
  return { ...(await pick(rt, { udid: sim.udid })), opened: Boolean(open) }
}

/**
 * Open the macOS Simulator app, optionally focused on one device.
 *
 * @param {object} rt - the call runtime.
 * @param {string} [udid] - the device to focus.
 * @returns {Promise<{opened: boolean, udid?: string, fallback?: boolean}>} the outcome.
 */
export async function show(rt, udid) {
  requireMacOS(rt)
  const args = udid ? ['open', '-a', 'Simulator', '--args', '-CurrentDeviceUDID', udid] : ['open', '-a', 'Simulator']
  const out = await run(args, { timeout: 10_000 })
  if (ok(out)) return { opened: true, udid }
  const fallback = await run(['open', '-a', 'Simulator'], { timeout: 10_000 })
  if (ok(fallback)) return { opened: true, udid, fallback: true }
  throw new Error(brief(out) || brief(fallback))
}

/**
 * Install an `.app` bundle on a simulator.
 *
 * @param {object} rt - the call runtime.
 * @param {string} udid - the target device.
 * @param {string} app - absolute path of the `.app` bundle.
 * @returns {Promise<{installed: boolean, udid: string, app: string}>} the outcome.
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
 * @param {object} rt - the call runtime.
 * @param {string} udid - the target device.
 * @param {string} bundle - the bundle identifier.
 * @param {string[]} [args] - launch arguments.
 * @returns {Promise<object>} the outcome, including the process id when simctl prints one.
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
 * @param {object} rt - the call runtime.
 * @param {string} udid - the target device.
 * @param {string} bundle - the bundle identifier.
 * @returns {Promise<object>} the outcome.
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
 * @param {object} rt - the call runtime.
 * @param {string} udid - the target device.
 * @param {string} value - the URL.
 * @returns {Promise<object>} the outcome.
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
 * @param {object} rt - the call runtime.
 * @param {{udid?: string, name?: string, runtime?: string}} [input] - the tool arguments.
 * @returns {Promise<object>} the outcome.
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
