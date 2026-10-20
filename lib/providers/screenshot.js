import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { inside, rel } from '../util/path.js'
import { brief, ok, run } from '../util/run.js'
import { boot } from './sim.js'
import { requireMacOS } from './host.js'

/**
 * Simulator screen capture.
 *
 * Ported from the ZCode plugin's `providers/screenshot.ts`. `xcrun simctl io
 * <udid> screenshot <file>` is unchanged; the default destination moves from
 * `IOS_SIM_PLUGIN_DATA/screenshots` to the plugin's data directory (editable on
 * the configuration page), and the absolute path is returned alongside the relative
 * one so a caller can open the file without re-deriving it.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/providers/screenshot
 */

/**
 * Capture a PNG from the target simulator.
 *
 * @param {object} rt - the call runtime.
 * @param {{udid?: string, device?: string, runtime?: string, path?: string, openSimulator?: boolean}} [input]
 *   the tool arguments.
 * @returns {Promise<{simulator: object, path: string, absolutePath: string, bytes: number, data: string}>}
 *   the capture record; `data` is base64 PNG bytes.
 */
export async function shot(rt, input = {}) {
  requireMacOS(rt)
  const sim = await boot(rt, {
    udid: input.udid,
    name: input.device,
    runtime: input.runtime,
    open: input.openSimulator ?? false,
  })
  const file = input.path
    ? inside(rt.cwd, input.path)
    : path.join(await rt.screenshots(), `${stamp()}-${sim.udid}.png`)
  await mkdir(path.dirname(file), { recursive: true })
  const out = await run(['xcrun', 'simctl', 'io', sim.udid, 'screenshot', file], { timeout: 30_000 })
  if (!ok(out)) throw new Error(brief(out))
  const bytes = await readFile(file)
  return {
    simulator: sim,
    path: rel(rt.cwd, file),
    absolutePath: file,
    bytes: bytes.byteLength,
    data: bytes.toString('base64'),
  }
}

/** A filename-safe timestamp. */
function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}
