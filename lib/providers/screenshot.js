import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { inside, displayPath } from '../util/path.js'
import { failureText, ok, run } from '../util/run.js'
import { boot } from './sim.js'
import { requireMacOS } from './host.js'

/**
 * Simulator screen capture.
 *
 * Ported from the ZCode plugin's `providers/screenshot.ts`. The command is
 * `xcrun simctl io <udid> screenshot --display primary <file>`: the flag is
 * this port's addition, because a device pair exposes several displays and the
 * default one renders black. The default destination moves from
 * `IOS_SIM_PLUGIN_DATA/screenshots` to the plugin's data directory (editable on
 * the configuration page), and the absolute path is returned alongside the relative
 * one so a caller can open the file without re-deriving it — a capture outside
 * the session workspace is reported with its absolute path, because a
 * `../../..` path would only look like a workspace path.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/providers/screenshot
 */

/**
 * One captured screen.
 *
 * @typedef {object} ScreenshotResult
 * @property {import('./sim.js').BootResult} simulator - the simulator the capture came from.
 * @property {string} path - the capture path, relative to the session workspace when it is inside it, absolute otherwise.
 * @property {string} absolutePath - the capture path, absolute.
 * @property {number} bytes - the size of the PNG.
 * @property {string} data - the PNG bytes, base64 encoded.
 */

/**
 * Capture a PNG from the target simulator.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {{udid?: string | undefined, device?: string | undefined, runtime?: string | undefined,
 *   path?: string | undefined, openSimulator?: boolean | undefined}} [input] - the tool arguments.
 * @returns {Promise<ScreenshotResult>} the capture record; `data` is base64 PNG bytes.
 */
export async function shot(rt, input = {}) {
  requireMacOS(rt)
  // A path that is going to be refused must not start a simulator first: the
  // workspace boundary is checked before the target is resolved.
  const requested = input.path ? inside(rt.cwd, input.path, rt.writeRoots) : undefined
  const sim = await boot(rt, {
    udid: input.udid,
    name: input.device,
    runtime: input.runtime,
    open: input.openSimulator ?? false,
  })
  const file = requested ?? path.join(await rt.screenshots(), `${stamp()}-${sim.udid}.png`)
  await mkdir(path.dirname(file), { recursive: true })
  // `--display primary` is what makes the capture the *main* screen. A device
  // pair (`simctl` lists "iPhone Duo" as one device driving an iPhone and an
  // iPad) exposes several displays, and without the flag `simctl io screenshot`
  // grabs the secondary one, which renders a uniformly black frame. On a normal
  // device the flag changes nothing: the bytes are identical to the plain call.
  let out = await run(['xcrun', 'simctl', 'io', sim.udid, 'screenshot', '--display', 'primary', file], {
    timeout: 30_000,
  })
  if (!ok(out) && displayOptionRejected(out)) {
    // An older `simctl` that does not know `--display` is still a working
    // simulator control; the plain command is what it always ran here. The
    // retry happens only for a usage error that names the option, never for a
    // failed capture, which would just fail twice.
    out = await run(['xcrun', 'simctl', 'io', sim.udid, 'screenshot', file], { timeout: 30_000 })
  }
  if (!ok(out)) throw new Error(failureText(out))
  const bytes = await readFile(file)
  // The default capture lands under the plugin's data directory, which sits
  // outside the session workspace whenever DSH_HOME does. A `../../..` path
  // would be a workspace-relative lie, so anything outside the workspace stays
  // absolute — the same rule the build log path follows.
  return {
    simulator: sim,
    path: displayPath(rt.cwd, file),
    absolutePath: file,
    bytes: bytes.byteLength,
    data: bytes.toString('base64'),
  }
}

/** A filename-safe timestamp. */
function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}

/** A word a `simctl` usage error uses for an option it could not parse. */
const OPTION_REJECTED = /\b(?:unknown|unrecognized|unrecognised|invalid|illegal)\b/i

/**
 * Whether a failed capture failed only because this `simctl` does not know `--display`.
 *
 * `--display` has existed since Xcode 11, but the plugin supports "macOS with
 * full Xcode", and a machine can lag behind. The usage error such a `simctl`
 * prints says on the same line that the option it names was not understood; a
 * capture that failed for any other reason (no such device, a write error) names
 * no option at all, and must not be retried.
 *
 * @param {import('../util/run.js').RunResult} item - the failed command.
 * @returns {boolean} true when the option itself was rejected.
 */
function displayOptionRejected(item) {
  return `${item.stdout}\n${item.stderr}`
    .split('\n')
    .filter((line) => line.includes('--display'))
    .some((line) => OPTION_REJECTED.test(line))
}
