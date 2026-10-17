import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { inside, rel } from '../util/path.js'
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
 * `CODE_SIGNING_ALLOWED=NO`, `build` — with three additions the settings page
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
 * Build the current or specified project for the iOS Simulator.
 *
 * @param {object} rt - the call runtime.
 * @param {object} [input] - the tool arguments.
 * @returns {Promise<object>} the build report; `ok` is false for a failed build rather than a throw.
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
  const options = { timeout: input.timeoutMs ?? rt.settings.buildTimeoutSeconds * 1000, cwd: rt.cwd }
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
    appPath: product,
    bundleId: resolved.value,
    bundleIdSource: resolved.source,
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

/** Whether the argv already sets OTHER_SWIFT_FLAGS, which a retry must not duplicate. */
function setsSwiftFlags(argv) {
  return argv.some((arg) => /^OTHER_SWIFT_FLAGS\s*=/u.test(arg))
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
 * @param {object} rt - the call runtime.
 * @param {{explicit?: string, product?: string, flag: string, file: string, scheme: string,
 *   derivedDataPath?: string}} input - the resolution inputs.
 * @returns {Promise<{value?: string, source?: string}>} the identifier and where it came from.
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
  return { source: undefined }
}

/**
 * Build, install, launch and show an app.
 *
 * @param {object} rt - the call runtime.
 * @param {object} [input] - the tool arguments.
 * @returns {Promise<object>} the build report plus the install/launch outcomes.
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

/** Write one command's full output to the log directory and return its path. */
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
  const shown = rel(rt.cwd, file)
  return shown.startsWith('..') ? file : shown
}

/** The `.app` product inside a DerivedData tree. */
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

/** Every `.app` under `dir`, to `depth`. */
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

/** A stable short fingerprint for one project/scheme pair. */
function key(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 16)
}

/** A filename-safe timestamp. */
function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}
