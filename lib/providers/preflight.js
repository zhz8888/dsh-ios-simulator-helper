import { brief, ok, run } from '../util/run.js'
import { defaultDeviceFragment } from '../settings.js'
import { hostInfo, platformLabel } from './host.js'
import { list, listRuntimes, parseRuntimes, parseSimulators, pick } from './sim.js'
import { status } from './ui.js'

/**
 * Environment diagnostics for the host and the settings page.
 *
 * Ported from the ZCode plugin's `providers/preflight.ts`. The Xcode checks are
 * the original's (`xcode-select`, `xcodebuild`, `simctl`, devices, UI backend);
 * three things were added because the settings page needs them:
 *
 *   - the macOS check now yields a structured `supported` verdict, and the rest
 *     of the probes are skipped entirely on another host instead of producing
 *     six confusing spawn failures;
 *   - an explicit `simulator runtimes` check, which is the real prerequisite
 *     for a device list, plus installed-runtime inventory;
 *   - an `iOS plugin defaults` check that echoes the values the user actually
 *     saved, so a mis-set default device is visible in the diagnostic.
 *
 * @module dsh-ios-simulator-helper/providers/preflight
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
 * @param {object} rt - the call runtime.
 * @returns {Promise<{ok: boolean, supported: boolean, platform: string, arch: string, checks: Array<object>,
 *   settings: object, note?: string}>} the report.
 */
export async function preflight(rt) {
  const host = hostInfo({ platform: rt.platform })
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
      `dataRoot=${rt.dataRoot}`,
    ].join('\n'),
    fix: 'Edit these on the Settings -> iOS Simulator page.',
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
  const runtimes = parseOrEmpty(runtimesResult, parseRuntimes)
  const usableRuntimes = runtimes.filter((item) => item.available)
  checks.push({
    name: 'simulator runtimes',
    ok: usableRuntimes.length > 0,
    detail: ok(runtimesResult)
      ? usableRuntimes.length > 0
        ? `${usableRuntimes.length} usable iOS runtime(s): ${usableRuntimes.map((item) => item.name).join(', ')}`
        : `none usable (${runtimes.length} known)`
      : brief(runtimesResult),
    fix: 'Install an iOS Simulator runtime from Xcode > Settings > Platforms.',
  })

  const devicesResult = await run(['xcrun', 'simctl', 'list', 'devices', '--json'], { timeout: 20_000 })
  const simulators = parseOrEmpty(devicesResult, parseSimulators)
  const available = simulators.filter((item) => item.available)
  checks.push({
    name: 'simulator devices',
    ok: ok(devicesResult) && available.length > 0,
    detail: ok(devicesResult)
      ? `${available.length} available iOS/iPadOS simulator(s) of ${simulators.length} known`
      : brief(devicesResult),
    fix: 'Create a device in Xcode > Settings > Platforms, or use Xcode\'s Devices window.',
  })

  const ui = await status(rt)
  checks.push({
    name: 'ui backend',
    ok: ui.setting === 'none' || ui.available || ui.setting === 'auto',
    detail: `${ui.backend}: ${ui.detail}`,
    fix: 'Install idb and idb-companion for tap/swipe/type/describe, or set the UI backend to none on the settings page.',
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
 * Everything the settings page can offer as a choice, discovered on demand.
 *
 * Each probe is failure-tolerant: a missing Xcode or runtime must not blank the
 * page, it must produce an empty list plus a note, so the user can still edit
 * and save the values.
 *
 * @param {object} rt - the call runtime.
 * @returns {Promise<object>} the inventory.
 */
export async function inventory(rt) {
  const host = hostInfo({ platform: rt.platform })
  const current = {
    dataRoot: rt.dataRoot,
    screenshotsDir: rt.settings.screenshotDir || `${rt.dataRoot}/screenshots`,
    derivedDataDir: rt.settings.derivedDataDir || `${rt.dataRoot}/DerivedData`,
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
    simulatorsError: sims.ok ? undefined : sims.error,
    runtimes: rts.ok ? rts.value : [],
    runtimesError: rts.ok ? undefined : rts.error,
    defaultTarget: target.ok ? publicSimulator(target.value) : null,
    defaultTargetError: target.ok ? undefined : target.error,
    ui: ui.ok ? ui.value : { backend: 'unknown', available: false, setting: rt.settings.uiBackend, detail: ui.error },
    current,
  }
}

/** Reduce one simulator record to the fields a form needs. */
function publicSimulator(item) {
  return { name: item.name, udid: item.udid, state: item.state, runtime: item.runtime, available: item.available }
}

/** Parse a `--json` result, or `[]` when the command or the JSON failed. */
function parseOrEmpty(result, parse) {
  if (!ok(result)) return []
  try {
    return parse(result.stdout)
  } catch {
    return []
  }
}

/** Run a probe, turning a throw into a record so `Promise.all` never rejects. */
async function tolerate(work) {
  try {
    return { ok: true, value: await work() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
