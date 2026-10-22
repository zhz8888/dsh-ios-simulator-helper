import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { inside, displayPath } from '../util/path.js'
import { brief, ok, run, splitArgumentLines } from '../util/run.js'
import { boot, install, launch } from './sim.js'
import { bundle, discover, source } from './project.js'
import { requireMacOS } from './host.js'

/**
 * `xcodebuild` orchestration.
 *
 * Ported from the ZCode plugin's `providers/build.ts`. The command line is the
 * original's — `-project`/`-workspace`, `-scheme`, `-configuration`,
 * `-destination platform=iOS Simulator,id=<udid>`, `-derivedDataPath`,
 * `CODE_SIGNING_ALLOWED=NO`, `build` — with three additions the configuration page
 * controls: the configuration default, the build timeout, and extra arguments
 * inserted before `build`. The derived-data root also moves under the plugin's
 * data directory instead of `IOS_SIM_PLUGIN_DATA`/tmp.
 *
 * One failure is repaired rather than reported: when the caller is itself
 * sandboxed, `swift-plugin-server` cannot start its nested `sandbox-exec` and
 * every Swift macro fails, so the build is retried once with
 * `OTHER_SWIFT_FLAGS=-disable-sandbox`. See `macroSandboxDenied`.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/providers/build
 */

/**
 * What one build produced.
 *
 * @typedef {object} BuildReport
 * @property {boolean} ok - whether the build succeeded.
 * @property {import('./project.js').SchemeResult} source - the project and scheme that were built.
 * @property {import('./sim.js').BootResult} simulator - the simulator the build targeted.
 * @property {string} configuration - the Xcode configuration that was built.
 * @property {string} derivedDataPath - the DerivedData directory the build used.
 * @property {string} [appPath] - the built `.app` bundle, when the build succeeded.
 * @property {string} [bundleId] - the resolved bundle identifier.
 * @property {string} [bundleIdSource] - where the bundle identifier came from.
 * @property {string} logPath - the path of the full build log.
 * @property {number} code - the exit code of the build command.
 * @property {boolean} timedOut - whether the build hit its timeout.
 * @property {true} [macroSandboxRetry] - whether the build was retried with the macro sandbox off.
 * @property {string} output - the tail of the build output.
 */

/**
 * What a build-and-run produced.
 *
 * A failed build never installs or launches, so both outcomes are `false`
 * there; a successful one carries the install and the launch.
 *
 * @typedef {BuildReport & {installed: boolean | import('./sim.js').InstallResult,
 *   launched: boolean | import('./sim.js').LaunchResult}} BuildAndRunReport
 */

/**
 * The resolved bundle identifier and where it came from.
 *
 * @typedef {object} BundleIdResolution
 * @property {string} [value] - the identifier, when one was resolved.
 * @property {string} [source] - where the identifier came from.
 */

/**
 * The arguments one build call takes.
 *
 * Every field is optional: the model may ask for "the current project", and
 * the plugin's settings and the discovered project fill the rest.
 *
 * @typedef {object} BuildInput
 * @property {string | undefined} [project] - a `.xcodeproj` path, relative to the session workspace.
 * @property {string | undefined} [workspace] - a `.xcworkspace` path, relative to the session workspace.
 * @property {string | undefined} [scheme] - the scheme to build.
 * @property {string | undefined} [configuration] - the Xcode configuration to build.
 * @property {string | undefined} [derivedDataPath] - the DerivedData directory, relative to the session workspace.
 * @property {string | undefined} [bundleId] - a bundle identifier to use instead of the resolved one.
 * @property {string | undefined} [udid] - the simulator UDID to build for.
 * @property {string | undefined} [device] - a simulator device-name fragment.
 * @property {string | undefined} [runtime] - a simulator runtime-name fragment.
 * @property {boolean | undefined} [openSimulator] - whether to open the simulator window.
 * @property {number | undefined} [timeoutMs] - the build timeout in milliseconds.
 * @property {string[] | undefined} [launchArgs] - the arguments the launched app is started with.
 */

/**
 * Build the current or specified project for the iOS Simulator.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {BuildInput} [input] - the tool arguments.
 * @returns {Promise<BuildReport>} the build report; `ok` is false for a failed build rather than a throw.
 */
export async function app(rt, input = {}) {
  requireMacOS(rt)
  const found = await discover(rt, rt.cwd)
  const src = source(rt, input, found)
  if (!src.scheme) throw new Error('No scheme found. Pass scheme explicitly.')
  const sim = await boot(rt, {
    udid: input.udid,
    name: input.device,
    runtime: input.runtime,
    open: input.openSimulator ?? false,
  })
  const dir = input.derivedDataPath
    ? inside(rt.cwd, input.derivedDataPath)
    : await rt.derivedData(key(`${rt.cwd}:${src.file}:${src.scheme}`))
  await mkdir(dir, { recursive: true })
  const configuration = input.configuration || rt.settings.defaultConfiguration
  const argv = [
    'xcodebuild',
    src.flag,
    src.file,
    '-scheme',
    src.scheme,
    '-configuration',
    configuration,
    '-destination',
    `platform=iOS Simulator,id=${sim.udid}`,
    '-derivedDataPath',
    dir,
    ...(rt.settings.disableCodeSigning ? ['CODE_SIGNING_ALLOWED=NO'] : []),
    ...splitArgumentLines(rt.settings.extraBuildArgs),
  ]
  // The setting is in seconds; a child-process timeout is milliseconds.
  // `timeoutMs` is the tool argument, which the tool schema documents in ms.
  const options = {
    timeout: requestedTimeoutMs(input.timeoutMs) ?? buildTimeoutMs(rt.settings.buildTimeoutSeconds),
    cwd: rt.cwd,
  }
  let out = await run([...argv, 'build'], options)
  let macroSandboxRetry = false
  if (!ok(out) && macroSandboxDenied(`${out.stdout}\n${out.stderr}`) && !setsSwiftFlags(argv)) {
    // Retry once with Swift's macro-plugin sandbox off. Only a caller that is
    // already sandboxed reaches this branch, and without the retry the whole
    // build-and-run flow fails on a project this plugin generated itself.
    out = await run([...argv, 'OTHER_SWIFT_FLAGS=-disable-sandbox', 'build'], options)
    macroSandboxRetry = true
  }
  const logPath = await record(rt, 'build', out)
  const product = ok(out) ? await find(dir, configuration) : undefined
  const resolved = await resolveBundleId(rt, {
    explicit: input.bundleId,
    product,
    flag: src.flag,
    file: src.file,
    scheme: src.scheme,
    derivedDataPath: dir,
  })
  return {
    ok: ok(out),
    source: src,
    simulator: sim,
    configuration,
    derivedDataPath: dir,
    // A field the build could not answer is left out rather than set to
    // `undefined`: an absent field and a field holding `undefined` are the
    // same thing to a JSON value, and only the first is a value the type of
    // the report can describe.
    ...(product === undefined ? {} : { appPath: product }),
    ...(resolved.value === undefined ? {} : { bundleId: resolved.value }),
    ...(resolved.source === undefined ? {} : { bundleIdSource: resolved.source }),
    logPath,
    code: out.code,
    timedOut: out.timed,
    ...(macroSandboxRetry ? { macroSandboxRetry: true } : {}),
    output: brief(out, 12_000),
  }
}

/**
 * Whether a failed build failed because Swift's macro plugin could not start.
 *
 * `swift-plugin-server` runs macro expansion under its own `sandbox-exec`. When
 * the caller is *already* sandboxed — the DSH bash sandbox, a CI runner — that
 * nested sandbox cannot be applied, and every macro in the file is reported as
 * a malformed response:
 *
 *     sandbox-exec: sandbox_apply: Operation not permitted
 *     error: external macro implementation type 'SwiftUIMacros.StateMacro'
 *            could not be found for macro 'State()';
 *            '.../swift-plugin-server' produced malformed response
 *
 * That is an environment failure, not a project failure, and it hit the
 * template `ios_create_app` writes. Recognizing it exactly is what makes the
 * single retry with `-disable-sandbox` safe: a real compile error never matches.
 *
 * @param {string} output - the combined stdout and stderr of the failed build.
 * @returns {boolean} true when the only thing that failed was the nested sandbox.
 */
export function macroSandboxDenied(output) {
  const text = String(output ?? '')
  // Xcode wraps the plugin path in quotes, so the two halves of the message are
  // matched separately rather than as one literal.
  return text.includes('sandbox_apply: Operation not permitted')
    && text.includes('swift-plugin-server')
    && text.includes('produced malformed response')
}

/**
 * Whether the argv already sets OTHER_SWIFT_FLAGS, which a retry must not duplicate.
 *
 * @param {string[]} argv - the command line that was assembled.
 * @returns {boolean} true when the flag is already there.
 */
function setsSwiftFlags(argv) {
  return argv.some((arg) => /^OTHER_SWIFT_FLAGS\s*=/u.test(arg))
}

/** The build timeout used when the setting carries no usable value. */
const DEFAULT_BUILD_TIMEOUT_MS = 600_000

/**
 * The build timeout in milliseconds.
 *
 * The setting is in seconds and a child-process timeout is milliseconds. A
 * value that is not a finite positive number would multiply into `NaN`, and
 * `setTimeout(fn, NaN)` fires in about a millisecond — the build would be
 * killed almost instantly and reported as "build failed" with no hint at all.
 * The default is therefore applied whenever the setting is unusable, and the
 * result is a real `number` rather than the raw product of the setting.
 *
 * @param {number} seconds - the configured timeout, in seconds.
 * @returns {number} the timeout, in milliseconds.
 */
function buildTimeoutMs(seconds) {
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_BUILD_TIMEOUT_MS
}

/** The longest build timeout a caller may ask for: a day. */
const MAX_BUILD_TIMEOUT_MS = 86_400_000

/**
 * The build timeout the caller asked for, when it is a usable one.
 *
 * The argument is model-supplied, so it is validated rather than trusted. A
 * value that is not a positive integer, or one beyond a day, is not a timeout
 * anyone meant: Node's timers take a 32-bit signed delay, so an out-of-range
 * one overflows to 1 ms and kills the build instantly while the report calls
 * it a timeout that never elapsed.
 *
 * @param {number | undefined} value - the requested timeout in milliseconds.
 * @returns {number | undefined} the timeout, or `undefined` when unusable.
 */
export function requestedTimeoutMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const ms = Math.trunc(value)
  return ms > 0 && ms <= MAX_BUILD_TIMEOUT_MS ? ms : undefined
}

/**
 * Resolve the app's bundle identifier.
 *
 * The original plugin asked `xcodebuild -showBuildSettings` and nothing else,
 * which fails in two ordinary situations: the command is run without
 * `-derivedDataPath` (so it needs the *default* DerivedData directory, which a
 * sandboxed or freshly migrated machine may not be able to create), and it is
 * run at all on a project whose scheme needs a destination. Either way the
 * original silently returned `undefined` and `ios_build_and_run` then failed
 * with "PRODUCT_BUNDLE_IDENTIFIER could not be resolved" *after* a successful
 * build.
 *
 * The order here is most-authoritative first:
 *
 *   1. an explicit `bundleId` argument;
 *   2. `CFBundleIdentifier` of the `.app` that was just built — this is the
 *      value simctl will actually install, read with `plutil`;
 *   3. `xcodebuild -showBuildSettings`, now with the same `-derivedDataPath`;
 *   4. the identifiers discovered in `project.pbxproj`.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {{explicit?: string | undefined, product?: string | undefined, flag: string, file: string, scheme: string,
 *   derivedDataPath?: string | undefined}} input - the resolution inputs.
 * @returns {Promise<BundleIdResolution>} the identifier and where it came from.
 */
async function resolveBundleId(rt, input) {
  if (input.explicit) return { value: input.explicit, source: 'argument' }
  if (input.product) {
    const plist = path.join(input.product, 'Info.plist')
    const out = await run(['plutil', '-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist], { timeout: 15_000 })
    const value = out.stdout.trim()
    if (ok(out) && value.length > 0) return { value, source: 'built product Info.plist' }
  }
  const settings = await bundle(rt, input.flag, input.file, input.scheme, input.derivedDataPath)
  if (settings) return { value: settings, source: 'xcodebuild -showBuildSettings' }
  const found = await discover(rt, rt.cwd).catch(() => undefined)
  const first = found?.bundleIds?.[0]
  if (first) return { value: first, source: 'project.pbxproj' }
  return {}
}

/**
 * Build, install, launch and show an app.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {BuildInput} [input] - the tool arguments.
 * @returns {Promise<BuildAndRunReport>} the build report plus the install/launch outcomes.
 */
export async function runApp(rt, input = {}) {
  const built = await app(rt, {
    ...input,
    openSimulator: input.openSimulator ?? rt.settings.autoOpenSimulator,
  })
  if (!built.ok) return { ...built, installed: false, launched: false }
  if (!built.appPath) throw new Error('Build succeeded, but no .app product was found in DerivedData.')
  if (!built.bundleId) {
    throw new Error(
      'Build succeeded, but the bundle identifier could not be resolved from the built product, the build settings '
        + 'or the project file. Pass bundleId explicitly.',
    )
  }
  const installed = await install(rt, built.simulator.udid, built.appPath)
  const launched = await launch(rt, built.simulator.udid, built.bundleId, input.launchArgs ?? [])
  return { ...built, installed, launched }
}

/**
 * Write one command's full output to the log directory and return its path.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} name - the command name the log file carries.
 * @param {import('../util/run.js').RunResult} out - the finished command.
 * @returns {Promise<string>} the path of the written log.
 */
async function record(rt, name, out) {
  const dir = await rt.buildLogs()
  const file = path.join(dir, `${stamp()}-${name}.log`)
  await writeFile(
    file,
    [`$ ${out.cmd.join(' ')}`, `exit=${out.code}`, `timedOut=${out.timed}`, '', out.stdout, out.stderr].join('\n'),
    'utf8',
  )
  // The log lives under the plugin's data directory, which sits outside the
  // session workspace whenever DSH_HOME does. A `../../..` path would be a
  // workspace-relative lie, so anything outside the workspace stays absolute.
  return displayPath(rt.cwd, file)
}

/**
 * The `.app` product inside a DerivedData tree.
 *
 * @param {string} dir - the DerivedData directory.
 * @param {string} configuration - the requested configuration.
 * @returns {Promise<string | undefined>} the product path, when the build produced one.
 */
async function find(dir, configuration) {
  return pickAppProduct(await apps(dir, 8), configuration)
}

/**
 * Choose the build product among every `.app` in DerivedData.
 *
 * @param {string[]} hits - candidate `.app` paths.
 * @param {string} configuration - the requested configuration.
 * @returns {string|undefined} the best candidate.
 */
export function pickAppProduct(hits, configuration) {
  return (
    hits.find((item) => item.includes(`${path.sep}${configuration}-iphonesimulator${path.sep}`))
    || hits.find((item) => item.includes(`${path.sep}Debug-iphonesimulator${path.sep}`))
    || hits[0]
  )
}

/**
 * Every `.app` under `dir`, to `depth`.
 *
 * @param {string} dir - the directory to walk.
 * @param {number} depth - how many levels to descend.
 * @returns {Promise<string[]>} the `.app` paths.
 */
async function apps(dir, depth) {
  if (depth < 0) return []
  const items = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return (
    await Promise.all(
      items.map(async (item) => {
        const file = path.join(dir, item.name)
        if (item.isDirectory() && item.name.endsWith('.app')) return [file]
        if (item.isDirectory()) return apps(file, depth - 1)
        return []
      }),
    )
  ).flat()
}

/**
 * A stable short fingerprint for one project/scheme pair.
 *
 * @param {string} value - the string to fingerprint.
 * @returns {string} the short hex digest.
 */
function key(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 16)
}

/** A filename-safe timestamp. */
function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}
