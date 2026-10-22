import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { createRequire } from 'node:module'
import path from 'node:path'

/**
 * Answer the plugin's Apple-tool probes from a table instead of the machine.
 *
 * Several cases in the suite reach real providers: the `/ios-dev` command
 * handler runs `preflight()`, `ios_install_app` resolves a target through
 * `simProvider.boot()`, the build/capture cases run `xcodebuild` and `simctl`,
 * and `ios_ui_status` probes the UI backend. On a Mac those calls start
 * CoreSimulatorService, enumerate simulator runtimes and devices, and — with
 * nothing booted and `autoBootSimulator` on, which is the default — boot a
 * simulator. That is real-machine work: `pnpm test` must never do it, and
 * `scripts/smoke.mjs` is where it is proven. Importing this module before
 * `lib/index.js` is what makes the suite answer those probes offline.
 *
 * Only `spawn` is replaced, because `lib/util/run.js` is the plugin's single
 * external-command path. Nothing falls through to the real `spawn`: a command
 * the table does not know answers 127, so an unexpected probe shows up as a
 * failing check rather than as silent work on the developer's machine.
 *
 * The order matters and cannot be fixed later: `lib/util/run.js` takes `spawn`
 * as an ESM named import of a CommonJS builtin, and that binding snapshots the
 * property at module evaluation. A test file that needs the seam must therefore
 * import it first and load the plugin's modules with `await import(...)`
 * afterwards.
 *
 * A case that needs to observe something other than a plain success edits
 * {@link seam} before the call: `seam.allowMutations` answers the `simctl`
 * verbs that change device state (as a canned success, never on the machine),
 * `seam.devices` / `seam.runtimes` replace the enumerated lists, `seam.list` /
 * `seam.build` change the two `xcodebuild` answers, `seam.idbInstalled` makes
 * the `idb` probe succeed, and `seam.reset()` puts everything back. Every call
 * is recorded in `seam.calls` with the argv and the working directory the
 * plugin asked for, which is how the tests assert that a provider resolved a
 * path against the directory it reported.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/test/helpers/offline-seam
 */

const require = createRequire(import.meta.url)
const childProcess = require('node:child_process')

/** The Xcode the seam pretends is installed. */
const DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer'

/** `simctl list runtimes --json`, in the shape `lib/providers/sim.js` parses. */
const RUNTIMES = {
  runtimes: [
    {
      name: 'iOS 27.1',
      identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-1',
      version: '27.1',
      platform: 'iOS',
      isAvailable: true,
    },
  ],
}

/**
 * `simctl list devices --json`, with one booted device.
 *
 * Booted on purpose: it is what keeps `boot()` on its "already running" branch,
 * so a test that only wants a resolved target cannot boot anything even in the
 * seam.
 */
const DEVICES = {
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-27-1': [
      // A hex-shaped UDID, because `validUdid` checks the shape before `boot()`
      // re-reads the device by id.
      {
        name: 'iPhone Duo',
        udid: '2F4A1B3C-5D6E-4F70-8A9B-0C1D2E3F4A5B',
        state: 'Booted',
        isAvailable: true,
        // A real pair carries this identifier; the chooser prefers a single
        // device, and the booted record reports the field, so the fixture has
        // to carry what the machine emits.
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo',
      },
    ],
  },
}

/**
 * What a stubbed `simctl io … screenshot` writes.
 *
 * A real PNG — 1 × 1, opaque white — so the capture provider can read it back
 * and report a byte count exactly as it would on the machine. It is a valid
 * 8-bit truecolour image, which is the subset `test/helpers/decode-png.mjs`
 * understands, so a future pixel assertion can decode it too.
 */
const SCREENSHOT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** A canned accessibility payload, longer than the provider's 20,000-character limit. */
const DESCRIBE_JSON = JSON.stringify(
  Array.from({ length: 900 }, (_, index) => ({
    type: 'Button',
    frame: { x: index, y: index, width: 20, height: 20 },
    label: `Row ${index}`,
    enabled: true,
  })),
)

/**
 * The knob defaults, so `restore()` and `reset()` cannot drift apart.
 *
 * @returns {object} a fresh knob record.
 */
function knobDefaults() {
  return {
    allowMutations: false,
    idbInstalled: false,
    buildProduct: false,
    devices: undefined,
    runtimes: undefined,
    list: undefined,
    build: undefined,
    simctl: {},
    io: [],
    logOutput: 'offline-seam log line\n',
    describeOutput: DESCRIBE_JSON,
  }
}

/**
 * The mutable seam state.
 *
 * `commands` / `calls` / `mutating` / `mutated` / `unknown` are observations;
 * the rest are knobs. A case that changes a knob resets the observations with
 * `reset()`, or restores only the knobs with `restore()` when the file's later
 * cases still want to see what ran before it.
 */
export const seam = {
  /** Every command line the plugin ran, in call order. */
  commands: [],
  /** Every command as `{argv, line, cwd}`, in call order. */
  calls: [],
  /** The `simctl` lines refused because they would change device state. */
  mutating: [],
  /** The `simctl` lines answered because a case set `allowMutations`. */
  mutated: [],
  /** Command lines no answer matched; they answer 127. */
  unknown: [],

  /** Answer the state-changing `simctl` verbs with a canned success instead of refusing. */
  allowMutations: false,
  /** Answer `idb --version` with a version line, so the UI tools become available. */
  idbInstalled: false,
  /** Make `xcodebuild … build` scaffold the `.app` product it claims to have built. */
  buildProduct: false,
  /** Replace the `simctl list devices --json` answer (a JSON string or a `{code, stdout, stderr}` record). */
  devices: undefined,
  /** Replace the `simctl list runtimes --json` answer. */
  runtimes: undefined,
  /** Replace the `xcodebuild -list -json` answer, to exercise a failed scheme listing. */
  list: undefined,
  /** Replace the `xcodebuild … build` answer: `{code, stdout, stderr, delayMs}`. */
  build: undefined,
  /** Per-verb `simctl` answers, e.g. `{shutdown: {code: 1, stderr: 'Unable to shutdown device in current state: Booted'}}`. */
  simctl: {},
  /**
   * Queued `simctl io` answers, consumed one per call before the default capture.
   *
   * A queue rather than a single answer because the interesting case is a
   * *sequence*: an older `simctl` that rejects `--display` once and then accepts
   * the plain command.
   */
  io: [],
  /** The `simctl spawn … log show` output. */
  logOutput: 'offline-seam log line\n',
  /** The `idb ui describe-all` payload. */
  describeOutput: DESCRIBE_JSON,

  /** Put every knob back and clear the observations. */
  reset() {
    this.commands = []
    this.calls = []
    this.mutating = []
    this.mutated = []
    this.unknown = []
    this.restore()
  },

  /** Put every knob back but keep the observations. */
  restore() {
    Object.assign(this, knobDefaults())
  },
}

/** Canned answers, matched on the whole argv. */
const ANSWERS = [
  { argv: 'xcode-select -p', stdout: `${DEVELOPER_DIR}\n` },
  { argv: 'xcodebuild -version', stdout: 'Xcode 27.1\nBuild version 27A1\n' },
  { argv: 'sw_vers -productVersion', stdout: '27.1\n' },
  { argv: 'xcrun simctl help', stdout: 'Simulator control\nUsage: simctl [--set <path>] <subcommand>\n' },
]

/**
 * Make `simctl` answers keyed by verb.
 *
 * They are what `seam.simctl` overrides and what the allowed mutation verbs
 * answer by default. Keeping them in one table is what makes "answered" and
 * "refused" the same decision made twice.
 */
const SIMCTL_VERBS = {
  boot: { stdout: 'Device booted\n' },
  bootstatus: { stdout: 'Device already booted\n' },
  install: { stdout: 'App installed\n' },
  launch: { stdout: 'com.example.demo: 4321\n' },
  terminate: { stdout: 'Terminated\n' },
  openurl: { stdout: 'Opened\n' },
  shutdown: { stdout: 'Shutdown\n' },
}

/**
 * The `simctl` verbs that only read.
 *
 * Anything else is refused unless a case opted in. A deny-list of state-changing
 * verbs would go stale the moment Apple adds one, and a missing entry would let
 * a unit test reach the machine — the exact failure this seam exists to prevent.
 */
const READ_ONLY_VERBS = new Set(['appinfo', 'get_app_container', 'getenv', 'help', 'list', 'listapps'])

/** Turn a JSON string or a partial answer record into a full one. */
function answer(value) {
  if (typeof value === 'string') return { stdout: value }
  const record = /** @type {{code?: number, stdout?: string, stderr?: string, delayMs?: number}} */ (value ?? {})
  return {
    ...(record.code === undefined ? {} : { code: record.code }),
    ...(record.stdout === undefined ? {} : { stdout: record.stdout }),
    ...(record.stderr === undefined ? {} : { stderr: record.stderr }),
    ...(record.delayMs === undefined ? {} : { delayMs: record.delayMs }),
  }
}

/**
 * The `simctl io <udid> screenshot [--display <name>] <file>` answer.
 *
 * The capture is written to the file the plugin asked for, because the provider
 * reads it back: a stub that answered without a file would fail a call that
 * succeeds on the machine.
 */
function captureAnswer(args) {
  const file = args.at(-1)
  if (typeof file !== 'string' || file.startsWith('-')) {
    return { code: 1, stderr: 'offline-seam: the screenshot command named no destination\n' }
  }
  const at = args.indexOf('--display')
  const display = at === -1 ? undefined : args[at + 1]
  if (display !== undefined && display !== 'primary') {
    // A secondary display on a device pair is the black frame D1 reported;
    // reproducing that here is what makes the regression test meaningful.
    return { code: 0, stdout: '' }
  }
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, SCREENSHOT_PNG)
  return { code: 0, stdout: '' }
}

/**
 * The `.app` tree a successful `xcodebuild … build` leaves behind.
 *
 * `find()` walks the DerivedData directory for a product and the bundle id is
 * read from it, so a build that claims success has to leave one. The answer is
 * only scaffolded when a case asks for it: a build report that silently gained
 * an `.app` would change what a failing-build case observes.
 */
function scaffoldProduct(argv) {
  const derived = argv[argv.indexOf('-derivedDataPath') + 1]
  if (typeof derived !== 'string') return
  const configuration = argv[argv.indexOf('-configuration') + 1] ?? 'Debug'
  const product = path.join(derived, 'Build', 'Products', `${configuration}-iphonesimulator`, 'Demo.app')
  mkdirSync(product, { recursive: true })
}

/** A child process that answers from a canned record. */
function cannedChild({ stdout = '', stderr = '', code = 0, delayMs = 0 }) {
  const child = new EventEmitter()
  child.stdout = Readable.from([stdout])
  child.stderr = Readable.from([stderr])
  child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  child.kill = () => {}
  child.pid = 0
  // `run()` starts draining both streams before it awaits the exit, so the
  // close event does not have to wait for them. A case that needs a command to
  // take time (the shared build budget) asks for a delay.
  setTimeout(() => child.emit('close', code), delayMs)
  return child
}

/**
 * The answer one command line gets.
 *
 * The order is: an explicit override from {@link seam}, then the exact-argv
 * table, then the shape rules. The shape rules are last because they are the
 * ones that read the argv rather than matching it literally.
 */
function answerFor(argv, line) {
  if (line === 'xcrun simctl list devices --json' && seam.devices !== undefined) return answer(seam.devices)
  if (line === 'xcrun simctl list runtimes --json' && seam.runtimes !== undefined) return answer(seam.runtimes)
  if (line.startsWith('xcodebuild -list -json ') && seam.list !== undefined) return answer(seam.list)
  if (line.startsWith('xcodebuild ') && line.endsWith(' build') && seam.build !== undefined) return answer(seam.build)

  const canned = ANSWERS.find((item) => item.argv === line)
  if (canned) return canned

  if (line === 'xcrun simctl list devices --json') return { stdout: JSON.stringify(seam.devices ?? DEVICES) }
  if (line === 'xcrun simctl list runtimes --json') return { stdout: JSON.stringify(seam.runtimes ?? RUNTIMES) }
  if (line === 'idb --version') {
    return seam.idbInstalled
      ? { stdout: 'idb 1.2.3\n' }
      : { stderr: 'offline-seam: idb is not installed here\n', code: 1 }
  }
  if (line.startsWith('idb ')) {
    if (!seam.idbInstalled) return undefined
    if (line.includes('ui describe-all')) return { stdout: seam.describeOutput }
    return { stdout: 'ok\n' }
  }
  // Showing the simulator window is a no-op here: no window exists in a test.
  if (line.startsWith('open ')) return { stdout: '' }
  // The built product's Info.plist is read only when a build produced one; the
  // helper falls through to `-showBuildSettings` when this fails.
  if (line.startsWith('plutil ')) return { code: 1, stderr: 'offline-seam: no Info.plist\n' }

  if (line.startsWith('xcodebuild -list -json ')) {
    // A listing names the scheme after the bundle it was asked about, which is
    // what Xcode does for a single-target project.
    const file = /-(?:project|workspace) (\S+)/.exec(line)?.[1] ?? 'Unknown.xcodeproj'
    const scheme = path.basename(file, path.extname(file))
    return { stdout: JSON.stringify({ project: { schemes: [scheme] } }) }
  }
  if (line.startsWith('xcodebuild ') && line.includes(' -showBuildSettings')) {
    return { stdout: '    PRODUCT_BUNDLE_IDENTIFIER = com.example.demo\n' }
  }
  if (line.startsWith('xcodebuild ') && line.endsWith(' build')) {
    if (seam.buildProduct) scaffoldProduct(argv)
    return { stdout: '** BUILD SUCCEEDED **\n' }
  }

  const [command, ...args] = argv
  if (command === 'xcrun' && args[0] === 'simctl') {
    const verb = args[1]
    if (verb === 'spawn' && args[3] === 'log') return { stdout: seam.logOutput }
    if (verb === 'io') {
      // `simctl io <udid> <subcommand> …`: the device UDID is the first argument
      // after the verb, so the subcommand is the one after it.
      if (!seam.allowMutations) return 'refused'
      if (seam.io.length > 0) return answer(seam.io.shift())
      if (args[3] === 'screenshot') return captureAnswer(args.slice(4))
      return { stdout: '1 Display port:\n  LCD - 1398x2034\n' }
    }
    if (verb !== undefined && Object.hasOwn(SIMCTL_VERBS, verb)) {
      if (!seam.allowMutations) return 'refused'
      return { ...SIMCTL_VERBS[verb], ...answer(seam.simctl[verb]) }
    }
    if (verb !== undefined && READ_ONLY_VERBS.has(verb)) return { stdout: '' }
  }
  return undefined
}

childProcess.spawn = function offlined(command, args = [], options = {}) {
  const argv = [command, ...args]
  const line = argv.join(' ')
  seam.commands.push(line)
  seam.calls.push({ argv, line, cwd: typeof options?.cwd === 'string' ? options.cwd : undefined })

  const resolved = answerFor(argv, line)
  if (resolved === 'refused') {
    seam.mutating.push(line)
    return cannedChild({
      stderr: `offline-seam: refusing "${line}" — a unit test must not change simulator state\n`,
      code: 1,
    })
  }
  if (resolved !== undefined) {
    // A `simctl` verb answered because the case allowed it is a mutation the
    // test opted into. It is recorded apart from the refusals, so a file can
    // assert both "no test mutated anything by accident" and "these mutations
    // were the ones the cases asked for".
    if (argv[0] === 'xcrun' && argv[1] === 'simctl' && !READ_ONLY_VERBS.has(argv[2])) {
      if (Object.hasOwn(SIMCTL_VERBS, argv[2]) || argv[2] === 'io') seam.mutated.push(line)
    }
    return cannedChild(resolved)
  }

  seam.unknown.push(line)
  return cannedChild({ stderr: `offline-seam: "${line}" is not stubbed\n`, code: 127 })
}
