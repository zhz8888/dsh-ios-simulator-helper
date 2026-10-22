import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { inside, displayPath } from '../util/path.js'
import { failureText, ok, run } from '../util/run.js'
import { boot } from './sim.js'
import { requireMacOS } from './host.js'

/**
 * Simulator screen capture.
 *
 * Ported from the ZCode plugin's `providers/screenshot.ts`. `xcrun simctl io
 * <udid> screenshot <file>` is unchanged; the default destination moves from
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
  const requested = input.path ? inside(rt.cwd, input.path) : undefined
  const sim = await boot(rt, {
    udid: input.udid,
    name: input.device,
    runtime: input.runtime,
    open: input.openSimulator ?? false,
  })
  const file = requested ?? path.join(await rt.screenshots(), `${stamp()}-${sim.udid}.png`)
  await mkdir(path.dirname(file), { recursive: true })
  const out = await run(['xcrun', 'simctl', 'io', sim.udid, 'screenshot', file], { timeout: 30_000 })
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
