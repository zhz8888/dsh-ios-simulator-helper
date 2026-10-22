import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
// Deliberately no `test/helpers/offline-seam.mjs` here. These cases are about
// what a real child process does — exiting while a grandchild holds its pipe,
// leading a process group, surviving SIGTERM — and a canned `spawn` answers the
// opposite of every question they ask.
import { ok, run } from '../lib/util/run.js'

/**
 * `run()`'s process lifecycle, proven against real children.
 *
 * The rest of the suite never starts a real process: the offline seam answers
 * Apple's tooling so that `pnpm test` needs no Xcode. The timeout contract is
 * the one behaviour that cannot be faked that way — a canned child has no exit
 * code of its own and no process group — so these cases run `/bin/sh` and are
 * kept to the two properties the shell can produce in well under a second:
 *
 *   - a command that exited successfully is reported as a success even when a
 *     grandchild it started still holds the stdout pipe (the pipe is what kept
 *     `close` from firing, and that used to turn the success into a "timeout");
 *   - the timeout stops the whole process group, not only the direct child, so
 *     a timed-out `xcodebuild` leaves no compiler helper behind.
 *
 * Both time-based assertions are bounded well below the 30 s lifetime of the
 * grandchildren, so a regression fails the case instead of hanging it.
 */

/** The most a settled call may take in the "already exited" case: the kill grace is 2 s. */
const BOUNDED_MS = 2_500

/**
 * Whether a pid names a process that still exists.
 *
 * `kill(pid, 0)` performs the permission and existence checks without sending
 * anything, which is exactly the question these cases ask.
 *
 * @param {number} pid - the process to probe.
 * @returns {boolean} true when the process is still there.
 */
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Wait for a pid to disappear, giving the system a moment to reap it.
 *
 * A signalled process is gone as far as the kernel's signal delivery is
 * concerned before whoever inherited it reaps the zombie, and `kill(pid, 0)`
 * still succeeds on a zombie. The bounded wait is what makes "it is gone"
 * assertable without turning a scheduler race into a flaky test; a process that
 * is genuinely still running never disappears.
 *
 * @param {number} pid - the process to watch.
 * @param {number} ms - how long to wait.
 * @returns {Promise<boolean>} true when the pid disappeared within `ms`.
 */
async function goneWithin(pid, ms) {
  const deadline = Date.now() + ms
  for (;;) {
    if (!alive(pid)) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

test('a command that already exited is a success even when a grandchild holds its pipe', async () => {
  // The shell exits 0 immediately and leaves `sleep` running with the stdout
  // pipe it inherited, so `close` — the event a clean exit normally settles on —
  // never fires. The timer is what releases the call, and the command did
  // succeed: reporting `timed` here turned a clean exit into a failed call.
  const started = Date.now()
  const out = await run(['/bin/sh', '-c', 'sleep 30 & exit 0'], { timeout: 300 })
  const elapsed = Date.now() - started
  assert.equal(out.code, 0, 'the exit code the command produced must be reported')
  assert.equal(out.timed, false, 'the command had already exited when the timer fired')
  assert.equal(ok(out), true, 'a command that exited zero and did not time out is a success')
  assert.ok(elapsed < BOUNDED_MS, `the call settled after ${elapsed} ms, which is not a bounded return`)
})

test('a timed-out command takes its whole process group down, not just the direct child', async () => {
  // `sh` waits for the background `sleep`, so the direct child is alive when the
  // timer fires and the group is what carries the grandchild. Signalling only
  // the direct child left the sleep running for its full 30 s.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-run-group-'))
  const pidfile = path.join(dir, 'grandchild.pid')
  /** @type {number | undefined} */
  let grandchild
  try {
    const out = await run(['/bin/sh', '-c', `sleep 30 & echo $! > "${pidfile}"; wait`], { timeout: 300 })
    assert.equal(out.timed, true, 'the direct child was still running when the timer fired')
    grandchild = Number((await readFile(pidfile, 'utf8')).trim())
    assert.ok(Number.isInteger(grandchild) && grandchild > 0, `the pid file must hold a pid, got "${grandchild}"`)
    assert.equal(await goneWithin(grandchild, 2_000), true, 'the grandchild outlived the call')
  } finally {
    // Leave nothing behind even when the assertion above failed.
    if (grandchild !== undefined && alive(grandchild)) {
      try {
        process.kill(grandchild, 'SIGKILL')
      } catch {
        // It died between the probe and the signal.
      }
    }
    await rm(dir, { recursive: true, force: true })
  }
})

test('a live child that traps SIGTERM is still killed after the grace period', async () => {
  // The escalation has to survive the group signalling: a child that ignores
  // SIGTERM is what makes the timeout a bound rather than a request, and it is
  // the SIGKILL to the group, not the SIGTERM, that ends it.
  const started = Date.now()
  const out = await run(['/bin/sh', '-c', 'trap "" TERM; while :; do sleep 1; done'], { timeout: 300 })
  const elapsed = Date.now() - started
  assert.equal(out.timed, true, 'the child was alive when the timer fired')
  assert.equal(ok(out), false, 'a timed-out command is not a success')
  assert.ok(elapsed >= 2_000, `the call settled after ${elapsed} ms, before the SIGKILL grace period`)
  assert.ok(elapsed < BOUNDED_MS + 2_000, `the call settled after ${elapsed} ms, which is not a bounded return`)
})
