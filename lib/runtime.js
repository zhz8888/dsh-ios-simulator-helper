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
 * @module @zhz8888/dsh-ios-simulator-helper/runtime
 */

/**
 * The harness' tool execution record.
 *
 * `@deepseek-ai/dsh-tools` declares it, and with it the whole chain this
 * module reads: `agent.session.header.cwd` is the workspace the user opened.
 *
 * @typedef {import('@deepseek-ai/dsh-tools').ToolRunContext} ToolRunContext
 */

/**
 * The plugin's live settings.
 *
 * @typedef {import('./settings.js').Settings} Settings
 */

/**
 * The host logger this plugin writes through.
 *
 * @typedef {{info: (message: string) => void, warn: (message: string) => void, error: (message: string) => void}} HostLogger
 */

/**
 * Everything one tool call needs, in one object.
 *
 * @typedef {object} Runtime
 * @property {string} cwd - the session workspace, or the caller's explicit root.
 * @property {boolean} session - whether a session workspace (or explicit root) supplied the path.
 * @property {Settings} settings - the live settings, projected for this call.
 * @property {NodeJS.ProcessEnv} env - the environment the call reads.
 * @property {string} platform - the host platform.
 * @property {HostLogger} logger - the host logger.
 * @property {string} dataRoot - the plugin's data root.
 * @property {string[]} writeRoots - every absolute root the plugin writes to and
 *   reports absolutely, so a reported path can be passed back as an argument.
 * @property {() => Promise<string>} screenshots - the screenshot directory, created on demand.
 * @property {() => Promise<string>} buildLogs - the build-log directory, created on demand.
 * @property {(key?: string) => Promise<string>} derivedData - the DerivedData root, created on demand.
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
 * @param {ToolRunContext | undefined} exec - the tool execution record.
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
 * @param {ToolRunContext | undefined} options.exec - the tool execution record.
 * @param {HostLogger} [options.logger] - host logger.
 * @param {NodeJS.ProcessEnv} [options.env] - environment override (tests).
 * @param {string} [options.cwd] - explicit project root; defaults to the session workspace.
 * @param {NodeJS.Platform} [options.platform] - host platform override (tests).
 * @returns {Runtime} the per-call runtime.
 */
export function createRuntime({ config, exec, logger, env = process.env, cwd, platform = process.platform }) {
  const settings = readSettings(config, env)
  const sessionCwdValue = exec?.agent?.session?.header?.cwd
  const hasSession = cwd !== undefined || (typeof sessionCwdValue === 'string' && sessionCwdValue.length > 0)
  const projectCwd = cwd ?? (hasSession ? /** @type {string} */ (sessionCwdValue) : process.cwd())
  const dataRoot = settings.dataDir ? path.resolve(projectCwd, settings.dataDir) : defaultDataRoot(env)
  const screenshotRoot = settings.screenshotDir ? path.resolve(projectCwd, settings.screenshotDir) : undefined
  const derivedRoot = settings.derivedDataDir ? path.resolve(projectCwd, settings.derivedDataDir) : undefined
  return {
    cwd: projectCwd,
    // A configuration-page route has no session, so a workspace-relative
    // setting cannot be resolved to the directory a tool will use; callers
    // that display the value say so instead of showing process.cwd().
    session: hasSession,
    settings,
    env,
    platform,
    logger: logger ?? silentLogger,
    dataRoot,
    // A write destination this plugin computes itself may sit outside the
    // session workspace — the data root under DSH_HOME, and the screenshot and
    // DerivedData directories when the configuration page points them
    // elsewhere. The result reports such a path in its absolute form, so the
    // same roots are what a caller is allowed to pass back as an argument.
    writeRoots: [...new Set([dataRoot, ...(screenshotRoot ? [screenshotRoot] : []), ...(derivedRoot ? [derivedRoot] : [])])],
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
