#!/usr/bin/env node
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { decodePng, pixelAt } from '../test/helpers/decode-png.mjs'
import { runStep, summaryLines } from './lib/smoke-report.mjs'
import { createRuntime } from '../lib/runtime.js'
import { inventory, preflight } from '../lib/providers/preflight.js'
import { app, runApp } from '../lib/providers/build.js'
import { logs } from '../lib/providers/logs.js'
import { create, discover } from '../lib/providers/project.js'
import { shot } from '../lib/providers/screenshot.js'
import { list, listRuntimes, pick, shutdown, terminate } from '../lib/providers/sim.js'
import { status as uiStatus } from '../lib/providers/ui.js'

/**
 * Integration smoke test: run the ported providers against the real machine.
 *
 * The unit tests cover the parsers and the selection rules; this script covers
 * everything only a real Mac with Xcode can prove — xcode-select, xcodebuild,
 * simctl, runtime discovery, the generated project, a real build, a real
 * install/launch, a real screenshot and real logs. It is not part of
 * `pnpm test`, because it needs Xcode and takes tens of seconds.
 *
 *   node scripts/smoke.mjs                     # read-only probes
 *   node scripts/smoke.mjs --with-simulator    # create, build, run, screenshot, shut down
 *
 * Options: `--device <name fragment>`, `--data-dir <path>`, `--keep` (leave the
 * generated project), `--no-macros` (see below).
 *
 * `--no-macros` replaces the generated `ContentView.swift` with a variant that
 * uses no Swift macros. The original template's `@State` and `#Preview` need
 * `swift-plugin-server`, which runs its macro expansion under `sandbox-exec`;
 * a caller that is *itself* sandboxed (the DSH bash tool, for example) cannot
 * start that nested sandbox, and the first compile fails with
 * `sandbox-exec: sandbox_apply: Operation not permitted`. `ios_build_app`
 * recognizes exactly that signature and retries with
 * `OTHER_SWIFT_FLAGS=-disable-sandbox`, so a plain `--with-simulator` run does
 * build the real template; the flag stays for isolating macro expansion from
 * this plugin's own orchestration.
 *
 * `--with-simulator` writes under the generated project when no `--data-dir` and
 * no `IOS_SIM_PLUGIN_DATA` are given, so the run stays inside a writable
 * directory even when the caller is itself sandboxed. A failed step is reported
 * and the script exits 0 either way: the point is the transcript, not the code.
 */

const withSimulator = process.argv.includes('--with-simulator')
const keep = process.argv.includes('--keep')
const noMacros = process.argv.includes('--no-macros')
const deviceIndex = process.argv.indexOf('--device')
const device = deviceIndex === -1 ? undefined : process.argv[deviceIndex + 1]
const dataDirIndex = process.argv.indexOf('--data-dir')
const dataDirArg = dataDirIndex === -1 ? undefined : process.argv[dataDirIndex + 1]

/**
 * Run one named step, printing its result and continuing on failure.
 *
 * The reporting itself lives in `scripts/lib/smoke-report.mjs` so a unit test
 * can pin it without driving the machine; `pnpm test` never runs this script.
 *
 * @template T
 * @param {string} name - the step label.
 * @param {() => Promise<T>} run - the step body.
 * @returns {Promise<{ok: true, value: T} | {ok: false, error: unknown}>} the outcome.
 */
function step(name, run) {
  return runStep(name, run, { write: (text) => process.stdout.write(text), log: (value) => console.log(value) })
}

/**
 * Measure one capture, so a blank frame is a finding rather than a green step.
 *
 * A device pair (Xcode 26's `iPhone Duo`) makes `simctl io <udid> screenshot`
 * capture its secondary display by default, and that display renders black —
 * the plugin answers `ok: true` with a uniformly black PNG unless the capture
 * asks for the primary display. A byte count cannot tell the two apart, so the
 * frame is decoded and sampled: a real screen is bright somewhere.
 *
 * The decoder is the test suite's own — this script and `test/manifest.test.js`
 * are its only users, and the plugin itself never decodes a PNG.
 *
 * @param {string} file - the captured PNG.
 * @returns {{width: number, height: number, meanLuma: number, nonBlackPercent: number, sampled: number}} the statistics.
 */
function captureStats(file) {
  const image = decodePng(readFileSync(file))
  // Every seventh pixel in both directions: a screenshot is millions of pixels
  // and the question is only "is any of it lit", not what it shows.
  const stride = 7
  let sum = 0
  let sampled = 0
  let lit = 0
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const { r, g, b } = pixelAt(image, x, y)
      sum += 0.299 * r + 0.587 * g + 0.114 * b
      if (r + g + b > 24) lit += 1
      sampled += 1
    }
  }
  return {
    width: image.width,
    height: image.height,
    meanLuma: Math.round((sum / sampled) * 100) / 100,
    nonBlackPercent: Math.round((lit / sampled) * 1000) / 10,
    sampled,
  }
}

/** The macro-free starter view `--no-macros` writes; see the note at the top. */
const MACRO_FREE_VIEW = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 20) {
            Text("Hello from iOS")
                .font(.largeTitle)
            Text("Count: 0")
                .font(.title2)
                .accessibilityIdentifier("countLabel")
        }
        .padding()
    }
}
`

const root = withSimulator ? await mkdtemp(path.join(os.tmpdir(), 'ios-helper-smoke-')) : process.cwd()
const env = { ...process.env }
if (dataDirArg !== undefined) env.IOS_SIM_PLUGIN_DATA = dataDirArg
else if (withSimulator && env.IOS_SIM_PLUGIN_DATA === undefined) env.IOS_SIM_PLUGIN_DATA = path.join(root, '.plugin-data')
const config = {}
const runtime = createRuntime({ config, exec: undefined, logger: console, cwd: root, env })

console.log(`session workspace: ${runtime.cwd}`)
console.log(`data root:         ${runtime.dataRoot}`)
console.log(`host platform:     ${runtime.platform}`)

const results = {}
const preflightResult = await step('ios_preflight', () => preflight(runtime))
// `preflight` reports a missing Xcode as `{ok: false}` rather than throwing, so
// the step's own success only says the function returned. The verdict is the
// report's `ok`, and that is what the summary must print.
const preflightReady = preflightResult.ok && preflightResult.value.ok === true
results.preflight = preflightReady

if (!preflightReady || runtime.platform !== 'darwin') {
  console.log('\nHost is not ready; staying with the read-only probes that still mean something.')
} else {
  results.simulators = (await step('ios_list_simulators', async () => ({
    simulators: (await list(runtime)).map((item) => `${item.name} (${item.state})`),
    runtimes: (await listRuntimes(runtime)).map((item) => `${item.name}${item.available ? '' : ' (unavailable)'}`),
  }))).ok
  results.discover = (await step('ios_discover_project', () => discover(runtime, runtime.cwd))).ok
  results.inventory = (await step('settings inventory (settings-page route)', () => inventory(runtime))).ok
  results.ui = (await step('ios_ui_status', () => uiStatus(runtime))).ok
}

if (withSimulator && runtime.platform === 'darwin') {
  const created = await step('ios_create_app', () =>
    create(runtime, { name: 'SmokeApp', dir: 'SmokeApp', bundleId: 'com.example.smokeapp', deployment: '17.0' }),
  )
  results.create = created.ok

  if (noMacros && created.ok) {
    // The rewrite goes through `step()` like every other write here: an
    // unguarded rejection would abort the script before the cleanup removed
    // the throwaway project, and before the summary said what happened.
    const view = path.join(root, 'SmokeApp', 'SmokeApp', 'ContentView.swift')
    results.macros = (
      await step('rewrite ContentView.swift without Swift macros', async () => {
        await writeFile(view, MACRO_FREE_VIEW, 'utf8')
        return { rewrote: path.relative(root, view) }
      })
    ).ok
  }

  // Remember whether the session booted the device or found it already running,
  // so the cleanup below never shuts down a simulator the user was using.
  const before = await step('target simulator', () => pick(runtime, { device }))
  const alreadyBooted = before.ok && before.value.state === 'Booted'
  let simulator = before.ok ? before.value : undefined

  const built = await step('ios_build_and_run', () =>
    runApp(runtime, { device, openSimulator: false, launchArgs: [] }),
  )
  results.build = built.ok && built.value.ok === true
  results.launch = built.ok && built.value.launched?.launched === true
  if (built.ok) simulator = built.value.simulator ?? simulator

  if (built.ok && built.value.ok) {
    results.screenshot = (
      await step('ios_screenshot', async () => {
        const capture = await shot(runtime, { udid: simulator.udid })
        const stats = captureStats(capture.absolutePath)
        // A capture that succeeded but shows nothing is the failure D1 found:
        // the command exits 0, the PNG is valid, and every pixel is black.
        if (stats.nonBlackPercent === 0) {
          throw new Error(
            `the capture at ${capture.absolutePath} is uniformly black (${stats.width}x${stats.height}, `
              + `meanLuma ${stats.meanLuma}) — the command succeeded but the frame is not the screen`,
          )
        }
        return { simulator: capture.simulator.name, path: capture.path, bytes: capture.bytes, ...stats }
      })
    ).ok

    results.logs = (
      await step('ios_logs', async () => {
        const result = await logs(runtime, { udid: simulator.udid, bundleId: built.value.bundleId, seconds: 60 })
        return { seconds: result.seconds, characters: result.characters, firstLine: result.output.split('\n')[0] ?? '' }
      })
    ).ok

    results.terminate = (
      await step('ios_terminate_app', () => terminate(runtime, simulator.udid, built.value.bundleId))
    ).ok
  } else if (built.ok) {
    // A failed *build* is a finding, not a script bug: report the tail.
    console.log('\nbuild failed; tail of the compiler output:')
    console.log(String(built.value.output ?? '').split('\n').slice(-30).join('\n'))
  } else {
    const retry = await step('ios_build_app (retry without launching)', () => app(runtime, { device, openSimulator: false }))
    results.build = retry.ok && retry.value.ok === true
  }

  // Cleanup: stop what this run started, and only that.
  if (simulator !== undefined && !alreadyBooted) {
    results.shutdown = (
      await step('ios_shutdown_simulator (cleanup)', () => shutdown(runtime, { udid: simulator.udid }))
    ).ok
  } else if (simulator !== undefined) {
    console.log('\n(the target simulator was already booted before this run; leaving it running)')
  }
}

if (withSimulator) {
  if (keep) console.log(`\nkept generated project at ${root}`)
  else await rm(root, { recursive: true, force: true })
}

for (const line of summaryLines(results, preflightReady, withSimulator)) console.log(line)
process.exit(0)
