import { brief, ok, run } from '../util/run.js'
import { boot } from './sim.js'
import { requireMacOS } from './host.js'

/**
 * Optional `idb` UI automation backend.
 *
 * Ported from the ZCode plugin's `providers/ui.ts`. The operation set, the argv
 * order and the refusal message are the original's; the backend *choice* is now
 * explicit, because the original declared `auto | idb | xcodebuildmcp | none`
 * in its `userConfig` and then only ever probed `idb`. Here:
 *
 *   - `auto`    probes the configured binary and reports what it found;
 *   - `idb`     requires it, failing with the reason when it is missing;
 *   - `none`    disables the UI tools;
 *   - `xcodebuildmcp` stays a reserved name, exactly as the original's
 *     `reservedBackends` field said, so a future bridge can take the slot
 *     without an API change.
 *
 * @module dsh-ios-simulator-helper/providers/ui
 */

/** Buttons `idb ui button` accepts, in the original plugin's order. */
export const UI_BUTTONS = ['APPLE_PAY', 'HOME', 'LOCK', 'SIDE_BUTTON', 'SIRI']

/**
 * Report whether UI automation can run.
 *
 * @param {object} rt - the call runtime.
 * @returns {Promise<{backend: string, available: boolean, detail: string, setting: string,
 *   binary?: string, reservedBackends: string[]}>} the status.
 */
export async function status(rt) {
  const setting = rt.settings.uiBackend
  const reservedBackends = ['xcodebuildmcp']
  if (setting === 'none') {
    return {
      backend: 'none',
      available: false,
      setting,
      reservedBackends,
      detail: 'UI automation is turned off by the plugin setting (uiBackend = none).',
    }
  }
  if (setting === 'xcodebuildmcp') {
    return {
      backend: 'xcodebuildmcp',
      available: false,
      setting,
      reservedBackends,
      detail: 'The xcodebuildmcp backend is reserved but not implemented in this build; select idb or auto instead.',
    }
  }
  const binary = rt.settings.idbBinary || 'idb'
  const probe = await run([binary, '--version'], { timeout: 5000 })
  if (ok(probe)) {
    return {
      backend: 'idb',
      available: true,
      setting,
      binary,
      reservedBackends,
      detail: `${binary} ${probe.stdout.trim() || probe.stderr.trim()}`.trim(),
    }
  }
  return {
    backend: setting === 'idb' ? 'idb' : 'none',
    available: false,
    setting,
    binary,
    reservedBackends,
    detail:
      setting === 'idb'
        ? `idb was required by the uiBackend setting but "${binary}" does not run: ${brief(probe, 400) || 'not found on PATH'}`
        : `uiBackend = auto found no automation binary: "${binary}" does not run, so tap/swipe/type/describe stay unavailable`,
  }
}

/**
 * Tap screen coordinates.
 *
 * @param {object} rt - the call runtime.
 * @param {object} input - `x`, `y`, optional `duration` and target arguments.
 * @returns {Promise<object>} the backend outcome.
 */
export async function tap(rt, input) {
  const sim = await target(rt, input)
  return exec(rt, sim.udid, [
    'ui',
    'tap',
    String(input.x),
    String(input.y),
    ...(input.duration === undefined ? [] : ['--duration', String(input.duration)]),
  ])
}

/**
 * Swipe between screen coordinates.
 *
 * @param {object} rt - the call runtime.
 * @param {object} input - `x1`, `y1`, `x2`, `y2`, optional `delta` and target arguments.
 * @returns {Promise<object>} the backend outcome.
 */
export async function swipe(rt, input) {
  const sim = await target(rt, input)
  return exec(rt, sim.udid, [
    'ui',
    'swipe',
    String(input.x1),
    String(input.y1),
    String(input.x2),
    String(input.y2),
    ...(input.delta === undefined ? [] : ['--delta', String(input.delta)]),
  ])
}

/**
 * Type text into the focused control.
 *
 * @param {object} rt - the call runtime.
 * @param {{text: string}} input - the text plus target arguments.
 * @returns {Promise<object>} the backend outcome.
 */
export async function typeText(rt, input) {
  const sim = await target(rt, input)
  return exec(rt, sim.udid, ['ui', 'text', input.text])
}

/**
 * Press one of {@link UI_BUTTONS}.
 *
 * @param {object} rt - the call runtime.
 * @param {{button: string, duration?: number}} input - the button plus target arguments.
 * @returns {Promise<object>} the backend outcome.
 */
export async function button(rt, input) {
  const sim = await target(rt, input)
  return exec(rt, sim.udid, [
    'ui',
    'button',
    input.button,
    ...(input.duration === undefined ? [] : ['--duration', String(input.duration)]),
  ])
}

/**
 * Dump the accessibility tree of the current screen.
 *
 * @param {object} rt - the call runtime.
 * @param {object} [input] - target arguments.
 * @returns {Promise<object>} the backend outcome.
 */
export async function describe(rt, input = {}) {
  const sim = await target(rt, input)
  return exec(rt, sim.udid, ['ui', 'describe-all', '--json'])
}

/** Resolve a target simulator and make sure it is running. */
async function target(rt, input) {
  requireMacOS(rt)
  return boot(rt, { udid: input.udid, name: input.device, runtime: input.runtime })
}

/** Run one `idb ui` command against a booted simulator. */
async function exec(rt, udid, args) {
  const found = await status(rt)
  if (!found.available) {
    throw new Error(
      `UI automation backend unavailable (${found.backend}): ${found.detail} `
        + 'Install idb and idb-companion, pick a backend on the Settings -> iOS Simulator page, '
        + 'or use the build/run/screenshot tools only.',
    )
  }
  const out = await run([found.binary, ...args, '--udid', udid], { timeout: rt.settings.uiTimeoutMs })
  if (!ok(out)) throw new Error(brief(out))
  return { backend: found.backend, udid, output: brief(out, 20_000) }
}
