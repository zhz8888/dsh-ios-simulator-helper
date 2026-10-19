import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'
import { createRequire } from 'node:module'

/**
 * Answer the plugin's Apple-tool probes from a table instead of the machine.
 *
 * Three cases in `test/host.test.js` reach real providers: the `/ios-dev`
 * command handler runs `preflight()`, `ios_install_app` resolves a target
 * through `simProvider.boot()`, and `ios_ui_status` probes the UI backend. On a
 * Mac those calls start CoreSimulatorService, enumerate simulator runtimes and
 * devices, and — with nothing booted and `autoBootSimulator` on, which is the
 * default — boot a simulator. That is real-machine work: `pnpm test` must never
 * do it, and `scripts/smoke.mjs` is where it is proven. Importing this module
 * before `lib/index.js` is what makes the suite answer those probes offline.
 *
 * Only `spawn` is replaced, because `lib/util/run.js` is the plugin's single
 * external-command path. Nothing falls through to the real `spawn`: a command
 * the table does not know answers 127, so an unexpected probe shows up as a
 * failing check rather than as silent work on the developer's machine.
 *
 * The order matters and cannot be fixed later: `lib/util/run.js` takes `spawn`
 * as an ESM named import of a CommonJS builtin, and that binding snapshots the
 * property at module evaluation.
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
      { name: 'iPhone Duo', udid: '2F4A1B3C-5D6E-4F70-8A9B-0C1D2E3F4A5B', state: 'Booted', isAvailable: true },
    ],
  },
}

/** Canned answers, matched on the whole argv. */
const ANSWERS = [
  { argv: 'xcode-select -p', stdout: `${DEVELOPER_DIR}\n` },
  { argv: 'xcodebuild -version', stdout: 'Xcode 27.1\nBuild version 27A1\n' },
  { argv: 'xcrun simctl help', stdout: 'Simulator control\nUsage: simctl [--set <path>] <subcommand>\n' },
  { argv: 'xcrun simctl list runtimes --json', stdout: JSON.stringify(RUNTIMES) },
  { argv: 'xcrun simctl list devices --json', stdout: JSON.stringify(DEVICES) },
  { argv: 'idb --version', stderr: 'offline-seam: idb is not installed here\n', code: 1 },
]

/**
 * The `simctl` verbs that only read.
 *
 * Anything else is refused. A deny-list of state-changing verbs would go stale
 * the moment Apple adds one, and a missing entry would let a unit test change
 * device state — the exact failure this seam exists to prevent. So the verbs
 * that are safe are named, and everything else is treated as state-changing.
 */
const READ_ONLY_VERBS = new Set(['appinfo', 'get_app_container', 'getenv', 'help', 'list', 'listapps'])

/** Everything the seam was asked to do, in call order. */
export const seam = { commands: [], mutating: [], unknown: [] }

/** A child process that answers from a canned record. */
function cannedChild({ stdout = '', stderr = '', code = 0 }) {
  const child = new EventEmitter()
  child.stdout = Readable.from([stdout])
  child.stderr = Readable.from([stderr])
  child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  child.kill = () => {}
  child.pid = 0
  // `run()` starts draining both streams before it awaits the exit, so the
  // close event does not have to wait for them.
  process.nextTick(() => child.emit('close', code))
  return child
}

childProcess.spawn = function offlined(command, args = [], _options) {
  const line = [command, ...args].join(' ')
  seam.commands.push(line)

  if (command === 'xcrun' && args[0] === 'simctl' && !READ_ONLY_VERBS.has(args[1])) {
    seam.mutating.push(line)
    return cannedChild({
      stderr: `offline-seam: refusing "${line}" — a unit test must not change simulator state\n`,
      code: 1,
    })
  }

  const answer = ANSWERS.find((item) => item.argv === line)
  if (answer) return cannedChild(answer)

  seam.unknown.push(line)
  return cannedChild({ stderr: `offline-seam: "${line}" is not stubbed\n`, code: 127 })
}
