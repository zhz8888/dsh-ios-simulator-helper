import path from 'node:path'
import { brief, ok, run } from '../util/run.js'
import { defaultDeviceFragment } from '../settings.js'
import { hostInfo, platformLabel } from './host.js'
import { list, listRuntimes, parseRuntimes, parseSimulators, pick } from './sim.js'
import { status } from './ui.js'

/**
 * Environment diagnostics for the host and the plugin's configuration page.
 *
 * Ported from the ZCode plugin's `providers/preflight.ts`. The Xcode checks are
 * the original's (`xcode-select`, `xcodebuild`, `simctl`, devices, UI backend);
 * three things were added because the configuration page needs them:
 *
 *   - the macOS check now yields a structured `supported` verdict, and the rest
 *     of the probes are skipped entirely on another host instead of producing
 *     six confusing spawn failures;
 *   - an explicit `simulator runtimes` check, which is the real prerequisite
 *     for a device list, plus installed-runtime inventory;
 *   - an `iOS plugin defaults` check that echoes the values the user actually
 *     saved, so a mis-set default device is visible in the diagnostic.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/providers/preflight
 */

/**
 * Where the user edits the values these diagnostics report.
 *
 * The page lives on the plugin's own detail view in the Plugins panel, not in
 * the Settings dialog, so every user-visible fix hint that points at it says
 * this phrase. `test/providers.test.js` pins it and the two interpolations.
 */
export const PAGE_LOCATION = 'the iOS Simulator Helper page in the Plugins panel'

/**
 * One diagnostic finding.
 *
 * @typedef {object} PreflightCheck
 * @property {boolean} ok - whether the check passed.
 * @property {string} name - the check's name, as the report lists it.
 * @property {string} detail - what the check found.
 * @property {string} [fix] - how to make the check pass.
 */

/**
 * The whole diagnostic.
 *
 * `requiredPlatform` and `requiredPlatformLabel` are part of the report rather
 * than an extra on it: the `/ios-dev` command renders the label next to the
 * unsupported-host verdict and next to its closing advice, and the browser half
 * reads the same label off the `/host` route payload. A report type that
 * omitted them would describe a report that cannot say which platform the
 * plugin needs.
 *
 * @typedef {object} PreflightReport
 * @property {boolean} ok - whether every check passed.
 * @property {boolean} supported - whether this host can run the plugin at all.
 * @property {string} platform - the host platform identifier.
 * @property {string} arch - the host architecture.
 * @property {string} requiredPlatform - the only platform identifier that works.
 * @property {string} requiredPlatformLabel - that platform's user-facing name.
 * @property {PreflightCheck[]} checks - the checks, in the order they ran.
 * @property {import('../settings.js').Settings} settings - the live settings.
 * @property {string} [note] - why the Xcode probes were skipped.
 */

/**
 * The settings the configuration page would show as the current values.
 *
 * @typedef {object} InventoryCurrent
 * @property {string} dataRoot - the plugin's data root.
 * @property {string} screenshotsDir - where screenshots are written.
 * @property {string} derivedDataDir - where DerivedData is written.
 * @property {number} logSeconds - the default log window, in seconds.
 * @property {number} logLimit - the default log character limit.
 * @property {string} defaultConfiguration - the default Xcode configuration.
 * @property {string} defaultDevice - the default device-name fragment.
 * @property {string} defaultRuntime - the default runtime-name fragment.
 * @property {import('../settings.js').UIBackend} uiBackend - the selected UI backend.
 * @property {boolean} disableCodeSigning - whether builds skip code signing.
 */

/**
 * The UI backend status the inventory reports when no probe could run.
 *
 * The real status is a four-shaped union, but a host that never reached a
 * probe has no binary and no setting-driven backend to name, so it gets a flat
 * shape of its own.
 *
 * @typedef {object} InventoryUiStatus
 * @property {string} backend - the backend name.
 * @property {boolean} available - whether a UI command could run.
 * @property {string} setting - the backend the setting selected.
 * @property {string} detail - the explanation, in one sentence.
 */

/**
 * Everything the configuration page can offer as a choice, discovered on demand.
 *
 * @typedef {object} Inventory
 * @property {import('./host.js').HostInfo} host - the host verdict.
 * @property {string} platformLabel - the platform's user-facing name.
 * @property {boolean} supported - whether this host can run the plugin.
 * @property {string} [note] - why the probes were skipped.
 * @property {string | null} xcodePath - the developer directory, when it could be read.
 * @property {string | null} xcodeVersion - the Xcode version line.
 * @property {string | null} macOSVersion - the macOS product version.
 * @property {import('./sim.js').SimulatorRecord[]} simulators - the devices.
 * @property {string} [simulatorsError] - why the device list failed.
 * @property {import('./sim.js').RuntimeRecord[]} runtimes - the installed runtimes.
 * @property {string} [runtimesError] - why the runtime list failed.
 * @property {import('./sim.js').SimulatorRecord | null} defaultTarget - the device the plugin would pick.
 * @property {string} [defaultTargetError] - why the default device could not be resolved.
 * @property {import('./ui.js').UiStatus | InventoryUiStatus} ui - the UI backend status.
 * @property {InventoryCurrent} current - the settings the page would show.
 */

/**
 * Reduce the checks to one verdict.
 *
 * The original plugin required every check to pass, and so does this one: a
 * missing Xcode, a missing runtime or a missing device each break the workflow
 * that the tool set exists for. The UI backend check is `ok` for `auto` and
 * `none`, so a machine without `idb` is still "ready" for build/run/screenshot.
 *
 * @param {Array<{name: string, ok: boolean}>} checks - the preflight checks.
 * @returns {boolean} true when the environment can run the workflow.
 */
export function preflightOk(checks) {
  return checks.every((item) => item.ok)
}

/**
 * Run the full diagnostic.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @returns {Promise<PreflightReport>} the report.
 */
export async function preflight(rt) {
  const host = hostInfo({ platform: rt.platform })
  /** @type {PreflightCheck[]} */
  const checks = []

  checks.push({
    name: 'Host OS (macOS)',
    ok: host.supported,
    detail: host.detail,
    fix: host.supported
      ? `Requirements: ${host.requiredPlatformLabel} with full Xcode selected by xcode-select.`
      : `This plugin only supports ${host.requiredPlatformLabel}; on ${host.label} no simulator tool can run. Run DSH on a Mac.`,
  })

  /** The settings echo, always reported so a mis-set default is visible. */
  const defaults = {
    name: 'iOS plugin defaults',
    ok: true,
    detail: [
      `defaultDevice=${defaultDeviceFragment(rt.settings)}`,
      `defaultRuntime=${rt.settings.defaultRuntime || '(any)'}`,
      `autoBootSimulator=${rt.settings.autoBootSimulator}`,
      `autoOpenSimulator=${rt.settings.autoOpenSimulator}`,
      `uiBackend=${rt.settings.uiBackend}`,
      `configuration=${rt.settings.defaultConfiguration}`,
      `dataRoot=${displayDataRoot(rt)}`,
    ].join('\n'),
    fix: `Edit these on ${PAGE_LOCATION}.`,
  }

  if (!host.supported) {
    checks.push(defaults)
    return {
      ok: false,
      supported: false,
      platform: host.platform,
      arch: host.arch,
      requiredPlatform: host.requiredPlatform,
      requiredPlatformLabel: host.requiredPlatformLabel,
      settings: rt.settings,
      checks,
      note:
        `Host is ${host.label} (${host.platform}/${host.arch}). ${host.requiredPlatformLabel} is required, so the Xcode, `
        + 'runtime and device probes were skipped. Every ios_* tool will refuse to run on this host.',
    }
  }

  const select = await run(['xcode-select', '-p'], { timeout: 10_000 })
  const developerDir = select.stdout.trim()
  const commandLineToolsOnly = developerDir.includes('/CommandLineTools')
  checks.push({
    name: 'xcode-select',
    ok: ok(select) && !commandLineToolsOnly,
    detail: ok(select) ? developerDir : brief(select),
    fix: 'Install full Xcode, then run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
  })

  const build = await run(['xcodebuild', '-version'], { timeout: 20_000 })
  checks.push({
    name: 'xcodebuild',
    ok: ok(build),
    detail: brief(build, 1000),
    fix: 'Open Xcode once and accept the license and components. Command Line Tools alone are not enough.',
  })

  const simctl = await run(['xcrun', 'simctl', 'help'], { timeout: 15_000 })
  checks.push({
    name: 'simctl',
    ok: ok(simctl),
    detail: brief(simctl, 1000),
    fix: 'Install full Xcode and make sure xcrun can find simctl.',
  })

  const runtimesResult = await run(['xcrun', 'simctl', 'list', 'runtimes', '--json'], { timeout: 20_000 })
  const runtimesParsed = parseResult(runtimesResult, parseRuntimes)
  const runtimes = runtimesParsed.items
  const runtimesListed = ok(runtimesResult) && runtimesParsed.error === undefined
  const usableRuntimes = runtimes.filter((item) => item.available)
  checks.push({
    name: 'simulator runtimes',
    ok: runtimesListed && usableRuntimes.length > 0,
    detail: runtimesListed
      ? usableRuntimes.length > 0
        ? `${usableRuntimes.length} usable iOS runtime(s): ${usableRuntimes.map((item) => item.name).join(', ')}`
        : `none usable (${runtimes.length} known)`
      : runtimesParsed.error ?? brief(runtimesResult),
    fix: 'Install an iOS Simulator runtime from Xcode > Settings > Platforms.',
  })

  const devicesResult = await run(['xcrun', 'simctl', 'list', 'devices', '--json'], { timeout: 20_000 })
  const devicesParsed = parseResult(devicesResult, parseSimulators)
  const simulators = devicesParsed.items
  const devicesListed = ok(devicesResult) && devicesParsed.error === undefined
  const available = simulators.filter((item) => item.available)
  checks.push({
    name: 'simulator devices',
    ok: devicesListed && available.length > 0,
    detail: devicesListed
      ? `${available.length} available iOS/iPadOS simulator(s) of ${simulators.length} known`
      : devicesParsed.error ?? brief(devicesResult),
    fix: 'Create a device in Xcode > Settings > Platforms, or use Xcode\'s Devices window.',
  })

  const ui = await status(rt)
  checks.push({
    name: 'ui backend',
    ok: ui.setting === 'none' || ui.available || ui.setting === 'auto',
    detail: `${ui.backend}: ${ui.detail}`,
    fix: `Install idb and idb-companion for tap/swipe/type/describe, or set the UI backend to none on ${PAGE_LOCATION}.`,
  })

  checks.push(defaults)

  return {
    ok: preflightOk(checks),
    supported: true,
    platform: host.platform,
    arch: host.arch,
    requiredPlatform: host.requiredPlatform,
    requiredPlatformLabel: host.requiredPlatformLabel,
    settings: rt.settings,
    checks,
  }
}

/**
 * Everything the configuration page can offer as a choice, discovered on demand.
 *
 * Each probe is failure-tolerant: a missing Xcode or runtime must not blank the
 * page, it must produce an empty list plus a note, so the user can still edit
 * and save the values.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @returns {Promise<Inventory>} the inventory.
 */
export async function inventory(rt) {
  const host = hostInfo({ platform: rt.platform })
  const current = {
    dataRoot: displayDataRoot(rt),
    screenshotsDir: displaySettingPath(rt, rt.settings.screenshotDir, `${rt.dataRoot}/screenshots`),
    derivedDataDir: displaySettingPath(rt, rt.settings.derivedDataDir, `${rt.dataRoot}/DerivedData`),
    logSeconds: rt.settings.logSeconds,
    logLimit: rt.settings.logLimit,
    defaultConfiguration: rt.settings.defaultConfiguration,
    defaultDevice: defaultDeviceFragment(rt.settings),
    defaultRuntime: rt.settings.defaultRuntime,
    uiBackend: rt.settings.uiBackend,
    disableCodeSigning: rt.settings.disableCodeSigning,
  }

  if (!host.supported) {
    return {
      host,
      platformLabel: platformLabel(host.platform),
      supported: false,
      note: `Host is ${host.label}; ${host.requiredPlatformLabel} is required for every ios_* tool.`,
      xcodePath: null,
      xcodeVersion: null,
      macOSVersion: null,
      simulators: [],
      runtimes: [],
      defaultTarget: null,
      defaultTargetError: `not available on ${host.label}`,
      ui: { backend: 'unavailable', available: false, setting: rt.settings.uiBackend, detail: `${host.requiredPlatformLabel} only` },
      current,
    }
  }

  const [xcode, build, macOS, sims, rts, target, ui] = await Promise.all([
    tolerate(() => run(['xcode-select', '-p'], { timeout: 10_000 })),
    tolerate(() => run(['xcodebuild', '-version'], { timeout: 20_000 })),
    tolerate(() => run(['sw_vers', '-productVersion'], { timeout: 10_000 })),
    tolerate(() => list(rt)),
    tolerate(() => listRuntimes(rt)),
    tolerate(() => pick(rt, {})),
    tolerate(() => status(rt)),
  ])

  return {
    host,
    platformLabel: platformLabel(host.platform),
    supported: true,
    xcodePath: xcode.ok ? xcode.value.stdout.trim() : null,
    xcodeVersion: build.ok ? build.value.stdout.split(/\r?\n/)[0]?.trim() ?? null : null,
    macOSVersion: macOS.ok ? macOS.value.stdout.trim() : null,
    simulators: sims.ok ? sims.value.map(publicSimulator) : [],
    // A probe that failed is reported by leaving its error field out rather
    // than by setting it to `undefined`: an absent field and a field holding
    // `undefined` are the same thing to a JSON value, and only the first is a
    // value the type of the inventory can describe.
    ...(sims.ok ? {} : { simulatorsError: sims.error }),
    runtimes: rts.ok ? rts.value : [],
    ...(rts.ok ? {} : { runtimesError: rts.error }),
    defaultTarget: target.ok ? publicSimulator(target.value) : null,
    ...(target.ok ? {} : { defaultTargetError: target.error }),
    ui: ui.ok ? ui.value : { backend: 'unknown', available: false, setting: rt.settings.uiBackend, detail: ui.error },
    current,
  }
}

/**
 * The data root to show for a call that may have no session workspace.
 *
 * `dataDir` is documented as relative to the session workspace; a route or the
 * /ios-dev command has no session, so resolving it against the DSH process
 * directory would print a path no tool writes to. The configured value is kept
 * as configured and labelled instead.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @returns {string} the path to display.
 */
function displayDataRoot(rt) {
  const configured = rt.settings.dataDir
  if (configured.length > 0 && !path.isAbsolute(configured) && !rt.session) {
    return `${configured} (relative to each session workspace)`
  }
  return rt.dataRoot
}

/**
 * The display text for one optional, workspace-relative output directory.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} configured - the configured value.
 * @param {string} fallback - the absolute default to show when unset.
 * @returns {string} the path to display.
 */
function displaySettingPath(rt, configured, fallback) {
  if (configured.length === 0) return fallback
  if (!path.isAbsolute(configured) && !rt.session) {
    return `${configured} (relative to each session workspace)`
  }
  return path.resolve(rt.cwd, configured)
}

/**
 * Reduce one simulator record to the fields a form needs.
 *
 * The form reads the device name, its UDID, its state, the runtime it belongs
 * to and whether it can be used at all — which is every field a
 * {@link import('./sim.js').SimulatorRecord} already carries.
 *
 * @param {import('./sim.js').SimulatorRecord} item - the device record.
 * @returns {import('./sim.js').SimulatorRecord} the record the form shows.
 */
function publicSimulator(item) {
  return { name: item.name, udid: item.udid, state: item.state, runtime: item.runtime, available: item.available }
}

/**
 * Parse a `--json` result, distinguishing a failed probe from an empty list.
 *
 * The whole point of this module is to tell "not installed" apart from "the
 * probe failed". A command that exits zero but prints something the parser
 * cannot read is the second: reporting it as `none usable (0 known)` would send
 * the user to reinstall a runtime the machine already has.
 *
 * @template T
 * @param {import('../util/run.js').RunResult} result - the finished command.
 * @param {(value: string) => T[]} parse - the parser to apply to the output.
 * @returns {{items: T[], error: string | undefined}} the parsed records and, when it failed, why.
 */
function parseResult(result, parse) {
  if (!ok(result)) {
    return {
      items: [],
      error: brief(result) || `the command exited with code ${result.code}${result.timed ? ' after timing out' : ''} without output`,
    }
  }
  try {
    return { items: parse(result.stdout), error: undefined }
  } catch (error) {
    return { items: [], error: `the command answered with output this plugin could not parse: ${message(error)}` }
  }
}

/**
 * Error message of an arbitrary thrown value.
 *
 * @param {unknown} error - the thrown value.
 * @returns {string} its message.
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run a probe, turning a throw into a record so `Promise.all` never rejects.
 *
 * @template T
 * @param {() => Promise<T>} work - the probe to run.
 * @returns {Promise<{ok: true, value: T} | {ok: false, error: string}>} the outcome.
 */
async function tolerate(work) {
  try {
    return { ok: true, value: await work() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
