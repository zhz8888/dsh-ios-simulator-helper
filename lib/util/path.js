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
 * @param {string} base - absolute session workspace directory.
 * @param {string} raw - the requested path.
 * @returns {string} the resolved absolute path.
 * @throws When the path resolves outside the workspace.
 */
export function inside(base, raw) {
  const out = path.resolve(base, raw)
  if (out === base || out.startsWith(base + path.sep)) return out
  throw new Error(`Path escapes the session workspace: ${raw}`)
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
