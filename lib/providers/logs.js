import { brief, ok, run } from '../util/run.js'
import { truncate } from '../util/content.js'
import { pick } from './sim.js'
import { requireMacOS } from './host.js'

/**
 * Simulator log reading.
 *
 * Ported from the ZCode plugin's `providers/logs.ts`: `xcrun simctl spawn <udid>
 * log show --style compact --last <n>s`, with an optional predicate that matches
 * the bundle id as a subsystem or its last component as a process name. The
 * default window (120s) and the truncation limit (20000 characters) now come
 * from the settings page and are clamped rather than trusted.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/providers/logs
 */

/** Predicate-safe bundle id. */
const ID = /^[A-Za-z0-9_.-]+$/

/** Clamp a requested log window to `[1, 3600]` seconds. */
export function clampSeconds(value) {
  const parsed = Number(value)
  const seconds = Number.isFinite(parsed) ? Math.trunc(parsed) : 120
  return Math.max(1, Math.min(seconds <= 0 ? 120 : seconds, 3600))
}

/** Clamp a requested character limit to `[1000, 200000]`. */
export function clampLimit(value) {
  const parsed = Number(value)
  const limit = Number.isFinite(parsed) ? Math.trunc(parsed) : 20_000
  return Math.max(1000, Math.min(limit <= 0 ? 20_000 : limit, 200_000))
}

/**
 * Read recent simulator logs.
 *
 * @param {object} rt - the call runtime.
 * @param {{udid?: string, device?: string, runtime?: string, bundleId?: string, seconds?: number,
 *   limit?: number}} [input] - the tool arguments.
 * @returns {Promise<object>} the log window, the bundle filter and the text.
 */
export async function logs(rt, input = {}) {
  requireMacOS(rt)
  const sim = await pick(rt, { udid: input.udid, name: input.device, runtime: input.runtime })
  const seconds = clampSeconds(input.seconds ?? rt.settings.logSeconds)
  const limit = clampLimit(input.limit ?? rt.settings.logLimit)
  const args = ['xcrun', 'simctl', 'spawn', sim.udid, 'log', 'show', '--style', 'compact', '--last', `${seconds}s`]
  if (input.bundleId) {
    if (!ID.test(input.bundleId)) throw new Error(`Invalid bundle id: ${input.bundleId}`)
    const process = String(input.bundleId).split('.').at(-1)
    args.push('--predicate', `subsystem CONTAINS "${input.bundleId}" OR process CONTAINS "${process}"`)
  }
  const out = await run(args, { timeout: 60_000 })
  if (!ok(out)) throw new Error(brief(out))
  const output = truncate(out.stdout, limit)
  return {
    simulator: sim,
    seconds,
    bundleId: input.bundleId ?? null,
    limit,
    characters: output.length,
    truncated: output.length < out.stdout.length,
    output,
  }
}
