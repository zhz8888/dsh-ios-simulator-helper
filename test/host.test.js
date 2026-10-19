import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
// Before the plugin, deliberately. `lib/util/run.js` takes `spawn` as an ESM
// named import of a CommonJS builtin, and the binding is taken when the
// importing module is instantiated — so a static import of the plugin would be
// linked, and the real `spawn` captured, before this file's body ran. The
// plugin is therefore loaded dynamically below. Three cases here reach real
// providers, which on a Mac reaches `xcodebuild`, `simctl` and `idb`; see the
// helper's header.
import { seam } from './helpers/offline-seam.mjs'
import { FIELD_KEYS, SETTINGS_NAMESPACE } from '../lib/settings.js'

/**
 * Host-half tests against a hand-written Cordis context.
 *
 * The real registry is exercised separately by `scripts/verify-mount.mjs`; this
 * suite pins what the plugin itself contributes — the tool surface, the skill,
 * the command, the three Fetch routes and the settings policy — and that a
 * deployment missing any optional service still mounts the rest.
 *
 * Apple's command-line tools are answered by `test/helpers/offline-seam.mjs`,
 * so no case here can start the simulator stack or need Xcode installed.
 */

/** The plugin, loaded after the seam has replaced `spawn` — see the import comment. */
const plugin = await import('../lib/index.js')
const { renderCommandReport } = plugin

/** Tool names as the original ZCode plugin published them, plus this plugin's addition. */
const ORIGINAL_TOOLS = [
  'ios_preflight',
  'ios_list_simulators',
  'ios_boot_simulator',
  'ios_show_simulator',
  'ios_discover_project',
  'ios_create_app',
  'ios_build_app',
  'ios_build_and_run',
  'ios_install_app',
  'ios_launch_app',
  'ios_terminate_app',
  'ios_open_url',
  'ios_screenshot',
  'ios_logs',
  'ios_ui_status',
  'ios_ui_tap',
  'ios_ui_swipe',
  'ios_ui_type_text',
  'ios_ui_button',
  'ios_ui_describe',
]

/** The one tool this plugin adds to the original set. */
const ADDED_TOOLS = ['ios_shutdown_simulator']

/** A Cordis context stand-in that records everything the plugin registers. */
function fakeContext(services = ['tools', 'skills', 'commands', 'connection', 'settings'], overrides = {}) {
  const registered = { tools: [], disposers: [], skills: [], commands: [], routes: [], settingsPolicy: [] }
  const stores = {
    tools: {
      register: (definition) => {
        registered.tools.push(definition)
        const disposer = () => {}
        registered.disposers.push(disposer)
        return disposer
      },
    },
    skills: { register: (definition) => (registered.skills.push(definition), () => {}) },
    commands: { register: (definition) => (registered.commands.push(definition), () => {}) },
    connection: {
      fetch: {
        register: (route) => {
          registered.routes.push(route)
          return () => {}
        },
      },
    },
    settings: { configure: (policy, fiber) => (registered.settingsPolicy.push({ policy, fiber }), () => {}) },
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    fiber: { id: 'test-fiber' },
    get: (name) => stores[name],
    // `inject` resolves only the services this composition provides: that is
    // what makes a deployment missing one of them still mount the rest.
    inject: (names, callback) => {
      if (!names.every((name) => services.includes(name))) return undefined
      return callback({ ...ctx, ...Object.fromEntries(names.map((name) => [name, stores[name]])) })
    },
    effect: (callback) => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
  }
  for (const name of services) ctx[name] = stores[name]
  Object.assign(ctx, overrides)
  return { ctx, registered, services }
}

/** Mount the plugin on a fresh stand-in. */
function mount(services) {
  const fake = fakeContext(services)
  plugin.apply(fake.ctx, {})
  return fake
}

test('the plugin declares the tools service and the settings namespace', () => {
  assert.equal(plugin.name, 'ios-simulator-helper')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(SETTINGS_NAMESPACE, 'ios-simulator-helper')
  assert.equal(plugin.Config !== undefined, true)
})

test('every original tool is registered under its original name, plus shutdown', () => {
  const { registered } = mount()
  const names = registered.tools.map((tool) => tool.name)
  for (const name of [...ORIGINAL_TOOLS, ...ADDED_TOOLS]) {
    assert.ok(names.includes(name), `missing tool: ${name}`)
  }
  assert.equal(names.length, ORIGINAL_TOOLS.length + ADDED_TOOLS.length)
  // No ZCode MCP prefix leaked into any name.
  assert.ok(names.every((name) => /^ios_[a-z_]+$/.test(name)), `unexpected tool name: ${names.join(', ')}`)
})

test('each tool declares parameters, an output schema, a renderer and an execute', () => {
  const { registered } = mount()
  for (const tool of registered.tools) {
    assert.equal(typeof tool.description, 'string', `${tool.name} description`)
    assert.ok(tool.description.length > 20, `${tool.name} description must be informative`)
    assert.equal(tool.parameters.type, 'object', `${tool.name} parameters must be an object schema`)
    assert.equal(typeof tool.parameters.properties, 'object', `${tool.name} parameter properties`)
    assert.ok(
      tool.parameters.required === undefined || Array.isArray(tool.parameters.required),
      `${tool.name} must declare a required list when it has required arguments`,
    )
    assert.equal(tool.output.schema.type, 'object', `${tool.name} output schema`)
    assert.equal(typeof tool.output.render, 'function', `${tool.name} render`)
    assert.equal(typeof tool.execute, 'function', `${tool.name} execute`)
  }
})

test('the required arguments the original marked as required stay required', () => {
  const { registered } = mount()
  const byName = new Map(registered.tools.map((tool) => [tool.name, tool]))
  for (const [tool, field] of [
    ['ios_create_app', 'name'],
    ['ios_install_app', 'appPath'],
    ['ios_launch_app', 'bundleId'],
    ['ios_terminate_app', 'bundleId'],
    ['ios_open_url', 'url'],
    ['ios_ui_tap', 'x'],
    ['ios_ui_swipe', 'x1'],
    ['ios_ui_type_text', 'text'],
    ['ios_ui_button', 'button'],
  ]) {
    assert.ok(byName.get(tool).parameters.required?.includes(field), `${tool}.${field} must be required`)
  }
  // Optional arguments must stay optional: these tools declare no required field.
  for (const name of ['ios_preflight', 'ios_boot_simulator', 'ios_list_simulators', 'ios_ui_describe']) {
    assert.deepEqual(byName.get(name).parameters.required ?? [], [], `${name} must require nothing`)
  }
})

test('the shared target arguments are present on every device-targeted tool', () => {
  const { registered } = mount()
  const byName = new Map(registered.tools.map((tool) => [tool.name, tool]))
  for (const name of ['ios_boot_simulator', 'ios_build_and_run', 'ios_screenshot', 'ios_logs', 'ios_ui_describe']) {
    for (const field of ['udid', 'device', 'runtime']) {
      assert.ok(byName.get(name).parameters.properties[field] !== undefined, `${name}.${field} missing`)
    }
  }
  // ios_preflight and ios_list_simulators take no target at all.
  assert.deepEqual(byName.get('ios_preflight').parameters.properties, {})
  assert.deepEqual(byName.get('ios_list_simulators').parameters.properties, {})
})

test('ios_ui_button keeps the original button enum', () => {
  const { registered } = mount()
  const button = registered.tools.find((tool) => tool.name === 'ios_ui_button').parameters.properties.button
  assert.deepEqual(button.enum, ['APPLE_PAY', 'HOME', 'LOCK', 'SIDE_BUTTON', 'SIRI'])
})

test('ios_screenshot renders an image block only when one was admitted', () => {
  const { registered } = mount()
  const screenshot = registered.tools.find((tool) => tool.name === 'ios_screenshot')
  const textOnly = screenshot.output.render({}, { path: 'shot.png', bytes: 12 })
  assert.equal(textOnly.length, 1)
  assert.equal(textOnly[0].type, 'text')
  const withImage = screenshot.output.render({}, { path: 'shot.png', bytes: 12, attachment: { id: 'a' } })
  assert.equal(withImage.length, 2)
  assert.equal(withImage[1].type, 'image')
  assert.deepEqual(withImage[1].attachment, { id: 'a' })
})

test('the bundled skill is registered with its body and resource directory', () => {
  const { registered } = mount()
  assert.equal(registered.skills.length, 1)
  const skill = registered.skills[0]
  assert.equal(skill.name, 'ios-dev')
  assert.match(skill.description, /iOS Simulator/)
  assert.match(skill.content, /ios_preflight/)
  assert.equal(skill.resourceBase.kind, 'directory')
  assert.match(skill.resourceBase.path, /skills[/\\]ios-dev$/)
})

test('the /ios-dev command runs the diagnostic and reports a verdict', async () => {
  const { registered } = mount()
  assert.equal(registered.commands.length, 1)
  const command = registered.commands[0]
  assert.equal(command.name, 'ios-dev')
  const result = await command.handler({ rawInput: 'build and screenshot the app' })
  assert.ok(['success', 'error'].includes(result.kind), `unexpected kind: ${result.kind}`)
  assert.match(result.text, /iOS Simulator environment/)
  assert.match(result.text, /Settings -> iOS Simulator page/)
})

test('the command report names the macOS requirement on an unsupported host', () => {
  const text = renderCommandReport(
    {
      ok: false,
      supported: false,
      platform: 'linux',
      requiredPlatformLabel: 'macOS',
      note: 'Host is Linux (linux/x64). macOS is required.',
      checks: [{ name: 'Host OS (macOS)', ok: false, detail: 'unsupported host "linux/x64"', fix: 'Use a Mac.' }],
      settings: {},
    },
    '',
  )
  assert.match(text, /unsupported host \(linux\)/)
  assert.match(text, /only supports macOS/)
  assert.match(text, /\[FAIL\] Host OS \(macOS\)/)
  assert.match(text, /No ios_\* tool can work on this host/)
})

test('the command report marks a healthy macOS host ready', () => {
  const text = renderCommandReport(
    {
      ok: true,
      supported: true,
      platform: 'darwin',
      requiredPlatformLabel: 'macOS',
      checks: [{ name: 'Host OS (macOS)', ok: true, detail: 'macOS detected (darwin/arm64)' }],
      settings: {},
    },
    'run the app',
  )
  assert.match(text, /ready/)
  assert.match(text, /^\[ok\] +Host OS \(macOS\)$/m)
  assert.match(text, /ask the agent to run the app/)
})

test('the three settings routes are registered as exact GET routes', () => {
  const { registered } = mount()
  assert.deepEqual(
    registered.routes.map((route) => route.path).sort(),
    [
      '/api/ios-simulator-helper/host',
      '/api/ios-simulator-helper/inventory',
      '/api/ios-simulator-helper/status',
    ],
  )
  for (const route of registered.routes) {
    assert.deepEqual(route.methods, ['GET'])
    assert.equal(route.requestBody, 'buffered')
    assert.equal(typeof route.fetch, 'function')
  }
})

test('the /host route answers the macOS question without spawning anything', async () => {
  const { registered } = mount()
  const route = registered.routes.find((item) => item.path.endsWith('/host'))
  const response = await route.fetch()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  const body = await response.json()
  assert.equal(body.requiredPlatform, 'darwin')
  assert.equal(body.requiredPlatformLabel, 'macOS')
  assert.equal(typeof body.supported, 'boolean')
  assert.equal(body.plugin, 'ios-simulator-helper')
  // This suite runs on the machine the plugin was ported on; if it is not a Mac
  // the flag must be false, never a guess.
  assert.equal(body.supported, process.platform === 'darwin')
})

test('the plugin asks the settings service not to auto-generate a second form', () => {
  const { registered } = mount()
  assert.equal(registered.settingsPolicy.length, 1)
  assert.deepEqual(registered.settingsPolicy[0].policy, { auto: false })
  assert.deepEqual(registered.settingsPolicy[0].fiber, { id: 'test-fiber' })
})

test('the plugin mounts when optional services are absent', () => {
  const { registered } = mount(['tools'])
  assert.equal(registered.tools.length, 21, 'tools still register without connection/skills/commands/settings')
  assert.deepEqual(registered.routes, [])
  assert.deepEqual(registered.skills, [])
  assert.deepEqual(registered.commands, [])
  assert.deepEqual(registered.settingsPolicy, [])
})

test('a deployment without a Fetch registry is warned about, not crashed on', () => {
  const warnings = []
  const { ctx } = fakeContext(['tools', 'skills', 'commands'])
  ctx.connection = { fetch: {} }
  ctx.inject = (names, callback) => {
    const child = { ...ctx }
    return callback(child)
  }
  ctx.logger = { info() {}, warn: (message) => warnings.push(message), error() {} }
  assert.doesNotThrow(() => plugin.apply(ctx, {}))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /no exact Fetch route registry/)
})

test('the tool bodies run against the session workspace from the exec record', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ios-helper-host-'))
  try {
    const { registered } = mount()
    const discover = registered.tools.find((tool) => tool.name === 'ios_discover_project')
    const exec = { agent: { session: { header: { cwd: dir } } }, signal: undefined }
    const value = await discover.execute({}, exec)
    assert.deepEqual(value.projects, [])
    assert.deepEqual(value.workspaces, [])
    assert.deepEqual(value.schemes, [])
    assert.deepEqual(value.bundleIds, [])
    const rendered = discover.output.render({}, value)
    assert.equal(rendered.length, 1)
    assert.match(rendered[0].text, /"projects": \[\]/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a path escaping the session workspace is refused by the tool body', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ios-helper-esc-'))
  try {
    const { registered } = mount()
    const install = registered.tools.find((tool) => tool.name === 'ios_install_app')
    const exec = { agent: { session: { header: { cwd: dir } } }, signal: undefined }
    await assert.rejects(
      () => install.execute({ appPath: '../../evil.app' }, exec),
      /escapes the session workspace/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('settings namespace fields reach the tool layer through the live config', async () => {
  const { registered } = mount()
  const status = registered.tools.find((tool) => tool.name === 'ios_ui_status')
  const value = await status.execute({}, { signal: undefined })
  assert.equal(typeof value.available, 'boolean')
  assert.ok(FIELD_KEYS.includes('uiBackend'))
  assert.ok(['auto', 'idb', 'xcodebuildmcp', 'none'].includes(value.setting), `unexpected setting: ${value.setting}`)
})

/**
 * The seam answers Apple-tool probes from a table, so a case that tries to
 * boot, install on or shut down a simulator is visible here — instead of
 * quietly doing it on the developer's Mac, which is what it did before the seam
 * existed. Asserted last, which only holds while this file keeps `node:test`'s
 * default in-order, non-concurrent execution.
 */
test('the suite changes no simulator state and reaches no unstubbed command', () => {
  assert.deepEqual(seam.mutating, [], 'a unit test tried to change simulator state')
  assert.deepEqual(seam.unknown, [], 'an unstubbed command was reached; add it to test/helpers/offline-seam.mjs or stop reaching the machine')
})
