import { spawn as spawnChild } from 'node:child_process'

/**
 * Run one child process and collect its whole output.
 *
 * The ported providers only ever invoke Apple's command-line tools
 * (`xcrun`, `xcodebuild`, `open`, `idb`, `sw_vers`), so this stays deliberately
 * small: no shell, an explicit environment, an optional stdin payload, and a
 * timeout that SIGTERMs the child and then SIGKILLs it. Everything the plugin
 * needs to know about a failure is in the returned record rather than in a
 * thrown error, so callers decide whether a non-zero exit is fatal — a missing
 * `xcodebuild` is a preflight finding, not a crash.
 *
 * The timeout is a bound, not a request: a child that traps SIGTERM, or a
 * grandchild that inherits the stdout pipe, must not keep the call open.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/util/run
 */

/**
 * One finished child process.
 *
 * @typedef {object} RunResult
 * @property {string[]} cmd - the argv vector that was run.
 * @property {number} code - the exit code; 127 for a spawn failure.
 * @property {string} stdout - the decoded standard output.
 * @property {string} stderr - the decoded standard error.
 * @property {boolean} timed - whether the timeout killed the process.
 */

/**
 * The options one run accepts.
 *
 * @typedef {object} RunOptions
 * @property {string} [cwd] - the working directory.
 * @property {Record<string, string | undefined>} [env] - environment merged over `process.env`.
 * @property {string} [input] - a payload written to stdin, which is then closed.
 * @property {number} [timeout] - milliseconds before SIGTERM; an unusable value
 *   becomes the 120 s default.
 */

/** The timeout a call uses when it names no usable one. */
const DEFAULT_TIMEOUT_MS = 120_000

/**
 * The longest delay a timer can represent.
 *
 * Node's timers take a 32-bit signed millisecond delay; a larger one
 * overflows to 1 ms, so the child would be killed instantly and the call
 * reported as a timeout that never elapsed.
 */
const MAX_TIMEOUT_MS = 2_147_483_647

/**
 * Milliseconds between the SIGTERM and the SIGKILL that follows it.
 *
 * The escalation is what makes the timeout a bound rather than a request: a
 * child that traps SIGTERM, or a grandchild that inherits the stdout pipe,
 * would otherwise keep the call open forever, because the promise settles
 * only when the process is gone AND its pipes are closed.
 */
const KILL_GRACE_MS = 2_000

/**
 * @param {string[]} cmd - argv vector; `cmd[0]` is the executable.
 * @param {RunOptions} [opts] - process options.
 * @returns {Promise<RunResult>} exit code, decoded output, and whether the
 *   timeout killed the process.
 */
export async function run(cmd, opts = {}) {
  const env = /** @type {Record<string, string>} */ (
    Object.fromEntries(
      Object.entries({ ...process.env, ...(opts.env ?? {}) }).filter((item) => typeof item[1] === 'string'),
    )
  )
  const actual = commandForPlatform(cmd)
  const child = spawn(actual, opts.cwd, env, opts.input !== undefined)
  if (child instanceof Error) {
    return { cmd, code: 127, stdout: '', stderr: child.message, timed: false }
  }

  const timeout = clampTimeout(opts.timeout)
  let timed = false
  /** @type {NodeJS.Timeout | undefined} */
  let escalation
  const timer = setTimeout(() => {
    timed = true
    child.kill('SIGTERM')
    // A child that traps SIGTERM is killed outright, and the call settles on
    // the process exit rather than waiting for pipes a surviving grandchild
    // may still hold.
    escalation = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
  }, timeout)

  const stdout = collector(child.stdout)
  const stderr = collector(child.stderr)
  if (opts.input !== undefined && child.stdin) {
    child.stdin.write(opts.input)
    child.stdin.end()
  }

  // The spawn error arrives on the child's `error` event, so it is only
  // assigned inside a callback; the annotation keeps that fact visible to the
  // type checker instead of leaving it to be inferred as `never`.
  /** @type {Error | undefined} */
  let spawnError
  const code = await new Promise((resolve) => {
    let settled = false
    const settle = (/** @type {number | null} */ exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (escalation !== undefined) clearTimeout(escalation)
      resolve(exitCode)
    }
    child.once('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error))
      settle(127)
    })
    // After a kill the output is abandoned, so the call settles on the process
    // exit: 'close' would wait for pipes a surviving grandchild still holds.
    child.once('exit', (exitCode) => {
      if (timed) settle(exitCode ?? 1)
    })
    child.once('close', (exitCode) => settle(exitCode ?? 1))
  })

  const out = stdout()
  const err = stderr()
  return {
    cmd,
    code,
    stdout: out,
    stderr: spawnError ? [err.trim(), spawnError.message].filter(Boolean).join('\n') : err,
    timed,
  }
}

/**
 * The timeout one call actually uses.
 *
 * A delay that is not a positive finite number, or one beyond what a timer
 * can represent, is not a timeout the caller meant: Node would overflow the
 * last to 1 ms and kill the child instantly. The default is used instead, so
 * an unusable value can never turn into an instant kill.
 *
 * @param {number | undefined} value - the requested timeout in milliseconds.
 * @returns {number} a delay the timer can honour.
 */
function clampTimeout(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  const ms = Math.trunc(value)
  if (ms <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(ms, MAX_TIMEOUT_MS)
}

/**
 * Spawn without a shell, returning the error instead of throwing on a bad argv.
 *
 * @param {string[]} cmd - argv vector.
 * @param {string | undefined} cwd - the working directory.
 * @param {Record<string, string>} env - the child's environment.
 * @param {boolean} pipeStdin - whether stdin is a pipe rather than ignored.
 * @returns {import('node:child_process').ChildProcess | Error} the child, or the spawn error.
 */
function spawn(cmd, cwd, env, pipeStdin) {
  const [command, ...args] = cmd
  if (!command) return new Error('Missing command')
  try {
    return spawnChild(command, args, {
      cwd,
      env,
      shell: false,
      stdio: [pipeStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

/**
 * Buffer one readable stream as UTF-8 text.
 *
 * The chunks are collected as they arrive and read on demand, rather than
 * awaited to the end of the stream: after a timeout the child is killed and a
 * grandchild may still hold the pipe, so waiting for the end of the stream
 * would keep the call open exactly when it must end. A normal exit settles on
 * 'close', which the child emits only after both pipes are closed, so the text
 * is complete in that case.
 *
 * @param {import('node:stream').Readable | null | undefined} stream - the stream to read.
 * @returns {() => string} a reader for the text collected so far.
 */
function collector(stream) {
  /** @type {Buffer[]} */
  const chunks = []
  if (stream) {
    stream.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    })
    // A pipe broken by the kill is expected, not a failure of the call.
    stream.on('error', () => {})
  }
  return () => Buffer.concat(chunks).toString('utf8')
}

/**
 * Route `.bat`/`.cmd` launchers through `cmd.exe` on Windows, as Node requires.
 *
 * @param {string[]} cmd - argv vector.
 * @returns {string[]} the argv to run.
 */
function commandForPlatform(cmd) {
  const head = cmd[0]
  if (process.platform !== 'win32' || !head || !/\.(bat|cmd)$/i.test(head)) return cmd
  return ['cmd.exe', '/d', '/s', '/c', cmd.map(cmdQuote).join(' ')]
}

/**
 * Quote one argv token for the `cmd.exe` fallback above.
 *
 * @param {string} value - the token to quote.
 * @returns {string} the quoted token.
 */
function cmdQuote(value) {
  if (!/[ \t&()^|<>"]/.test(value)) return value
  return `"${value.replace(/(["^])/g, '^$1')}"`
}

/**
 * Whether a `run()` result represents a clean, non-timed-out exit.
 *
 * @param {RunResult} item - the finished process.
 * @returns {boolean} true when the process exited zero and did not time out.
 */
export function ok(item) {
  return item.code === 0 && !item.timed
}

/**
 * Join a result's output and truncate it to a model-friendly size.
 *
 * @param {RunResult} item - the finished process.
 * @param {number} [limit] - maximum characters to keep.
 * @returns {string} the joined output.
 */
export function brief(item, limit = 4000) {
  const text = [item.stdout.trim(), item.stderr.trim()].filter(Boolean).join('\n')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n...[truncated]`
}

/**
 * Split a settings textarea into argv tokens, one argument per line.
 *
 * A line-by-line grammar is used instead of shell-ish splitting so an argument
 * may contain spaces without needing quotes: everything after the first
 * non-space character of a line is kept verbatim, `#` comments and blank lines
 * are dropped, and a trailing newline is insignificant.
 *
 * @param {unknown} value - the raw setting text.
 * @returns {string[]} the arguments, in order.
 */
export function splitArgumentLines(value) {
  if (typeof value !== 'string') return []
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}
