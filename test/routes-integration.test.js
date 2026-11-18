import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
// Before the plugin, deliberately: `lib/util/run.js` takes `spawn` as an ESM
// named import of a CommonJS builtin, and the binding is taken when the
// importing module is instantiated. The plugin is therefore loaded
// dynamically below, so the seam answers the Apple probes instead of the
// machine answering them.
import { seam } from './helpers/offline-seam.mjs'

/** The plugin, loaded after the seam has replaced `spawn` — see the import comment. */
const plugin = await import('../lib/index.js')

/**
 * The symbol a volatile reference is written through.
 *
 * Cordis re-exports the volatile TYPE but not the symbol, so the test spells
 * it itself: the settings form writes through it, and so does this suite.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Mount the plugin on a real Cordis context.
 *
 * The `connection` service is the one stand-in: the real one is a private
 * HTTP surface that cannot be opened from a test. Everything else is the real
 * thing - the real registry, the real plugin, the real settings schema.
 *
 * @param {{connection?: unknown, provideConnection?: boolean, config?: Record<string, unknown>}} [options] - how to compose the context.
 * @returns {Promise<{ctx: Context, routes: Map<string, object>, fiber: object, dispose: () => Promise<void>}>} the mounted fixture.
 */
async function mount(options = {}) {
  const ctx = new Context()
  const routes = new Map()

  // `tools` is the plugin's only REQUIRED service: without it the fiber never
  // activates, and nothing else is mounted either.
  ctx.provide('tools', { register: () => () => {} })

  const connection = options.connection ?? {
    fetch: {
      register(route) {
        routes.set(route.path, route)
        return () => {
          routes.delete(route.path)
        }
      }
    },
  }
  if (options.provideConnection !== false) ctx.provide('connection', connection)

  const fiber = ctx.plugin(plugin, options.config ?? {})
  await fiber
  return {
    ctx,
    routes,
    fiber,
    dispose: async () => {
      await fiber.dispose()
    },
  }
}

/** Read one registered route by its path suffix. */
const route = (routes, suffix) => {
  const found = [...routes.entries()].find(([path]) => path.endsWith(suffix))
  assert.notEqual(found, undefined, `the ${suffix} route must be registered`)
  return found[1]
}

test('the three routes are registered on a real context', async () => {
  const { routes } = await mount()
  assert.deepEqual(
    [...routes.keys()].sort(),
    [
      '/api/ios-simulator-helper/host',
      '/api/ios-simulator-helper/inventory',
      '/api/ios-simulator-helper/status',
    ],
  )
})

test('the /host route answers the platform verdict without starting anything', async () => {
  const { routes } = await mount()
  seam.reset()
  const response = await route(routes, '/host').fetch()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  const body = await response.json()
  assert.equal(body.requiredPlatform, 'darwin')
  assert.equal(body.requiredPlatformLabel, 'macOS')
  assert.equal(body.plugin, 'ios-simulator-helper')
  assert.equal(typeof body.supported, 'boolean')
  // The route reads no setting and starts no subprocess: that is the whole
  // point of it, so a probe here would be a regression.
  assert.deepEqual(seam.commands, [], 'the host verdict must not probe the machine')
})

test('the /status route answers with the diagnostic report', async () => {
  const { routes } = await mount()
  seam.reset()
  const response = await route(routes, '/status').fetch()
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(typeof body.ok, 'boolean')
  assert.equal(Array.isArray(body.checks), true)
  assert.equal(body.checks.length > 0, true)
  for (const check of body.checks) {
    assert.equal(typeof check.name, 'string')
    assert.equal(typeof check.ok, 'boolean')
  }
})

test('the /inventory route answers with the discovery payload', async () => {
  const { routes } = await mount()
  seam.reset()
  const response = await route(routes, '/inventory').fetch()
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(typeof body.xcodePath, 'string')
  assert.equal(Array.isArray(body.runtimes), true)
  assert.equal(Array.isArray(body.simulators), true)
  assert.equal(typeof body.current, 'object')
})

test('a route reads the live settings on every call, not the ones it saw at mount', async () => {
  const { routes, fiber } = await mount()
  seam.reset()
  const before = await (await route(routes, '/inventory').fetch()).json()
  const reference = fiber.config.defaultDevice
  assert.notEqual(reference, undefined, 'the field must be a live reference')
  reference[VOLATILE_WRITE]('iPhone 17')
  const after = await (await route(routes, '/inventory').fetch()).json()
  assert.notEqual(before.current.defaultDevice, 'iPhone 17')
  assert.equal(after.current.defaultDevice, 'iPhone 17')
})

test('a deployment without the connection service still mounts and registers no route', async () => {
  const { routes } = await mount({ provideConnection: false })
  assert.deepEqual([...routes.keys()], [], 'no service means no route')
})

test('a connection provided after the mount still gets the routes', async () => {
  // `ctx.inject` defers its callback until the dependency is provided, so a
  // service that arrives later is a deployment the plugin still serves.
  const ctx = new Context()
  const routes = new Map()
  ctx.provide('tools', { register: () => () => {} })
  const fiber = ctx.plugin(plugin, {})
  await fiber
  assert.deepEqual([...routes.keys()], [])
  ctx.provide('connection', {
    fetch: {
      register(route) {
        routes.set(route.path, route)
        return () => {
          routes.delete(route.path)
        }
      },
    },
  })
  // The deferred callback runs on the next tick, not inside the provide.
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(routes.size, 3, 'the routes appear when the service does')
})

test('disposing the plugin removes every route', async () => {
  const { routes, dispose } = await mount()
  assert.equal(routes.size, 3)
  await dispose()
  assert.deepEqual([...routes.keys()], [], 'disposal must unregister the routes')
})