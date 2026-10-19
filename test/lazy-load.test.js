import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

/**
 * Loading the plugin must start nothing.
 *
 * DSH mounts every profile bundle at application boot, so a subprocess started
 * from `apply()` is started on every DSH launch — whether or not the user ever
 * touches an iOS tool. Enumerating simulator runtimes and devices is a tool
 * call's work, not a mount's: reaching `xcodebuild`, `xcrun simctl` or `idb`
 * from here would also start CoreSimulatorService and hold host resources for a
 * feature nobody asked for yet.
 *
 * The `child_process` patch has to land before `lib/index.js` is evaluated.
 * `lib/util/run.js` takes `spawn` as an ESM named import of a CommonJS builtin,
 * and that binding snapshots the property at module evaluation, so patching
 * after the import would be ignored.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/test/lazy-load
 */

const require = createRequire(import.meta.url)
const childProcess = require('node:child_process')
const util = require('node:util')

/** Every child-process entry point `lib/util/run.js` could reach. */
const SPAWN_POINTS = ['spawn', 'spawnSync', 'exec', 'execFile', 'execFileSync', 'execSync', 'fork']

/** What the patched entry points recorded, in call order. */
const spawned = []

for (const name of SPAWN_POINTS) {
  const original = childProcess[name]
  if (typeof original !== 'function') continue
  const recorded = function (...args) {
    spawned.push(`${name}: ${Array.isArray(args[0]) ? args[0].join(' ') : String(args[0])}`)
    return original.apply(this, args)
  }
  // A plain wrapper drops `util.promisify.custom`, and `promisify(execFile)`
  // then resolves to a different shape for anything else in this process.
  if (original[util.promisify.custom] !== undefined) recorded[util.promisify.custom] = original[util.promisify.custom]
  childProcess[name] = recorded
}

// Imported after the patch, deliberately — see the module comment above.
const plugin = await import('../lib/index.js')

/**
 * A context stand-in carrying every optional service, which is what the plugin
 * sees in a real deployment: the `skills`, `commands`, `connection` and
 * `settings` callbacks all run at mount, so a spawn hidden in any of them is
 * caught here. The full registration contract lives in `test/host.test.js`.
 */
function fullContext() {
  const registered = { tools: [], skills: [], commands: [], routes: [] }
  const stores = {
    tools: { register: (definition) => (registered.tools.push(definition), () => {}) },
    skills: { register: (definition) => (registered.skills.push(definition), () => {}) },
    commands: { register: (definition) => (registered.commands.push(definition), () => {}) },
    connection: { fetch: { register: (route) => (registered.routes.push(route), () => {}) } },
    settings: { configure: () => () => {} },
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    fiber: { id: 'lazy-load-fiber' },
    get: (name) => stores[name],
    // `registerTools` reaches `ctx.tools.register` directly, so the services are
    // properties of the context as well as `inject` targets.
    inject: (names, callback) =>
      names.every((name) => name in stores)
        ? callback({ ...ctx, ...Object.fromEntries(names.map((name) => [name, stores[name]])) })
        : undefined,
    effect: (callback) => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
  }
  for (const name of Object.keys(stores)) ctx[name] = stores[name]
  return { ctx, registered }
}

test('importing the host half starts no subprocess', () => {
  assert.deepEqual(spawned, [], 'the module graph must not spawn while it is evaluated')
})

test('mounting the host half with every service starts no subprocess', () => {
  const { ctx, registered } = fullContext()
  plugin.apply(ctx, {})

  // A vacuous pass would hide a mount that quietly stopped registering things,
  // so the registration itself is pinned alongside the absence of spawns.
  assert.equal(registered.tools.length, 21, 'every tool is registered at mount')
  assert.equal(registered.skills.length, 1, 'the bundled skill is registered at mount')
  assert.equal(registered.commands.length, 1, 'the /ios-dev command is registered at mount')
  assert.equal(registered.routes.length, 3, 'the three Fetch routes are registered at mount')

  assert.deepEqual(spawned, [], 'mounting must not reach xcodebuild, simctl or idb')
})
