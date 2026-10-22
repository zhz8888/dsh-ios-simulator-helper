import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runStep, summaryLines } from '../scripts/lib/smoke-report.mjs'

/**
 * Tests for the smoke run's transcript.
 *
 * `scripts/smoke.mjs` needs Xcode, a simulator and a real build, so it is not
 * part of `pnpm test`. What it says about itself is a separate question, and
 * the two ways it used to lie — aborting the run on the first failed step, and
 * printing "ready" for a machine the diagnostic had just refused — are checked
 * here.
 */

/** A recording `StepIo`. */
function recorder() {
  return { written: [], logged: [], write(text) { this.written.push(text) }, log(value) { this.logged.push(value) } }
}

test('a failed step is reported and the run continues', async () => {
  // The cleanup that shuts down a simulator this run booted, and the summary
  // that says what happened, both come after the steps; a step that throws must
  // not take them with it. The failure is a printed line and a returned record.
  const io = recorder()
  const outcome = await runStep('ios_screenshot', async () => {
    throw new Error('the capture is black')
  }, io)
  assert.equal(outcome.ok, false)
  assert.match(String(outcome.error), /the capture is black/)
  assert.deepEqual(io.written, ['\n=== ios_screenshot ===\n'])
  assert.deepEqual(io.logged, ['FAILED: the capture is black'])
})

test('a successful step prints its value and returns it', async () => {
  const io = recorder()
  const outcome = await runStep('ios_list_simulators', async () => ({ count: 2 }), io)
  assert.deepEqual(outcome, { ok: true, value: { count: 2 } })
  assert.deepEqual(io.logged, [JSON.stringify({ count: 2 }, null, 2)])
})

test('the summary counts the named outcomes and names the failed ones', () => {
  assert.deepEqual(summaryLines({ create: true, build: true, launch: true }, true, true), [
    'steps: 3, failed: none',
    'preflight verdict: ready',
  ])
  assert.deepEqual(summaryLines({ create: true, screenshot: false, build: true }, true, true)[0], (
    'steps: 3, failed: screenshot'
  ))
  // A missing entry is not a success: the record only carries outcomes the run
  // established.
  assert.equal(summaryLines({}, true, true)[0], 'steps: 0, failed: none')
})

test('a read-only run says so instead of reading as a full validation', () => {
  const [, line] = summaryLines({ preflight: true, simulators: true }, true, false)
  assert.match(line, /^preflight verdict: ready \(read-only run; pass --with-simulator for the full loop\)$/)
})

test('a not-ready diagnostic is never summarised as ready', () => {
  // `preflight()` reports a missing Xcode as a returned report, not a thrown
  // error, so every step can be "ok" on a machine that cannot build anything.
  // The verdict comes from the report, not from the step count.
  const [steps, verdict] = summaryLines({ preflight: false, simulators: true }, false, true)
  assert.equal(steps, 'steps: 2, failed: preflight')
  assert.equal(verdict, 'preflight verdict: not ready (see the failing checks above)')
})
