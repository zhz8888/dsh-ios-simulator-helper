import { lstatSync, realpathSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Directory name used under the DSH home (and as the temp-file fallback prefix). */
export const DATA_DIR_NAME = 'ios-simulator-helper'

/**
 * Resolve one output directory inside the plugin data root, creating it.
 *
 * `settings.dataDir` wins when set; otherwise the plugin writes under the DSH
 * home (`$DSH_HOME`, else `~/.dsh`) so screenshots, build logs and DerivedData
 * survive a reboot. A deployment without a writable home still gets a working
 * directory: the final fallback is the system temp directory.
 *
 * The original plugin resolved `IOS_SIM_PLUGIN_DATA` (else
 * `<tmp>/ios-simulator-plugin`); that variable is still honoured, as the
 * `dataDir` setting's legacy fallback.
 *
 * @param {string} dataRoot - absolute data root already resolved from settings.
 * @param {string[]} part - path segments appended to the root.
 * @returns {Promise<string>} the created absolute directory.
 */
export async function dataDir(dataRoot, ...part) {
  const dir = path.join(dataRoot, ...part)
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * Fallback data root when the user configured none.
 *
 * @param {NodeJS.ProcessEnv} [env] - environment to read `DSH_HOME` from.
 * @returns {string} an absolute path; not created here.
 */
export function defaultDataRoot(env = process.env) {
  const home = env.DSH_HOME?.trim()
  if (home) return path.join(home, DATA_DIR_NAME)
  const userHome = os.homedir()
  if (userHome) return path.join(userHome, '.dsh', DATA_DIR_NAME)
  return path.join(os.tmpdir(), DATA_DIR_NAME)
}

/**
 * Resolve a caller-supplied write target against the session workspace and refuse escapes.
 *
 * Tool arguments arrive from the model, so neither a relative `../..` nor an
 * absolute `/elsewhere` may silently reach outside the workspace the user
 * opened: this plugin's providers run host-side, outside DSH's own bash
 * sandbox, so the workspace boundary is the only thing keeping a screenshot
 * path or a generated project inside the session. Destinations that the plugin
 * itself computes (the data directory, DerivedData, the default screenshot
 * path) do not go through here.
 *
 * The comparison is made on the *real* path, not on the resolved one: a
 * symlink inside the workspace still reads as inside it while the file it
 * names lands outside, so the nearest existing ancestor is resolved for real
 * before the two sides are compared.
 *
 * `extraRoots` are the plugin's own output roots: the data directory and the
 * configured screenshot and DerivedData directories. A tool result reports a
 * path under them as an absolute one — a `../../..` path would be a
 * workspace-relative lie — so a caller that feeds that reported path back as an
 * argument would otherwise hit the workspace refusal. They are additional
 * permitted roots, never substitutes for the workspace check.
 *
 * @param {string} base - absolute session workspace directory.
 * @param {string} raw - the requested path.
 * @param {readonly string[]} [extraRoots] - further absolute roots a path may lie in.
 * @returns {string} the resolved absolute path.
 * @throws When the path resolves outside the workspace and every extra root.
 */
export function inside(base, raw, extraRoots = []) {
  const out = path.resolve(base, raw)
  for (const root of [base, ...extraRoots]) {
    if (typeof root !== 'string' || root.length === 0) continue
    try {
      const realRoot = realpathOf(path.resolve(root))
      const realOut = realpathOf(out)
      if (realOut === realRoot || realOut.startsWith(realRoot + path.sep)) return out
    } catch {
      // A root that cannot be resolved for real, or a path that cannot, cannot
      // be proven inside it; the boundary decision fails closed either way.
    }
  }
  throw new Error(`Path escapes the session workspace: ${raw}`)
}

/**
 * The real path of `target`, with the part that does not exist yet kept.
 *
 * The path a caller names may not exist yet — a screenshot about to be written,
 * a directory about to be created — so the nearest existing ancestor is
 * resolved for real and the segments below it are appended unchanged.
 *
 * @param {string} target - an absolute path.
 * @returns {string} the resolved path.
 */
function realpathOf(target) {
  /** @type {string[]} */
  const tail = []
  let current = target
  for (;;) {
    try {
      return path.join(realpathSync(current), ...tail)
    } catch {
      // A path that exists but does not resolve is not a not-yet-created
      // segment. A dangling symlink is exactly how the old lexical fallback
      // let a write land outside the workspace, so it is refused instead.
      if (isSymbolicLink(current)) {
        throw new Error(`Cannot resolve a symbolic link inside the session workspace: ${target}`)
      }
      const parent = path.dirname(current)
      if (parent === current) return target
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}

/**
 * Whether one path segment is itself a symlink, dangling or not.
 *
 * `lstat` reports the link rather than following it, and a link that cannot be
 * inspected is treated as absent so an unrelated permission error keeps the
 * old not-yet-created fallback.
 *
 * @param {string} file - the path to inspect.
 * @returns {boolean} true when the path is a symbolic link.
 */
function isSymbolicLink(file) {
  try {
    return lstatSync(file).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Resolve a caller-supplied path that is only ever read.
 *
 * `ios_install_app` takes an already-built `.app` bundle, which legitimately
 * lives in a DerivedData directory, a CI artifact directory or `/tmp` — those
 * are absolute and outside the workspace. An absolute path is therefore
 * accepted verbatim, while a relative one stays workspace-scoped so the model
 * cannot imply an escape it did not write.
 *
 * @param {string} base - absolute session workspace directory.
 * @param {string} raw - the requested path.
 * @returns {string} the resolved absolute path.
 * @throws When no path was given.
 */
export function readablePath(base, raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) throw new Error('A path is required.')
  if (path.isAbsolute(raw)) return path.resolve(raw)
  return inside(base, raw)
}

/**
 * Express `file` relative to the session workspace when it lies inside it.
 *
 * @param {string} cwd - absolute session workspace directory.
 * @param {string} file - the absolute path to express.
 * @returns {string} the relative path, or `.` when the file is the workspace.
 */
export function rel(cwd, file) {
  return path.relative(cwd, file) || '.'
}

/**
 * The path one result reports: relative to the workspace when the file lies
 * inside it, absolute when it does not.
 *
 * A `../../..` chain would be a workspace-relative lie — the file is not
 * under the workspace, so a path relative to it resolves against the wrong
 * root — so anything outside stays absolute.
 *
 * @param {string} cwd - absolute session workspace directory.
 * @param {string} file - the absolute path to report.
 * @returns {string} the path to report.
 */
export function displayPath(cwd, file) {
  const shown = rel(cwd, file)
  return shown.startsWith('..') ? file : shown
}
