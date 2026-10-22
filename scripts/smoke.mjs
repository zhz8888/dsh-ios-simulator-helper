#!/usr/bin/env node
import process from 'node:process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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

/** Run one named step, printing its result and continuing on failure. */
async function step(name, run) {
  process.stdout.write(`\n=== ${name} ===\n`)
  try {
    const value = await run()
    console.log(JSON.stringify(value, null, 2))
    return { ok: true, value }
  } catch (error) {
    console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, error }
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
results.preflight = preflightResult.ok

if (!preflightResult.ok || runtime.platform !== 'darwin') {
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
        return { simulator: capture.simulator.name, path: capture.path, bytes: capture.bytes }
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

const failed = Object.entries(results).filter(([, ok]) => ok !== true).map(([name]) => name)
console.log(`\nsteps: ${Object.keys(results).length}, failed: ${failed.length === 0 ? 'none' : failed.join(', ')}`)
if (!preflightResult.ok) {
  console.log('preflight verdict: not ready (see the failing checks above)')
} else {
  console.log(`preflight verdict: ready${withSimulator ? '' : ' (read-only run; pass --with-simulator for the full loop)'}`)
}
process.exit(0)
