import { brief, ok, run } from '../util/run.js'
import { boot } from './sim.js'
import { requireMacOS } from './host.js'
import { PAGE_LOCATION } from './preflight.js'

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
 * @module @zhz8888/dsh-ios-simulator-helper/providers/ui
 */

/** Buttons `idb ui button` accepts, in the original plugin's order. */
export const UI_BUTTONS = ['APPLE_PAY', 'HOME', 'LOCK', 'SIDE_BUTTON', 'SIRI']

/**
 * The status of the UI automation backend, with the tools turned off.
 *
 * `status()` answers one question — can a UI command run, and which backend
 * would run it — but the answer has four shapes, because the `uiBackend`
 * setting picks between them before anything is probed. The union is
 * discriminated on `setting`, the value the user chose: that field selects the
 * branch, while `backend` is derived from it in two of the four branches and so
 * cannot separate them. Inside the `auto`/`idb` pair the probe decides, and
 * `available` is the second discriminant.
 *
 * @typedef {object} UiStatusOff
 * @property {'none'} backend - the backend the setting selects.
 * @property {false} available - always false: the setting turned the tools off.
 * @property {'none'} setting - the setting that turned the tools off.
 * @property {string[]} reservedBackends - the names reserved for a future bridge.
 * @property {string} detail - the explanation, in one sentence.
 */

/**
 * The status of the reserved backend, which this build does not implement.
 *
 * @typedef {object} UiStatusReserved
 * @property {'xcodebuildmcp'} backend - the reserved backend.
 * @property {false} available - always false: the backend is not implemented.
 * @property {'xcodebuildmcp'} setting - the setting that selected it.
 * @property {string[]} reservedBackends - the names reserved for a future bridge.
 * @property {string} detail - the explanation, in one sentence.
 */

/**
 * The status of the probed backend, when the probe found a working binary.
 *
 * @typedef {object} UiStatusReady
 * @property {'idb'} backend - the backend the probe found.
 * @property {true} available - always true: the binary answered the probe.
 * @property {'auto' | 'idb'} setting - the setting that led to the probe.
 * @property {string} binary - the executable that answered the probe.
 * @property {string[]} reservedBackends - the names reserved for a future bridge.
 * @property {string} detail - the version line the probe reported.
 */

/**
 * The status of the probed backend, when the probe found no working binary.
 *
 * The backend is still named `idb` when the setting demanded it, so the
 * refusal can say which backend was missing instead of only that none is
 * available.
 *
 * @typedef {object} UiStatusUnavailable
 * @property {'idb' | 'none'} backend - the backend the setting named.
 * @property {false} available - always false: the binary did not run.
 * @property {'auto' | 'idb'} setting - the setting that led to the probe.
 * @property {string} binary - the executable that failed the probe.
 * @property {string[]} reservedBackends - the names reserved for a future bridge.
 * @property {string} detail - the explanation, in one sentence.
 */

/**
 * The status of the optional UI automation backend.
 *
 * @typedef {UiStatusOff | UiStatusReserved | UiStatusReady | UiStatusUnavailable} UiStatus
 */

/**
 * The outcome of one UI command.
 *
 * @typedef {object} UiActionResult
 * @property {string} backend - the backend that ran the command.
 * @property {string} udid - the device the command ran against.
 * @property {string} output - what the command printed.
 */

/**
 * The target arguments every UI tool shares.
 *
 * @typedef {object} UiTarget
 * @property {string | undefined} [udid] - the target device UDID.
 * @property {string | undefined} [device] - the target device name fragment.
 * @property {string | undefined} [runtime] - the target runtime fragment.
 */

/**
 * The arguments of one tap.
 *
 * @typedef {object} UiTapInput
 * @property {number} x - the screen x in pixels.
 * @property {number} y - the screen y in pixels.
 * @property {number | undefined} [duration] - the press duration in seconds.
 * @property {string | undefined} [udid] - the target device UDID.
 * @property {string | undefined} [device] - the target device name fragment.
 * @property {string | undefined} [runtime] - the target runtime fragment.
 */

/**
 * The arguments of one swipe.
 *
 * @typedef {object} UiSwipeInput
 * @property {number} x1 - the start x in pixels.
 * @property {number} y1 - the start y in pixels.
 * @property {number} x2 - the end x in pixels.
 * @property {number} y2 - the end y in pixels.
 * @property {number | undefined} [delta] - the swipe duration in seconds.
 * @property {string | undefined} [udid] - the target device UDID.
 * @property {string | undefined} [device] - the target device name fragment.
 * @property {string | undefined} [runtime] - the target runtime fragment.
 */

/**
 * The arguments of one text entry.
 *
 * @typedef {object} UiTypeTextInput
 * @property {string} text - the text to type.
 * @property {string | undefined} [udid] - the target device UDID.
 * @property {string | undefined} [device] - the target device name fragment.
 * @property {string | undefined} [runtime] - the target runtime fragment.
 */

/**
 * The arguments of one hardware button press.
 *
 * @typedef {object} UiButtonInput
 * @property {string} button - the button to press, one of {@link UI_BUTTONS}.
 * @property {number | undefined} [duration] - the hold duration in seconds.
 * @property {string | undefined} [udid] - the target device UDID.
 * @property {string | undefined} [device] - the target device name fragment.
 * @property {string | undefined} [runtime] - the target runtime fragment.
 */

/**
 * Report whether UI automation can run.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @returns {Promise<UiStatus>} the status.
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
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {UiTapInput} input - `x`, `y`, optional `duration` and target arguments.
 * @returns {Promise<UiActionResult>} the backend outcome.
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
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {UiSwipeInput} input - `x1`, `y1`, `x2`, `y2`, optional `delta` and target arguments.
 * @returns {Promise<UiActionResult>} the backend outcome.
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
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {UiTypeTextInput} input - the text plus target arguments.
 * @returns {Promise<UiActionResult>} the backend outcome.
 */
export async function typeText(rt, input) {
  const sim = await target(rt, input)
  return exec(rt, sim.udid, ['ui', 'text', input.text])
}

/**
 * Press one of {@link UI_BUTTONS}.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {UiButtonInput} input - the button plus target arguments.
 * @returns {Promise<UiActionResult>} the backend outcome.
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
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {UiTarget} [input] - target arguments.
 * @returns {Promise<UiActionResult>} the backend outcome.
 */
export async function describe(rt, input = {}) {
  const sim = await target(rt, input)
  return exec(rt, sim.udid, ['ui', 'describe-all', '--json'])
}

/**
 * Resolve a target simulator and make sure it is running.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {UiTarget} input - the target arguments.
 * @returns {Promise<import('./sim.js').BootResult>} the booted device.
 */
async function target(rt, input) {
  requireMacOS(rt)
  return boot(rt, { udid: input.udid, name: input.device, runtime: input.runtime })
}

/**
 * Run one `idb ui` command against a booted simulator.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} udid - the target device.
 * @param {string[]} args - the `idb ui` argv, without the leading binary.
 * @returns {Promise<UiActionResult>} the outcome.
 */
async function exec(rt, udid, args) {
  const found = await status(rt)
  if (!found.available) throw new Error(unavailableMessage(found))
  // The setting is in seconds; a child-process timeout is milliseconds.
  const out = await run([found.binary, ...args, '--udid', udid], { timeout: rt.settings.uiTimeoutSeconds * 1000 })
  if (!ok(out)) throw new Error(brief(out))
  return { backend: found.backend, udid, output: brief(out, 20_000) }
}

/**
 * The one sentence every idb-backed tool refuses with when no backend can run.
 *
 * The status detail reaches here in three shapes — a setting echo ending in a
 * period, the `uiBackend = auto` explanation with no period, and a raw probe
 * transcript — so a trailing period is normalized before the fix is appended.
 * Without that, the two read as one run-on sentence: "…stay unavailable
 * Install idb and idb-companion…".
 *
 * @param {{backend: string, detail: string}} found - the {@link status} result.
 * @returns {string} the refusal message.
 */
export function unavailableMessage(found) {
  return `UI automation backend unavailable (${found.backend}): ${String(found.detail).replace(/\.$/, '')}. `
    + `Install idb and idb-companion, pick a backend on ${PAGE_LOCATION}, `
    + 'or use the build/run/screenshot tools only.'
}
