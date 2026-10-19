#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'

/**
 * Mount the plugin on a REAL Cordis context with the REAL tool registry, then
 * dispatch through it.
 *
 * The unit tests use a hand-written context stand-in, which pins the plugin's
 * own behaviour but not the harness contract. This harness closes that gap: the
 * registry validates the argument and result schemas for real, the fiber owns
 * `tools.register`, and disposal is exercised through the actual lifecycle.
 *
 * Hermetic by default, because DSH mounts every profile bundle at application
 * boot: the load itself must start nothing, and this harness must not be the
 * reason a schema question spins up the simulator stack. `xcodebuild`,
 * `xcrun simctl` and `idb` start CoreSimulatorService and enumerate simulator
 * runtimes and devices, so they belong to `scripts/smoke.mjs`; `--with-simulator`
 * opts into them here.
 *
 * Run with `pnpm run verify:mount`, or `pnpm run verify:mount -- --with-simulator`.
 */

let failures = 0

/** Report one assertion. */
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`)
}

/** Command names that mean the simulator stack was touched. */
const APPLE_TOOLS = ['xcodebuild', 'xcode-select', 'xcrun', 'simctl', 'idb', 'sw_vers']

/** Whether the caller asked for the probes that reach Apple's tooling. */
const withSimulator = process.argv.includes('--with-simulator')

// Record every child process before the plugin is imported. `lib/util/run.js`
// takes `spawn` as an ESM named import of a CommonJS builtin, and that binding
// snapshots the property at module evaluation, so a later patch would be ignored.
const require = createRequire(import.meta.url)
const childProcess = require('node:child_process')
const util = require('node:util')
const spawned = []
for (const name of ['spawn', 'spawnSync', 'exec', 'execFile', 'execFileSync', 'execSync', 'fork']) {
  const original = childProcess[name]
  if (typeof original !== 'function') continue
  const recorded = function (...args) {
    spawned.push(Array.isArray(args[0]) ? args[0].join(' ') : String(args[0]))
    return original.apply(this, args)
  }
  // A plain wrapper drops `util.promisify.custom`, and `promisify(execFile)`
  // then resolves to a different shape for anything else in this process. Note
  // the flip side: a promisified call delegates to the original and so bypasses
  // this recorder — the plugin reaches the machine only through `spawn`.
  if (original[util.promisify.custom] !== undefined) recorded[util.promisify.custom] = original[util.promisify.custom]
  childProcess[name] = recorded
}

const plugin = await import('../lib/index.js')

const ctx = new Context()

// ToolRuntime injects `systemPrompt` and mounts its schema provider into it, so
// the stand-in must accept `tools(provider)` and `section(...)` and be able to
// render. It records what the registry publishes, which is also how this
// harness reads the registered names back.
const published = { schemaProviders: [], sections: [] }
ctx.provide('systemPrompt', {
  tools(provider) {
    published.schemaProviders.push(provider)
    return () => {}
  },
  section(section) {
    published.sections.push(section)
    return () => {}
  },
  async render() {
    return ''
  },
})

const runtimeFiber = ctx.plugin(ToolRuntime, { mode: 'native' })
await runtimeFiber
check('the real ToolRuntime mounted', ctx.get('tools') !== undefined)

// `ctx.plugin` re-validates against Config, so hand it the RAW config (a
// pre-parsed volatile object would fail validation).
const pluginFiber = ctx.plugin(plugin, {})
await pluginFiber

// The load is the whole point: DSH runs this at application boot, so anything
// started here is started on every launch.
check('mounting the plugin starts no subprocess', spawned.length === 0, spawned)

const tools = ctx.get('tools')
/** Ask the registry which tool names it publishes, through the real provider path. */
const toolNames = () =>
  published.schemaProviders
    .flatMap((provider) => provider({ scope: undefined })?.schemas ?? [])
    .map((schema) => schema.name)
const visible = toolNames().filter((name) => name.startsWith('ios_'))
check('21 ios_* tools are registered in the real registry', visible.length === 21, visible.length)

// ── dispatch through the real registry ───────────────────────────────────────
// A caller signal is part of the execution contract; the loop always supplies one.
const signal = new AbortController().signal

// The registry validates each body's value against its declared result schema,
// which is how a mismatch between a provider's shape and a tool's schema is
// caught. `ios_discover_project` answers from the filesystem alone; off macOS
// `ios_preflight` refuses before it probes anything, so it is free there and
// spawns six commands on macOS — which is why it is not in the macOS list.
const alwaysRunnable =
  process.platform === 'darwin' ? ['ios_discover_project'] : ['ios_preflight', 'ios_discover_project']

for (const name of alwaysRunnable) {
  const result = await tools.execute({ name, arguments: {}, callId: `verify-${name}`, signal })
  check(`${name} dispatched through the real registry`, result.isError !== true, result.error?.message?.slice(0, 90))
  const payload = result.content?.find((block) => block.type === 'text')?.text ?? ''
  check(`${name} rendered model-visible JSON`, payload.trimStart().startsWith('{'), payload.slice(0, 60))
}

// Off macOS the plugin must refuse in words, not crash: the gate is the port's
// whole reason for centralising the platform check. The refusal is the host
// check, so it happens before any probe.
if (process.platform !== 'darwin') {
  const refused = await tools.execute({ name: 'ios_list_simulators', arguments: {}, callId: 'verify-refused', signal })
  check('a simulator tool refuses off macOS', refused.isError === true, refused.error?.message?.slice(0, 120))
  check('the refusal names macOS', /only supports macOS/.test(refused.error?.message ?? ''))
}

// ── opt-in: the same tools against the real machine ──────────────────────────
// These are the two that reach Apple's tooling, and reaching it is the whole
// reason they are not in the list above. `pnpm run smoke` is the fuller version
// of this; the flag exists so the real dispatch can still be exercised here.
if (withSimulator && process.platform === 'darwin') {
  for (const name of ['ios_preflight', 'ios_list_simulators']) {
    const result = await tools.execute({ name, arguments: {}, callId: `verify-real-${name}`, signal })
    check(`${name} dispatched against the real machine`, result.isError !== true, result.error?.message?.slice(0, 90))
    const payload = result.content?.find((block) => block.type === 'text')?.text ?? ''
    check(`${name} rendered model-visible JSON`, payload.trimStart().startsWith('{'), payload.slice(0, 60))
  }
} else if (withSimulator) {
  console.log(`note: --with-simulator is macOS-only; this host is ${process.platform}`)
}

// Argument validation is the registry's, not ours: a wrong type must be refused
// before the body runs.
const badArgs = await tools.execute({
  name: 'ios_ui_tap',
  arguments: { x: 'not-a-number', y: 1 },
  callId: 'verify-badargs',
  signal,
})
check('a malformed argument is refused by the registry', badArgs.isError === true, badArgs.error?.message?.slice(0, 80))

// A name the plugin never registered must not resolve.
const unknown = await tools.execute({ name: 'ios_not_a_tool', arguments: {}, callId: 'verify-unknown', signal })
check('an unknown tool name does not resolve', unknown.isError === true, unknown.error?.code)

// ── the settings namespace the browser half waits for ────────────────────────
const schema = plugin.Config.toJSON()
const root = schema.refs[schema.uid]
const volatileFields = Object.values(root.dict).filter((ref) => schema.refs[ref].meta.volatile === true)
check('every settings field is volatile (so the settings form can serve it)', volatileFields.length === 17, volatileFields.length)

// ── disposal removes the tools again ─────────────────────────────────────────
await pluginFiber.dispose()
const afterDispose = toolNames().filter((name) => name.startsWith('ios_'))
check('disposing the plugin fiber unregisters every tool', afterDispose.length === 0, afterDispose.length)

await runtimeFiber.dispose()

// ── the whole hermetic run stayed off Apple's tooling ────────────────────────
if (withSimulator) {
  // The caller asked for the real-machine path; a spawn here is the point.
  console.log(`note: --with-simulator was requested; ${spawned.length} command(s) ran against the real machine`)
} else {
  const apple = spawned.filter((command) => APPLE_TOOLS.some((tool) => command.includes(tool)))
  check('the hermetic run never reaches Apple tooling', apple.length === 0, apple)
  if (process.platform === 'darwin' && apple.length === 0) {
    console.log('note: the simulator probes were skipped; `pnpm run smoke` or `--with-simulator` runs them')
  }
}

console.log(failures === 0 ? '\nverify-mount: OK' : `\nverify-mount: ${failures} failure(s)`)
assert.ok(true)
process.exit(failures === 0 ? 0 : 1)
