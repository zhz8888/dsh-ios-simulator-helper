import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
// Before the plugin, deliberately — see the helper's header. `lib/util/run.js`
// links `spawn` when it is instantiated, so the seam has to be in place before
// the plugin is imported, and the plugin is therefore loaded dynamically below.
import { seam } from './helpers/offline-seam.mjs'

/**
 * Reporting and result-shape tests for the ported providers.
 *
 * `test/providers.test.js` covers the pure functions and cannot use the offline
 * seam, because it imports the provider modules statically. Everything here
 * needs at least one command answered — the device inventory, the preflight
 * report, the log window, the create/build/scheme paths, the UI payload — so
 * this file imports the seam first and loads the plugin's modules afterwards.
 *
 * The other half is the result-schema contract: every tool result is compared
 * with the output schema that declares it, field by field, for all 21 tools
 * rather than for one of them and in one direction only.
 */

/**
 * The seam's `spawn`, saved before this file wraps it.
 *
 * The seam answers stdout only. Two cases below need a stderr transcript as
 * well: they pin that a structured payload and a diagnostic stay in separate
 * fields. The wrapper attaches stderr to the canned child the seam returned,
 * and nothing else is touched — the seam still answers every command and still
 * records it.
 */
const childProcess = createRequire(import.meta.url)('node:child_process')
const seamSpawn = childProcess.spawn
/** The command-line fragment that gets extra stderr, and the text it gets. */
const injectedStderr = { match: /** @type {string | undefined} */ (undefined), text: '' }
childProcess.spawn = (command, args = [], options = {}) => {
  const child = seamSpawn(command, args, options)
  if (injectedStderr.match !== undefined && [command, ...args].join(' ').includes(injectedStderr.match)) {
    child.stderr = Readable.from([injectedStderr.text])
  }
  return child
}

/** The plugin, loaded after the seam has replaced `spawn`. */
const plugin = await import('../lib/index.js')

/** A logger that reports nothing: the providers warn about some failures by design. */
const logger = { info() {}, warn() {}, error() {} }

/**
 * A Cordis context stand-in that records everything the plugin registers.
 *
 * The same shape `test/host.test.js` uses, including the `get()` service
 * lookup: the tool bodies reach the attachment service through it, and a
 * deployment without one is what the screenshot case exercises here.
 *
 * @param {string[]} [services] - the services this composition provides.
 * @returns {{ctx: any, registered: {tools: any[]}, services: string[]}} the stand-in.
 */
function fakeContext(services = ['tools']) {
  /** @type {{tools: any[]}} */
  const registered = { tools: [] }
  const stores = {
    tools: {
      register: (definition) => {
        registered.tools.push(definition)
        return () => {}
      },
    },
  }
  const ctx = {
    logger,
    fiber: { id: 'test-fiber' },
    get: (name) => stores[name],
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
  return { ctx, registered, services }
}

/**
 * A runtime for one provider call, rooted in a temp workspace.
 *
 * `env` is empty and `platform` is `darwin` on purpose: a real `IOS_SIM_*` or
 * `DSH_HOME` in the caller's environment must not change what the check reads,
 * and the Apple-tooling branches must be reachable on any developer machine.
 *
 * @param {string} root - the temp workspace.
 * @param {{config?: Record<string, unknown>}} [overrides] - extra live config.
 * @returns {Promise<any>} the runtime.
 */
async function runtimeFor(root, overrides = {}) {
  const { createRuntime } = await import('../lib/runtime.js')
  return createRuntime({
    config: { dataDir: path.join(root, 'data'), ...(overrides.config ?? {}) },
    exec: { agent: { session: { header: { cwd: root } } } },
    logger,
    env: {},
    platform: 'darwin',
  })
}

/**
 * Create a temp workspace, mount the tools on a stand-in and build the exec record.
 *
 * @returns {Promise<{root: string, tools: Map<string, any>, exec: any}>} the mounted surface.
 */
async function mountedWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-reporting-'))
  const fake = fakeContext(['tools'])
  plugin.apply(fake.ctx, { dataDir: path.join(root, 'data') })
  return {
    root,
    tools: new Map(fake.registered.tools.map((tool) => [tool.name, tool])),
    exec: { agent: { session: { header: { cwd: root } } }, signal: undefined },
  }
}

/**
 * Run one tool body against a temp workspace and return its result.
 *
 * @param {Map<string, any>} tools - the registered tools by name.
 * @param {string} name - the tool to dispatch.
 * @param {Record<string, unknown>} args - its arguments.
 * @param {any} exec - the execution record.
 * @returns {Promise<Record<string, unknown>>} the projected result value.
 */
async function call(tools, name, args, exec) {
  const tool = tools.get(name)
  assert.ok(tool !== undefined, `${name} is not registered`)
  return tool.execute(args, exec)
}

/** Every tool the plugin registers, as `test/host.test.js` names them. */
const ALL_TOOLS = [
  'ios_boot_simulator',
  'ios_build_and_run',
  'ios_build_app',
  'ios_create_app',
  'ios_discover_project',
  'ios_install_app',
  'ios_launch_app',
  'ios_list_simulators',
  'ios_logs',
  'ios_open_url',
  'ios_preflight',
  'ios_screenshot',
  'ios_shutdown_simulator',
  'ios_show_simulator',
  'ios_terminate_app',
  'ios_ui_button',
  'ios_ui_describe',
  'ios_ui_status',
  'ios_ui_swipe',
  'ios_ui_tap',
  'ios_ui_type_text',
]

test('one inventory call enumerates the device list once and derives the default target from it', async () => {
  // The inventory used to run `simctl list devices --json` twice — once for the
  // list, once inside `pick`. Two snapshots can disagree: a device that boots
  // between them yields a `defaultTarget` that is not in the `simulators` list
  // the page renders next to it.
  seam.reset()
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-inventory-'))
  try {
    const { inventory } = await import('../lib/providers/preflight.js')
    const rt = await runtimeFor(root)
    const before = seam.calls.length
    const report = await inventory(rt)
    const listed = seam.calls.slice(before).filter((item) => item.line === 'xcrun simctl list devices --json')
    assert.equal(listed.length, 1, 'the device list must be enumerated exactly once per inventory')
    assert.equal(report.simulators.length, 1)
    assert.equal(report.simulators[0]?.name, 'iPhone Duo')
    // The target comes from that same answer, not from a second enumeration.
    assert.equal(report.defaultTarget?.name, 'iPhone Duo')
    assert.equal(report.defaultTarget?.udid, report.simulators[0]?.udid)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unreadable device payload is reported rather than read as "none known"', async () => {
  // `simctl list devices --json` answering `null` is not an empty machine: it
  // is a probe that could not be read. Saying "0 known" sends the user to
  // install a runtime they already have.
  seam.reset()
  seam.devices = 'null'
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-null-devices-'))
  try {
    const { inventory, preflight } = await import('../lib/providers/preflight.js')
    const rt = await runtimeFor(root)
    const report = await preflight(rt)
    const check = report.checks.find((item) => item.name === 'simulator devices')
    assert.equal(check?.ok, false)
    assert.match(String(check?.detail), /could not parse/)
    assert.match(String(check?.detail), /got null/)
    assert.doesNotMatch(String(check?.detail), /0 known/)

    const listed = await inventory(rt)
    assert.deepEqual(listed.simulators, [])
    assert.match(String(listed.simulatorsError), /got null/)
    assert.equal(listed.defaultTarget, null)
    // The list error is the target error too: choosing from a list that could
    // not be read would only repeat the failure in a less specific message.
    assert.match(String(listed.defaultTargetError), /got null/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unreadable runtime payload is reported rather than read as "none usable"', async () => {
  seam.reset()
  seam.runtimes = 'null'
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-null-runtimes-'))
  try {
    const { inventory, preflight } = await import('../lib/providers/preflight.js')
    const rt = await runtimeFor(root)
    const report = await preflight(rt)
    const check = report.checks.find((item) => item.name === 'simulator runtimes')
    assert.equal(check?.ok, false)
    assert.match(String(check?.detail), /got null/)
    assert.doesNotMatch(String(check?.detail), /none usable/)

    const listed = await inventory(rt)
    assert.deepEqual(listed.runtimes, [])
    assert.match(String(listed.runtimesError), /got null/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a reserved UI backend does not make a healthy machine fail preflight', async () => {
  // `xcodebuildmcp` is offered in the dropdown and documented as reserved. It
  // is a deliberate setting, not a broken environment: the UI tools are off by
  // design and every other tool keeps working, so the whole diagnostic must
  // stay "ready".
  seam.reset()
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-reserved-backend-'))
  try {
    const { preflight } = await import('../lib/providers/preflight.js')
    const rt = await runtimeFor(root, { config: { uiBackend: 'xcodebuildmcp' } })
    const report = await preflight(rt)
    const check = report.checks.find((item) => item.name === 'ui backend')
    assert.equal(check?.ok, true, 'a deliberately reserved backend is not a failed check')
    assert.match(String(check?.detail), /xcodebuildmcp/)
    assert.equal(report.ok, true, 'nothing else is wrong with this machine')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the log timeout follows the log window, and the result reports it', async () => {
  // A 30-minute window killed at the 60 s floor fails as a timeout instead of
  // returning the log it asked for; the result names the bound that was used.
  seam.reset()
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-log-timeout-'))
  try {
    const { logTimeoutMs, logs } = await import('../lib/providers/logs.js')
    assert.equal(logTimeoutMs(60), 60_000)
    assert.equal(logTimeoutMs(3600), 3_600_000)
    const rt = await runtimeFor(root)
    const long = await logs(rt, { seconds: 3600 })
    assert.equal(long.seconds, 3600)
    assert.equal(long.timeoutMs, 3_600_000)
    const short = await logs(rt, { seconds: 60 })
    assert.equal(short.timeoutMs, 60_000)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed scheme listing is reported instead of reading as "no schemes"', async () => {
  // A license problem, a damaged project or a timeout is not "this project has
  // no scheme": the discovery report has to carry the reason, because the build
  // path must refuse rather than guess a scheme from the file name.
  seam.reset()
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-schemes-error-'))
  try {
    const { create, discover } = await import('../lib/providers/project.js')
    const rt = await runtimeFor(root)
    await create(rt, { name: 'Demo' })
    seam.list = { code: 1, stderr: 'xcodebuild: error: The project "Demo.xcodeproj" is damaged and cannot be opened.\n' }
    const found = await discover(rt)
    assert.deepEqual(found.schemes, [])
    assert.match(String(found.schemesError), /damaged and cannot be opened/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a blank bundle filter reads as no filter and sends no predicate', async () => {
  seam.reset()
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-log-filter-'))
  try {
    const { logs } = await import('../lib/providers/logs.js')
    const rt = await runtimeFor(root)
    const blank = await logs(rt, { bundleId: '   ' })
    assert.equal(blank.bundleId, null, 'an empty identifier is "no filter", not a filter that matched nothing')
    const logLines = seam.calls.filter((item) => item.line.includes(' log show '))
    assert.equal(logLines.length, 1)
    assert.equal(logLines[0]?.argv.includes('--predicate'), false, 'a blank filter must not reach the predicate')

    const named = await logs(rt, { bundleId: 'com.example.demo' })
    assert.equal(named.bundleId, 'com.example.demo')
    const last = seam.calls.filter((item) => item.line.includes(' log show ')).at(-1)
    assert.equal(last?.argv.includes('--predicate'), true, 'a real identifier is a filter')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a create that fails halfway removes the files it already wrote', async () => {
  seam.reset()
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-create-rollback-'))
  try {
    const { create } = await import('../lib/providers/project.js')
    const rt = await runtimeFor(root)
    // A directory where the second generated file must go: the first file has
    // been written by then, and the write of this one can never succeed.
    await mkdir(path.join(root, 'Half', 'Half', 'ContentView.swift'), { recursive: true })
    await assert.rejects(() => create(rt, { name: 'Half', overwrite: true }))
    await assert.rejects(
      () => lstat(path.join(root, 'Half', 'Half', 'HalfApp.swift')),
      'the file written before the failure must be removed with it',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an overwrite replaces a symlinked destination instead of writing through it', async () => {
  seam.reset()
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-create-symlink-'))
  try {
    const { create } = await import('../lib/providers/project.js')
    const rt = await runtimeFor(root)
    await create(rt, { name: 'Link' })
    const outside = path.join(root, 'outside.swift')
    await writeFile(outside, 'sentinel\n', 'utf8')
    const destination = path.join(root, 'Link', 'Link', 'ContentView.swift')
    await rm(destination)
    await symlink(outside, destination)
    await create(rt, { name: 'Link', overwrite: true })
    assert.equal(await readFile(outside, 'utf8'), 'sentinel\n', 'the link target must not be written through')
    const info = await lstat(destination)
    assert.equal(info.isSymbolicLink(), false, 'the rename must replace the directory entry')
    assert.match(await readFile(destination, 'utf8'), /struct ContentView/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('describe answers the raw payload with the facts that say whether it was cut', async () => {
  seam.reset()
  seam.idbInstalled = true
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-describe-'))
  try {
    const { describe } = await import('../lib/providers/ui.js')
    const rt = await runtimeFor(root)
    const long = await describe(rt, {})
    const raw = seam.describeOutput.trim()
    assert.equal(long.truncated, true)
    assert.equal(long.characters, 20_000)
    // The raw stdout, cut at the limit — never a JSON re-encoding of it and
    // never stdout with stderr appended.
    assert.equal(long.output, `${raw.slice(0, 20_000)}\n...[truncated ${raw.length - 20_000} characters]`)
    assert.equal('stderr' in long, false, 'an empty stderr is left out rather than attached to the payload')

    seam.describeOutput = JSON.stringify([{ type: 'Button', label: 'Increment' }])
    seededStderr(undefined, '')
    const short = await describe(rt, {})
    assert.equal(short.truncated, false)
    assert.equal(short.characters, seam.describeOutput.length)
    assert.deepEqual(JSON.parse(short.output), [{ type: 'Button', label: 'Increment' }])

    seededStderr('ui describe-all', 'idb warning: a diagnostic that is not part of the payload\n')
    const noisy = await describe(rt, {})
    assert.equal(noisy.output, seam.describeOutput, 'a diagnostic must not be appended to the document')
    assert.equal(noisy.stderr, 'idb warning: a diagnostic that is not part of the payload')
    assert.equal('stderr' in noisy, true)
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})

/**
 * Make the stderr injection apply to one command-line fragment, or stop it.
 *
 * @param {string | undefined} match - the fragment a command line must contain.
 * @param {string} text - the stderr the canned child answers with.
 */
function seededStderr(match, text) {
  injectedStderr.match = match
  injectedStderr.text = text
}

test('every tool result names only the fields its output schema declares', {
  // The tool bodies drive Apple's tooling, which refuses off macOS; the schema
  // is the same everywhere, but a dispatch here needs the seam's answers.
  skip: process.platform !== 'darwin' ? 'the Apple-tooling tools refuse off macOS' : false,
}, async () => {
  // The result schema is the contract the model reads, and the registry allows
  // any extra key through (`additionalProperties: true`), so a provider field
  // the schema does not name is one the model is never told about. The existing
  // suite compared one tool's keys in one direction only; this dispatches all
  // 21 and compares every key each result actually carries.
  seam.reset()
  seam.allowMutations = true
  seam.buildProduct = true
  seam.idbInstalled = true
  const { root, tools, exec } = await mountedWorkspace()
  try {
    assert.deepEqual([...tools.keys()].sort(), [...ALL_TOOLS].sort(), 'the tool surface changed; update this case')
    const values = new Map()

    const dispatched = async (name, args = {}) => {
      const value = await call(tools, name, args, exec)
      values.set(name, value)
      return value
    }

    await dispatched('ios_preflight')
    await dispatched('ios_list_simulators')
    await dispatched('ios_create_app', { name: 'Demo' })
    await dispatched('ios_discover_project')
    const booted = await dispatched('ios_boot_simulator')
    // A positive control: the seam's device carries a type, so the comparison
    // below really sees the optional `deviceType` field a real `simctl` reports
    // — and a schema that stopped declaring it would fail this case.
    assert.equal(typeof booted.deviceType, 'string', 'the fixture must carry the device type the comparison checks')
    await dispatched('ios_show_simulator')
    await dispatched('ios_shutdown_simulator')
    const built = await dispatched('ios_build_app')
    assert.equal(built.ok, true, 'the seam answers a successful build')
    const appPath = built.appPath
    assert.equal(typeof appPath, 'string', 'a successful build reports the product it made')
    await dispatched('ios_install_app', { appPath })
    await dispatched('ios_launch_app', { bundleId: 'com.example.demo' })
    await dispatched('ios_terminate_app', { bundleId: 'com.example.demo' })
    await dispatched('ios_open_url', { url: 'https://example.com' })
    // A named output path keeps the capture inside the temp workspace; the
    // seam writes the canned PNG the way `simctl` would.
    await dispatched('ios_screenshot', { path: 'shot.png' })
    await dispatched('ios_logs')
    await dispatched('ios_ui_status')
    await dispatched('ios_ui_tap', { x: 10, y: 20 })
    await dispatched('ios_ui_swipe', { x1: 1, y1: 2, x2: 3, y2: 4 })
    await dispatched('ios_ui_type_text', { text: 'hello' })
    await dispatched('ios_ui_button', { button: 'HOME' })
    await dispatched('ios_ui_describe')
    await dispatched('ios_build_and_run')

    assert.deepEqual([...values.keys()].sort(), [...ALL_TOOLS].sort(), 'every tool must be dispatched')
    for (const [name, value] of values) {
      assert.equal(value !== null && typeof value === 'object' && !Array.isArray(value), true, `${name} must answer an object`)
      const tool = tools.get(name)
      const declared = new Set(Object.keys(tool.output.schema.properties ?? {}))
      for (const key of Object.keys(value)) {
        assert.ok(declared.has(key), `${name} returned "${key}", which its output schema does not declare`)
      }
    }
  } finally {
    seam.reset()
    await rm(root, { recursive: true, force: true })
  }
})
