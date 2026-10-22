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
 * @property {boolean} timed - whether the timeout had to stop a process that was still running.
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
 * The most output one stream may buffer.
 *
 * The providers keep the whole child output in memory and truncate it after the
 * fact, so an unbounded buffer is the one place a long-running `log show` or a
 * huge build log could take the host down. Drained bytes past the cap are
 * discarded, and the reader marks the text as truncated.
 */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

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
 * only when the process is gone AND its pipes are closed. Both signals go to
 * the child's process group on POSIX, so the helpers it started are stopped
 * with it rather than left behind.
 */
const KILL_GRACE_MS = 2_000

/**
 * @param {string[]} cmd - argv vector; `cmd[0]` is the executable.
 * @param {RunOptions} [opts] - process options.
 * @returns {Promise<RunResult>} exit code, decoded output, and whether the
 *   timeout stopped a process that was still running.
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
  let exited = false
  /** @type {number | null} */
  let exitCode = null
  /** @type {NodeJS.Timeout | undefined} */
  let escalation
  /** @type {NodeJS.Timeout | undefined} */
  let timer
  let settled = false

  const stdout = collector(child.stdout)
  const stderr = collector(child.stderr)
  if (opts.input !== undefined && child.stdin) {
    // A child that closes stdin before reading it is not a failure of the
    // call, and an unhandled 'error' here would take the process down.
    child.stdin.on('error', () => {})
    child.stdin.write(opts.input)
    child.stdin.end()
  }

  // The spawn error arrives on the child's `error` event, so it is only
  // assigned inside a callback; the annotation keeps that fact visible to the
  // type checker instead of leaving it to be inferred as `never`.
  /** @type {Error | undefined} */
  let spawnError
  const code = await new Promise((resolve) => {
    /**
     * Settle once, releasing the timer and (on an abandoned call) the pipes.
     *
     * @param {number} value - the exit code to report.
     * @param {boolean} [discard] - whether any pending output is abandoned.
     */
    const finish = (value, discard = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (escalation !== undefined) clearTimeout(escalation)
      if (discard) {
        // A surviving grandchild may still hold the pipes; releasing the read
        // side keeps a killed call from staying open on a stream nobody reads.
        child.stdout?.destroy()
        child.stderr?.destroy()
      }
      resolve(value)
    }
    timer = setTimeout(() => {
      // A command that already exited but left a grandchild holding its stdout
      // pipe never emits 'close'. The command itself succeeded, so the real
      // exit code is reported and the call is not a timeout; the tree is still
      // signalled so the grandchild does not linger.
      if (exited) {
        finish(exitCode ?? 1, true)
        signalTree(child, 'SIGTERM')
        return
      }
      timed = true
      signalTree(child, 'SIGTERM')
      // A child that traps SIGTERM is killed outright, and the call settles on
      // the process exit rather than waiting for pipes a surviving grandchild
      // may still hold. A child that already exited before the timeout leaves
      // neither signal anything to do, so this grace timer is also what turns
      // that case into a bounded return.
      escalation = setTimeout(() => {
        signalTree(child, 'SIGKILL')
        if (!settled) finish(exited ? (exitCode ?? 1) : 1, true)
      }, KILL_GRACE_MS)
    }, timeout)
    child.once('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error))
      finish(127, true)
    })
    child.once('exit', (value) => {
      exited = true
      exitCode = value
      // After a kill the output is abandoned, so the call settles on the
      // process exit: 'close' would wait for pipes a surviving grandchild
      // still holds.
      if (timed) finish(value ?? 1, true)
    })
    child.once('close', (value) => {
      exited = true
      exitCode = value
      finish(value ?? 1)
    })
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
      // On POSIX the child leads its own process group, so the timeout can
      // reach the whole tree it starts. `xcodebuild` runs compiler helpers as
      // grandchildren, and a signal delivered only to the direct child leaves
      // them compiling after the call has given up. Windows has no negative-pid
      // group signal, so the direct child stays the only target there.
      detached: process.platform !== 'win32',
      stdio: [pipeStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

/**
 * Signal a child and, on POSIX, every process in its group.
 *
 * The child was spawned as its own process-group leader, so `-pid` names the
 * whole tree: `xcodebuild` starts compiler helpers that outlive their parent
 * unless the group is signalled. A group that is already gone makes
 * `process.kill` throw `ESRCH`, and a child whose spawn failed has no pid at
 * all; both fall back to the direct child, which is all Windows ever gets.
 *
 * @param {import('node:child_process').ChildProcess} child - the child to signal.
 * @param {NodeJS.Signals} signal - the signal to send.
 */
function signalTree(child, signal) {
  const pid = child.pid
  if (process.platform !== 'win32' && typeof pid === 'number' && pid > 0) {
    try {
      process.kill(-pid, signal)
      return
    } catch {
      // The group is gone; the direct child is signalled below.
    }
  }
  child.kill(signal)
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
  let bytes = 0
  let truncated = false
  if (stream) {
    stream.on('data', (chunk) => {
      if (truncated) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      const room = MAX_OUTPUT_BYTES - bytes
      if (buffer.length > room) {
        if (room > 0) chunks.push(buffer.subarray(0, room))
        bytes = MAX_OUTPUT_BYTES
        truncated = true
        return
      }
      chunks.push(buffer)
      bytes += buffer.length
    })
    // A pipe broken by the kill is expected, not a failure of the call.
    stream.on('error', () => {})
  }
  return () => {
    const text = Buffer.concat(chunks).toString('utf8')
    return truncated ? `${text}\n...[output truncated after ${MAX_OUTPUT_BYTES} bytes]` : text
  }
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
 * Join a result's output, keeping the end rather than the beginning.
 *
 * Build tools report the failure summary (`error:` lines, `** BUILD FAILED **`)
 * at the end of their output, so a report that keeps the head shows the
 * compiler warm-up and hides the reason.
 *
 * @param {RunResult} item - the finished process.
 * @param {number} [limit] - maximum characters to keep.
 * @returns {string} the joined output.
 */
export function tail(item, limit = 4000) {
  const text = [item.stdout.trim(), item.stderr.trim()].filter(Boolean).join('\n')
  if (text.length <= limit) return text
  return `...[truncated ${text.length - limit} characters]\n${text.slice(-limit)}`
}

/**
 * The message a failed command reports.
 *
 * `brief` can be empty when a process is killed before it writes anything, and
 * `new Error('')` is an answer the caller cannot use. The timeout and the exit
 * code are the facts that distinguish "killed after N ms" from "exited 1 with
 * no output".
 *
 * @param {RunResult} item - the finished process.
 * @returns {string} a non-empty description of the failure.
 */
export function failureText(item) {
  const detail = brief(item)
  if (detail.length > 0) return detail
  const reason = item.timed ? 'timed out' : `exited with code ${item.code}`
  return `${item.cmd.join(' ') || 'the command'} ${reason} without producing output`
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
