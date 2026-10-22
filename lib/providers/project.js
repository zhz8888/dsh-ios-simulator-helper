import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inside } from '../util/path.js'
import { ok, run } from '../util/run.js'
import { requireMacOS } from './host.js'

/**
 * Xcode project discovery and scaffolding.
 *
 * Ported from the ZCode plugin's `providers/project.ts`; the search depths, the
 * generated SwiftUI sources and the whole `project.pbxproj` template are
 * byte-for-byte the original's. The only structural change is that every path
 * is resolved against the session workspace held by the runtime instead of
 * `process.cwd()`, and the name/bundle-id/deployment validators are exported so
 * they can be tested without touching the filesystem.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/providers/project
 */

/**
 * What a project scan found.
 *
 * @typedef {object} ProjectScan
 * @property {string[]} projects - the `.xcodeproj` bundles, relative to the scanned directory.
 * @property {string[]} workspaces - the `.xcworkspace` bundles, relative to the scanned directory.
 * @property {string[]} schemes - the schemes of the first project or workspace that was found.
 * @property {string[]} bundleIds - the bundle identifiers the project files declare.
 */

/**
 * What a scaffold wrote.
 *
 * @typedef {object} ScaffoldResult
 * @property {string} project - the created `.xcodeproj`, relative to the session workspace.
 * @property {string} scheme - the scheme name, which is the app name.
 * @property {string} bundle - the bundle identifier of the created app.
 * @property {string[]} files - the Swift sources that were written, relative to the session workspace.
 */

/**
 * The project and scheme one build should use.
 *
 * @typedef {object} SchemeResult
 * @property {string} flag - `-project` or `-workspace`.
 * @property {string} file - the project or workspace path, relative to the session workspace.
 * @property {string} [scheme] - the scheme to build; {@link source} fills it for every source it returns.
 */

/**
 * The bundle identifier a project declares.
 *
 * @typedef {string | undefined} BundleIdResult
 */

/** Fixed `objectVersion = 56` project-file identifiers, as the original used. */
const IDS = [
  'A10000000000000000000001',
  'A10000000000000000000002',
  'A10000000000000000000003',
  'A10000000000000000000004',
  'A10000000000000000000005',
  'A10000000000000000000006',
  'A10000000000000000000007',
  'A10000000000000000000008',
  'A10000000000000000000009',
  'A1000000000000000000000A',
  'A1000000000000000000000B',
  'A1000000000000000000000C',
  'A1000000000000000000000D',
  'A1000000000000000000000E',
  'A1000000000000000000000F',
  'A10000000000000000000010',
  'A10000000000000000000011',
  'A10000000000000000000012',
  'A10000000000000000000013',
  'A10000000000000000000014',
  'A10000000000000000000015',
  'A10000000000000000000016',
]

/**
 * Normalise a requested app name into a Swift target name.
 *
 * @param {string | undefined} value - the requested name.
 * @returns {string} the Swift target name.
 */
export function cleanAppName(value) {
  const out = String(value ?? '').replace(/[^A-Za-z0-9_]/g, '')
  if (!out) throw new Error('App name must contain letters or numbers.')
  if (/^[0-9]/.test(out)) return `App${out}`
  return out
}

/**
 * Validate an explicit bundle identifier.
 *
 * @param {string} value - the requested identifier.
 * @returns {string} the identifier, unchanged.
 * @throws {Error} when it is not a dotted pair of valid segments.
 */
export function appBundleId(value) {
  const parts = String(value ?? '').split('.')
  const good = parts.length > 1 && parts.every((part) => /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(part))
  if (!good) throw new Error(`Invalid bundle id: ${value}`)
  return value
}

/**
 * Validate an iOS deployment target such as `17.0`.
 *
 * @param {string} value - the requested target.
 * @returns {string} the target, unchanged.
 * @throws {Error} when it is not a dotted number.
 */
export function deploymentTarget(value) {
  if (!/^[0-9]+(\.[0-9]+){0,2}$/.test(String(value ?? ''))) {
    throw new Error(`Invalid deployment target: ${value}`)
  }
  return value
}

/**
 * Turn an app name into a bundle-id-safe slug.
 *
 * @param {string | undefined} value - the app name.
 * @returns {string} the slug; `app` when the name holds nothing usable.
 */
export function slugify(value) {
  const out = String(value ?? '')
    .replace(/[^A-Za-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  if (/^[0-9]/.test(out)) return `app-${out}`
  return out || 'app'
}

/**
 * Discover Xcode projects, workspaces, schemes and bundle ids.
 *
 * The report paths are relative to the directory that was searched, which is
 * the session workspace unless the caller named another one.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} [dir] - directory to search; defaults to the session workspace.
 * @returns {Promise<ProjectScan>} the report.
 */
export async function discover(rt, dir = rt.cwd) {
  /** @type {string[]} */
  const projects = []
  /** @type {string[]} */
  const workspaces = []
  await walk(dir, 3, (file) => {
    if (file.endsWith('.xcodeproj')) projects.push(path.relative(dir, file))
    if (file.endsWith('.xcworkspace')) workspaces.push(path.relative(dir, file))
  })
  const found = {
    projects: projects.sort(),
    workspaces: workspaces.sort(),
  }
  const source = found.workspaces[0]
    ? { flag: '-workspace', file: found.workspaces[0] }
    : found.projects[0]
      ? { flag: '-project', file: found.projects[0] }
      : undefined
  // The listing runs against the absolute path of the bundle that was found:
  // the reported path is relative to the searched directory, which is not the
  // session workspace when the caller searched a subdirectory, and resolving
  // it against the workspace would look for a project that is not there.
  const schemes = source ? await schemesFor(rt, source.flag, path.join(dir, source.file), dir) : []
  /** @type {Set<string>} */
  const ids = new Set()
  for (const item of found.projects) {
    const file = path.join(dir, item, 'project.pbxproj')
    const text = await readFile(file, 'utf8').catch(() => '')
    for (const hit of text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)) {
      ids.add(hit[1]?.replaceAll('"', '').trim() ?? '')
    }
  }
  return { ...found, schemes, bundleIds: [...ids].filter(Boolean) }
}

/**
 * `xcodebuild -list -json` schemes, or `[]` when the listing fails.
 *
 * `file` is the absolute path of the project or workspace bundle and `dir` the
 * directory that was searched: the two are not the session workspace when the
 * caller searched a subdirectory, so the command must not mix the two bases.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} flag - `-project` or `-workspace`.
 * @param {string} file - the absolute project or workspace path.
 * @param {string} dir - the directory the bundle was found in.
 * @returns {Promise<string[]>} the scheme names.
 */
async function schemesFor(rt, flag, file, dir) {
  const out = await run(['xcodebuild', '-list', '-json', flag, file], { timeout: 30_000, cwd: dir })
  if (!ok(out)) return []
  try {
    return schemesOf(parsePayload(out.stdout))
  } catch {
    return []
  }
}

/**
 * Read a `xcodebuild -list -json` payload as an object.
 *
 * `JSON.parse('null')` yields `null`, and a property read on it throws a
 * `TypeError` that says nothing about the plugin — so a payload that is not an
 * object reads as "no schemes here", the same way an empty scheme list does.
 * `sim.js` resolves its `simctl --json` payloads the same way.
 *
 * @param {string} value - the raw JSON.
 * @returns {Record<string, unknown> | undefined} the payload, when it is an object.
 */
function parsePayload(value) {
  return objectOf(/** @type {unknown} */ (JSON.parse(value)))
}

/**
 * Narrow one parsed value to an object, so a nested read is safe.
 *
 * @param {unknown} value - the parsed value.
 * @returns {Record<string, unknown> | undefined} the value, when it is an object.
 */
function objectOf(value) {
  if (typeof value !== 'object' || value === null) return undefined
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * The scheme names a `xcodebuild -list -json` payload carries.
 *
 * The listing holds its schemes under `project.schemes` or under
 * `workspace.schemes`, whichever the listing was made for; the first one that
 * is there wins, and anything that is not a list of names reads as "no
 * schemes".
 *
 * @param {Record<string, unknown> | undefined} raw - the parsed payload.
 * @returns {string[]} the scheme names.
 */
function schemesOf(raw) {
  const project = objectOf(raw?.project)
  const workspace = objectOf(raw?.workspace)
  const list = project?.schemes ?? workspace?.schemes
  return Array.isArray(list) ? list.map((item) => String(item)) : []
}

/**
 * Recurse to `depth`, reporting `.xcodeproj`/`.xcworkspace` bundles.
 *
 * @param {string} dir - the directory to walk.
 * @param {number} depth - how many levels to descend.
 * @param {(file: string) => void} cb - called with every bundle path.
 * @returns {Promise<void>} resolves when the walk is done.
 */
async function walk(dir, depth, cb) {
  if (depth < 0) return
  const items = await readdir(dir, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    items
      .filter((item) => !item.name.startsWith('.') && item.name !== 'node_modules' && item.name !== 'DerivedData')
      .map(async (item) => {
        const file = path.join(dir, item.name)
        if (item.isDirectory() && (item.name.endsWith('.xcodeproj') || item.name.endsWith('.xcworkspace'))) {
          cb(file)
          return
        }
        if (item.isDirectory()) await walk(file, depth - 1, cb)
      }),
  )
}

/**
 * Create a minimal SwiftUI app and Xcode project in the session workspace.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {{name: string, bundleId?: string | undefined, dir?: string | undefined,
 *   deployment?: string | undefined, overwrite?: boolean | undefined}} input - the request.
 * @returns {Promise<ScaffoldResult>} the created paths.
 */
export async function create(rt, input) {
  const cwd = rt.cwd
  const name = cleanAppName(input.name)
  const root = inside(cwd, input.dir || name)
  const bundle = input.bundleId ? appBundleId(input.bundleId) : `com.example.${slugify(name)}`
  const target = deploymentTarget(input.deployment || '17.0')
  const src = path.join(root, name)
  const proj = path.join(root, `${name}.xcodeproj`)
  /** @type {[string, string, string]} */
  const files = [
    path.join(src, `${name}App.swift`),
    path.join(src, 'ContentView.swift'),
    path.join(proj, 'project.pbxproj'),
  ]
  if (!input.overwrite) {
    const hits = await present(files)
    if (hits.length) {
      throw new Error(
        `Refusing to overwrite existing iOS app files: ${hits.map((file) => path.relative(cwd, file)).join(', ')}. `
          + 'Pass overwrite: true after confirming with the user.',
      )
    }
  }
  await mkdir(src, { recursive: true })
  await mkdir(proj, { recursive: true })
  await writeFile(files[0], appSource(name), 'utf8')
  await writeFile(files[1], viewSource(), 'utf8')
  await writeFile(files[2], pbx(name, bundle, target), 'utf8')
  return {
    project: path.relative(cwd, proj),
    scheme: name,
    bundle,
    files: files.slice(0, 2).map((file) => path.relative(cwd, file)),
  }
}

/**
 * Read `PRODUCT_BUNDLE_IDENTIFIER` out of the build settings.
 *
 * `derivedDataPath` is forwarded when the caller knows it: without it
 * `-showBuildSettings` prepares the *default* DerivedData directory, which a
 * sandboxed caller may not be able to create, and the command then fails with
 * "Could not get build settings for target".
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} flag - `-project` or `-workspace`.
 * @param {string} file - the project/workspace path.
 * @param {string} scheme - the scheme to resolve.
 * @param {string} [derivedDataPath] - the DerivedData directory to prepare in.
 * @returns {Promise<BundleIdResult>} the bundle id, or `undefined` when unresolved.
 */
export async function bundle(rt, flag, file, scheme, derivedDataPath) {
  const out = await run(
    [
      'xcodebuild',
      flag,
      file,
      '-scheme',
      scheme,
      ...(derivedDataPath ? ['-derivedDataPath', derivedDataPath] : []),
      '-showBuildSettings',
    ],
    { timeout: 60_000, cwd: rt.cwd },
  )
  if (!ok(out)) return undefined
  return out.stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('PRODUCT_BUNDLE_IDENTIFIER = '))
    ?.replace('PRODUCT_BUNDLE_IDENTIFIER = ', '')
}

/**
 * Resolve which project and scheme a build should use.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {{project?: string | undefined, workspace?: string | undefined, scheme?: string | undefined}} input - the tool arguments.
 * @param {{projects: string[], workspaces: string[], schemes: string[]}} found - the discovery report.
 * @returns {SchemeResult} the build source.
 * @throws When the workspace holds no project.
 */
export function source(rt, input, found) {
  const workspace = input.workspace ? scoped(rt, input.workspace, '.xcworkspace') : undefined
  const project = input.project ? scoped(rt, input.project, '.xcodeproj') : undefined
  if (workspace) return { flag: '-workspace', file: workspace, scheme: pickScheme(input, found, workspace) }
  if (project) return { flag: '-project', file: project, scheme: pickScheme(input, found, project) }
  const auto = found.workspaces[0]
    ? { flag: '-workspace', file: found.workspaces[0] }
    : found.projects[0]
      ? { flag: '-project', file: found.projects[0] }
      : undefined
  if (auto) return { ...auto, scheme: pickScheme(input, found, auto.file) }
  throw new Error('No .xcodeproj or .xcworkspace found. Use ios_create_app first.')
}

/**
 * The scheme for a source: explicit, discovered, or the file's basename.
 *
 * @param {{scheme?: string | undefined}} input - the tool arguments.
 * @param {{projects: string[], workspaces: string[], schemes: string[]}} found - the discovery report.
 * @param {string} file - the project or workspace path.
 * @returns {string} the scheme name.
 */
function pickScheme(input, found, file) {
  const first = found.workspaces[0] || found.projects[0]
  return input.scheme || (file === first ? found.schemes[0] : undefined) || path.basename(file, path.extname(file))
}

/**
 * Which of `files` already exist.
 *
 * @param {string[]} files - the paths to probe.
 * @returns {Promise<string[]>} the paths that exist.
 */
async function present(files) {
  return (
    await Promise.all(
      files.map(async (file) => {
        const hit = await access(file)
          .then(() => true)
          .catch(() => false)
        return hit ? file : undefined
      }),
    )
  ).filter((file) => file !== undefined)
}

/**
 * Resolve a project/workspace argument and require its extension.
 *
 * @param {import('../runtime.js').Runtime} rt - the call runtime.
 * @param {string} raw - the requested path.
 * @param {string} ext - the extension the path must carry.
 * @returns {string} the path, relative to the session workspace.
 */
function scoped(rt, raw, ext) {
  const file = inside(rt.cwd, raw)
  if (!file.endsWith(ext)) throw new Error(`Expected ${ext} path: ${raw}`)
  return path.relative(rt.cwd, file)
}

/**
 * The generated `@main` app file.
 *
 * @param {string} name - the app name.
 * @returns {string} the Swift source.
 */
function appSource(name) {
  return `import SwiftUI

@main
struct ${name}App: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`
}

/**
 * The generated starter view, with accessibility identifiers for the UI tools.
 *
 * @returns {string} the Swift source.
 */
function viewSource() {
  return `import SwiftUI

struct ContentView: View {
    @State private var count = 0

    var body: some View {
        VStack(spacing: 20) {
            Text("Hello from iOS")
                .font(.largeTitle)
            Text("Count: \\(count)")
                .font(.title2)
                .accessibilityIdentifier("countLabel")
            Button("Increment") {
                count += 1
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("incrementButton")
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
`
}

/**
 * The generated `project.pbxproj`, identical in shape to the original plugin's.
 *
 * @param {string} name - the target name.
 * @param {string} bundle - the bundle identifier.
 * @param {string} deployment - the iOS deployment target.
 * @returns {string} the project file.
 */
function pbx(name, bundle, deployment) {
  return `// !$*UTF8*$!
{
  archiveVersion = 1;
  classes = {};
  objectVersion = 56;
  objects = {
    ${IDS[0]} = {isa = PBXBuildFile; fileRef = ${IDS[1]}; };
    ${IDS[2]} = {isa = PBXBuildFile; fileRef = ${IDS[3]}; };
    ${IDS[1]} = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${name}App.swift; sourceTree = "<group>"; };
    ${IDS[3]} = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ContentView.swift; sourceTree = "<group>"; };
    ${IDS[4]} = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = ${name}.app; sourceTree = BUILT_PRODUCTS_DIR; };
    ${IDS[5]} = {
      isa = PBXGroup;
      children = (${IDS[6]}, ${IDS[7]});
      sourceTree = "<group>";
    };
    ${IDS[6]} = {
      isa = PBXGroup;
      children = (${IDS[1]}, ${IDS[3]});
      path = ${name};
      sourceTree = "<group>";
    };
    ${IDS[7]} = {
      isa = PBXGroup;
      children = (${IDS[4]});
      name = Products;
      sourceTree = "<group>";
    };
    ${IDS[8]} = {
      isa = PBXNativeTarget;
      buildConfigurationList = ${IDS[9]};
      buildPhases = (${IDS[10]});
      buildRules = ();
      dependencies = ();
      name = ${name};
      productName = ${name};
      productReference = ${IDS[4]};
      productType = "com.apple.product-type.application";
    };
    ${IDS[10]} = {
      isa = PBXSourcesBuildPhase;
      buildActionMask = 2147483647;
      files = (${IDS[0]}, ${IDS[2]});
      runOnlyForDeploymentPostprocessing = 0;
    };
    ${IDS[11]} = {
      isa = PBXProject;
      attributes = {BuildIndependentTargetsInParallel = 1; LastSwiftUpdateCheck = 1500; LastUpgradeCheck = 1500; TargetAttributes = {${IDS[8]} = {CreatedOnToolsVersion = 15.0;};};};
      buildConfigurationList = ${IDS[12]};
      compatibilityVersion = "Xcode 14.0";
      developmentRegion = en;
      hasScannedForEncodings = 0;
      knownRegions = (en, Base);
      mainGroup = ${IDS[5]};
      productRefGroup = ${IDS[7]};
      projectDirPath = "";
      projectRoot = "";
      targets = (${IDS[8]});
    };
    ${IDS[13]} = {isa = XCBuildConfiguration; buildSettings = {ALWAYS_SEARCH_USER_PATHS = NO; CLANG_ENABLE_MODULES = YES; CLANG_ENABLE_OBJC_ARC = YES; CLANG_WARN_BLOCK_CAPTURE_AUTORELEASING = YES; CLANG_WARN_BOOL_CONVERSION = YES; CLANG_WARN_COMMA = YES; CLANG_WARN_CONSTANT_CONVERSION = YES; CLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS = YES; CLANG_WARN_DIRECT_OBJC_ISA_USAGE = YES_ERROR; CLANG_WARN_DOCUMENTATION_COMMENTS = YES; CLANG_WARN_EMPTY_BODY = YES; CLANG_WARN_ENUM_CONVERSION = YES; CLANG_WARN_INFINITE_RECURSION = YES; CLANG_WARN_INT_CONVERSION = YES; CLANG_WARN_NON_LITERAL_NULL_CONVERSION = YES; CLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF = YES; CLANG_WARN_OBJC_LITERAL_CONVERSION = YES; CLANG_WARN_OBJC_ROOT_CLASS = YES_ERROR; CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = YES; CLANG_WARN_RANGE_LOOP_ANALYSIS = YES; CLANG_WARN_STRICT_PROTOTYPES = YES; CLANG_WARN_SUSPICIOUS_MOVE = YES; CLANG_WARN_UNGUARDED_AVAILABILITY = YES_AGGRESSIVE; CLANG_WARN_UNREACHABLE_CODE = YES; COPY_PHASE_STRIP = NO; DEBUG_INFORMATION_FORMAT = dwarf; ENABLE_STRICT_OBJC_MSGSEND = YES; ENABLE_TESTABILITY = YES; GCC_C_LANGUAGE_STANDARD = gnu17; GCC_DYNAMIC_NO_PIC = NO; GCC_NO_COMMON_BLOCKS = YES; GCC_OPTIMIZATION_LEVEL = 0; GCC_PREPROCESSOR_DEFINITIONS = ("DEBUG=1", "$(inherited)"); GCC_WARN_64_TO_32_BIT_CONVERSION = YES; GCC_WARN_ABOUT_RETURN_TYPE = YES_ERROR; GCC_WARN_UNDECLARED_SELECTOR = YES; GCC_WARN_UNINITIALIZED_AUTOS = YES_AGGRESSIVE; GCC_WARN_UNUSED_FUNCTION = YES; GCC_WARN_UNUSED_VARIABLE = YES; IPHONEOS_DEPLOYMENT_TARGET = ${deployment}; MTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE; MTL_FAST_MATH = YES; ONLY_ACTIVE_ARCH = YES; SDKROOT = iphoneos; SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG; SWIFT_OPTIMIZATION_LEVEL = "-Onone";}; name = Debug; };
    ${IDS[14]} = {isa = XCBuildConfiguration; buildSettings = {ALWAYS_SEARCH_USER_PATHS = NO; CLANG_ENABLE_MODULES = YES; CLANG_ENABLE_OBJC_ARC = YES; COPY_PHASE_STRIP = NO; DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym"; ENABLE_NS_ASSERTIONS = NO; GCC_C_LANGUAGE_STANDARD = gnu17; IPHONEOS_DEPLOYMENT_TARGET = ${deployment}; MTL_ENABLE_DEBUG_INFO = NO; MTL_FAST_MATH = YES; SDKROOT = iphoneos; SWIFT_COMPILATION_MODE = wholemodule; SWIFT_OPTIMIZATION_LEVEL = "-O"; VALIDATE_PRODUCT = YES;}; name = Release; };
    ${IDS[15]} = {isa = XCBuildConfiguration; buildSettings = {ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; DEVELOPMENT_ASSET_PATHS = ""; DEVELOPMENT_TEAM = ""; ENABLE_PREVIEWS = YES; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES; INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents = YES; INFOPLIST_KEY_UILaunchScreen_Generation = YES; INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"; INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"; MARKETING_VERSION = 1.0; PRODUCT_BUNDLE_IDENTIFIER = ${bundle}; PRODUCT_NAME = "$(TARGET_NAME)"; SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"; SUPPORTS_MACCATALYST = NO; SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = NO; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = "1,2";}; name = Debug; };
    ${IDS[16]} = {isa = XCBuildConfiguration; buildSettings = {ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; DEVELOPMENT_ASSET_PATHS = ""; DEVELOPMENT_TEAM = ""; ENABLE_PREVIEWS = YES; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES; INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents = YES; INFOPLIST_KEY_UILaunchScreen_Generation = YES; INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"; INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"; MARKETING_VERSION = 1.0; PRODUCT_BUNDLE_IDENTIFIER = ${bundle}; PRODUCT_NAME = "$(TARGET_NAME)"; SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"; SUPPORTS_MACCATALYST = NO; SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = NO; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = "1,2";}; name = Release; };
    ${IDS[12]} = {isa = XCConfigurationList; buildConfigurations = (${IDS[13]}, ${IDS[14]}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
    ${IDS[9]} = {isa = XCConfigurationList; buildConfigurations = (${IDS[15]}, ${IDS[16]}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
  };
  rootObject = ${IDS[11]};
}
`
}
