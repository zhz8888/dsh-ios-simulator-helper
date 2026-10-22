/**
 * What the smoke run prints, kept out of the script that drives the machine.
 *
 * `scripts/smoke.mjs` is not part of `pnpm test`: it starts Xcode, simulators
 * and a real build. The two decisions it makes about its own transcript — a
 * failed step is reported and the run continues, and the summary says plainly
 * whether the environment was ready — are the parts that used to be wrong, and
 * they are testable only if they live somewhere a unit test can reach. This
 * module is that place; the script keeps the driving.
 *
 * @module scripts/lib/smoke-report
 */

/**
 * What a step's caller needs to know about it.
 *
 * @typedef {{ok: true, value: unknown} | {ok: false, error: unknown}} StepResult
 */

/**
 * Where a step's output goes.
 *
 * @typedef {object} StepIo
 * @property {(text: string) => void} write - raw section headings.
 * @property {(value: unknown) => void} log - one formatted line or value.
 */

/**
 * Run one named step, printing its result and continuing on failure.
 *
 * A step that throws must not abort the run: the steps that follow it — the
 * cleanup that shuts down a simulator this run booted, and the summary that
 * says what happened — are the whole point of the transcript. The failure is
 * logged and returned, never rethrown.
 *
 * @template T
 * @param {string} name - the step label.
 * @param {() => Promise<T>} body - the step itself.
 * @param {StepIo} io - where to print.
 * @returns {Promise<{ok: true, value: T} | {ok: false, error: unknown}>} the outcome.
 */
export async function runStep(name, body, io) {
  io.write(`\n=== ${name} ===\n`)
  try {
    const value = await body()
    io.log(JSON.stringify(value, null, 2))
    return { ok: true, value }
  } catch (error) {
    io.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, error }
  }
}

/**
 * The two summary lines one run ends with.
 *
 * `results` is the script's own record of what each named part of the run
 * established — never "the function returned". A step whose body returned a
 * failed report is recorded as `false` by the caller, which is why the summary
 * reads that record instead of counting steps.
 *
 * The preflight verdict is a separate fact from the step count: `preflight()`
 * reports a missing Xcode as a returned report rather than a thrown error, so a
 * run can have every step "succeed" and still be on a machine that cannot build
 * anything. Saying `ready` there was the misreport this line exists to prevent;
 * the read-only note keeps a run without `--with-simulator` from reading as a
 * full validation.
 *
 * @param {Record<string, boolean>} results - one entry per named outcome, `true` when it held.
 * @param {boolean} preflightReady - whether the diagnostic's verdict was ready.
 * @param {boolean} withSimulator - whether the write path was exercised.
 * @returns {string[]} the lines to print, in order.
 */
export function summaryLines(results, preflightReady, withSimulator) {
  const failed = Object.entries(results)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name)
  return [
    `steps: ${Object.keys(results).length}, failed: ${failed.length === 0 ? 'none' : failed.join(', ')}`,
    preflightReady
      ? `preflight verdict: ready${withSimulator ? '' : ' (read-only run; pass --with-simulator for the full loop)'}`
      : 'preflight verdict: not ready (see the failing checks above)',
  ]
}
