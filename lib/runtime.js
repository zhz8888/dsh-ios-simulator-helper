import path from 'node:path'
import { dataDir as makeDataDir, defaultDataRoot } from './util/path.js'
import { readSettings } from './settings.js'

/**
 * Per-call runtime handed to every provider.
 *
 * The original ZCode plugin read `process.cwd()`, `process.env` and
 * `process.platform` directly, which is wrong inside a long-lived harness
 * process: several sessions share one Node process, so the working directory is
 * neither stable nor per-session. A runtime object is therefore built once per
 * tool call from
 *
 *   - the calling agent's session workspace,
 *   - the plugin's live settings, and
 *   - the host platform,
 *
 * and passed explicitly into the ported providers. `platform` is a field rather
 * than a bare `process.platform` read so the macOS-only gate can be exercised
 * on any host.
 *
 * @module dsh-ios-simulator-helper/runtime
 */

/**
 * Resolve the directory a tool call should treat as the project root.
 *
 * `exec.agent.session.header.cwd` is the workspace the user opened; it is the
 * harness' own answer to "where is this session working". Nothing else in the
 * process can supply that, so a caller without an agent (a direct programmatic
 * dispatch) falls back to the process directory, matching the ported provider's
 * previous behaviour.
 *
 * @param {unknown} exec - the tool execution record.
 * @returns {string} an absolute directory.
 */
export function sessionCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd.length > 0) return cwd
  return process.cwd()
}

/**
 * Build the runtime for one tool call.
 *
 * @param {object} options - composition inputs.
 * @param {Record<string, unknown>} options.config - the entry's live config.
 * @param {unknown} options.exec - the tool execution record.
 * @param {{error: Function, warn: Function, info: Function}} [options.logger] - host logger.
 * @param {NodeJS.ProcessEnv} [options.env] - environment override (tests).
 * @param {string} [options.cwd] - explicit project root; defaults to the session workspace.
 * @param {NodeJS.Platform} [options.platform] - host platform override (tests).
 * @returns {{
 *   cwd: string,
 *   settings: Record<string, unknown>,
 *   env: NodeJS.ProcessEnv,
 *   platform: string,
 *   logger: object,
 *   dataRoot: string,
 *   screenshots: () => Promise<string>,
 *   buildLogs: () => Promise<string>,
 *   derivedData: (key?: string) => Promise<string>,
 * }}
 */
export function createRuntime({ config, exec, logger, env = process.env, cwd, platform = process.platform }) {
  const settings = readSettings(config, env)
  const projectCwd = cwd ?? sessionCwd(exec)
  const dataRoot = settings.dataDir ? path.resolve(projectCwd, settings.dataDir) : defaultDataRoot(env)
  const screenshotRoot = settings.screenshotDir ? path.resolve(projectCwd, settings.screenshotDir) : undefined
  const derivedRoot = settings.derivedDataDir ? path.resolve(projectCwd, settings.derivedDataDir) : undefined
  return {
    cwd: projectCwd,
    settings,
    env,
    platform,
    logger: logger ?? silentLogger,
    dataRoot,
    /** Directory screenshots are written to, created on demand. */
    screenshots: () => makeDataDir(screenshotRoot ?? dataRoot, ...(screenshotRoot ? [] : ['screenshots'])),
    /** Directory build logs are written to, created on demand. */
    buildLogs: () => makeDataDir(dataRoot, 'logs'),
    /** DerivedData root for one project's fingerprint, created on demand. */
    derivedData: (key) => makeDataDir(derivedRoot ?? path.join(dataRoot, 'DerivedData'), ...(key ? [key] : [])),
  }
}

/** Logger used when a caller provides none (tests, direct provider use). */
const silentLogger = {
  info() {},
  warn() {},
  error() {},
}
