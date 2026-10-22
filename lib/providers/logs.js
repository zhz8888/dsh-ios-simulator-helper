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
 * from the configuration page and are clamped rather than trusted.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/providers/logs
 */

/**
 * Predicate-safe bundle id.
 *
 * The identifier is dot-separated and none of its segments may be empty: the
 * filter also matches the last segment as a process name, and an empty segment
 * would make that clause match every log line, turning the filter into a
 * no-op that still reports itself as applied.
 */
const ID = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/

/**
 * Clamp a requested log window to `[1, 3600]` seconds.
 *
 * @param {unknown} value - the requested window.
 * @returns {number} the clamped window in seconds.
 */
export function clampSeconds(value) {
  const parsed = Number(value)
  const seconds = Number.isFinite(parsed) ? Math.trunc(parsed) : 120
  return Math.max(1, Math.min(seconds <= 0 ? 120 : seconds, 3600))
}

/**
 * Clamp a requested character limit to `[1000, 200000]`.
 *
 * @param {unknown} value - the requested limit.
 * @returns {number} the clamped limit in characters.
 */
export function clampLimit(value) {
  const parsed = Number(value)
  const limit = Number.isFinite(parsed) ? Math.trunc(parsed) : 20_000
  return Math.max(1000, Math.min(limit <= 0 ? 20_000 : limit, 200_000))
}

/**
 * The `--predicate` one bundle-id filter builds.
 *
 * The identifier is checked against {@link ID} first, so no quote or escape
 * can reach the predicate, and its last segment is the process name the second
 * clause matches.
 *
 * @param {string} bundleId - the requested filter.
 * @returns {string} the predicate argument.
 * @throws {Error} when the bundle id is not a usable identifier.
 */
export function logPredicate(bundleId) {
  const value = String(bundleId)
  if (!ID.test(value)) throw new Error(`Invalid bundle id: ${bundleId}`)
  const process = value.split('.').at(-1)
  return `subsystem CONTAINS "${value}" OR process CONTAINS "${process}"`
}

/**
 * The length facts one truncated answer reports.
 *
 * The truncation marker is longer than the text it replaces whenever the
 * overflow is small, so the flag has to be read from the length BEFORE the
 * truncation — and the count is the number of log characters that were kept,
 * never the length of the text with the marker on it.
 *
 * @param {string} stdout - the raw log text.
 * @param {number} limit - the character limit that was applied.
 * @returns {{characters: number, truncated: boolean}} the facts.
 */
export function logLengths(stdout, limit) {
  const length = String(stdout ?? '').length
  return { characters: Math.min(length, limit), truncated: length > limit }
}

/**
 * The log window one call returned.
 *
 * @typedef {object} LogResult
 * @property {import('./sim.js').SimulatorRecord} simulator - the simulator the logs came from.
 * @property {number} seconds - the window that was read.
 * @property {string | null} bundleId - the bundle filter, or `null` when none was given.
 * @property {number} limit - the character limit that was applied.
 * @property {number} characters - how many log characters were kept.
 * @property {boolean} truncated - whether the limit cut the output short.
 * @property {string} output - the log text.
 */

/**
 * Read recent simulator logs.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {{udid?: string | undefined, device?: string | undefined, runtime?: string | undefined,
 *   bundleId?: string | undefined, seconds?: number | undefined, limit?: number | undefined}} [input] - the tool arguments.
 * @returns {Promise<LogResult>} the log window, the bundle filter and the text.
 */
export async function logs(rt, input = {}) {
  requireMacOS(rt)
  const sim = await pick(rt, { udid: input.udid, name: input.device, runtime: input.runtime })
  const seconds = clampSeconds(input.seconds ?? rt.settings.logSeconds)
  const limit = clampLimit(input.limit ?? rt.settings.logLimit)
  const args = ['xcrun', 'simctl', 'spawn', sim.udid, 'log', 'show', '--style', 'compact', '--last', `${seconds}s`]
  if (input.bundleId) {
    args.push('--predicate', logPredicate(input.bundleId))
  }
  // The window decides how much log the command has to read, so the timeout
  // follows it: a fixed 60 s would kill every window longer than a minute
  // before it could answer, and the tool would fail with the timeout rather
  // than with a shorter window.
  const out = await run(args, { timeout: Math.max(60_000, seconds * 1000) })
  if (!ok(out)) throw new Error(brief(out))
  const output = truncate(out.stdout, limit)
  return {
    simulator: sim,
    seconds,
    bundleId: input.bundleId ?? null,
    limit,
    // The characters are the log characters that were kept: the truncation
    // marker is not one of them, and the count never exceeds the limit. The
    // flag is read from the pre-truncation length, because the marker makes
    // the truncated text longer than the text it replaced.
    ...logLengths(out.stdout, limit),
    output,
  }
}
