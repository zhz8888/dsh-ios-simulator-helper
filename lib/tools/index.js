import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRuntime } from '../runtime.js'
import { imageContent, textContent, toLosslessJson } from '../util/content.js'
import { inside, readablePath } from '../util/path.js'
import * as buildProvider from '../providers/build.js'
import * as logsProvider from '../providers/logs.js'
import * as preflightProvider from '../providers/preflight.js'
import * as projectProvider from '../providers/project.js'
import * as screenshotProvider from '../providers/screenshot.js'
import * as simProvider from '../providers/sim.js'
import * as uiProvider from '../providers/ui.js'

/**
 * The plugin's model-facing tool surface.
 *
 * Every tool from the ZCode plugin is preserved under its original name and
 * argument names, so a workflow written against the `ios_simulator` MCP server
 * keeps working against this one — with two harness-level changes applied
 * uniformly:
 *
 *   - each call builds a {@link createRuntime} from the session workspace and
 *     the live settings, instead of reading `process.cwd()`/`process.env`;
 *   - each tool declares both the argument schema and the result schema, so the
 *     registry validates what the model sent and what the body returned.
 *
 * The two schemas are the contract rather than documentation: `defineTool`
 * infers the argument type from the parameter schema and the result type from
 * the output schema, so a body that reads an argument the schema does not
 * declare, or returns a result the schema does not describe, does not compile.
 *
 * One tool is new: `ios_shutdown_simulator`, because the original could boot a
 * simulator but never stop one.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/tools
 */

/**
 * @typedef {import('@deepseek-ai/dsh-tools').ParameterSchemaSpec} ParameterSchemaSpec
 * @typedef {import('@deepseek-ai/dsh-tools').ValueSchemaSpec} ValueSchemaSpec
 * @typedef {import('@deepseek-ai/cordis').Context} PluginContext
 * @typedef {import('../runtime.js').Runtime} Runtime
 * @typedef {import('../runtime.js').ToolRunContext} ToolRunContext
 * @typedef {import('../runtime.js').HostLogger} HostLogger
 * @typedef {import('../util/content.js').ImageAttachmentRef} ImageAttachmentRef
 */

/**
 * The target arguments every simulator tool shares.
 *
 * The literal types matter: `defineTool` infers the argument object from the
 * parameter schema, and a `type` that widened to `string` would no longer
 * describe a parameter at all.
 *
 * @typedef {{
 *   udid: {type: 'string', description: string},
 *   device: {type: 'string', description: string},
 *   runtime: {type: 'string', description: string},
 * }} TargetParameters
 */

/**
 * The build arguments every build tool shares.
 *
 * @typedef {TargetParameters & {
 *   project: {type: 'string', description: string},
 *   workspace: {type: 'string', description: string},
 *   scheme: {type: 'string', description: string},
 *   configuration: {type: 'string', description: string},
 *   derivedDataPath: {type: 'string', description: string},
 *   bundleId: {type: 'string', description: string},
 *   openSimulator: {type: 'boolean', description: string},
 *   timeoutMs: {type: 'integer', description: string},
 * }} BuildParameters
 */

/** Shared target arguments: which simulator to act on. */
/** @type {TargetParameters} */
const TARGET = {
  udid: {
    type: 'string',
    description: 'Simulator UDID. When omitted, the plugin uses a booted simulator or the configured default device.',
  },
  device: { type: 'string', description: 'Simulator device name fragment, for example iPhone 17.' },
  runtime: { type: 'string', description: 'Runtime name fragment, for example iOS-27.' },
}

/** Shared build arguments. */
/** @type {BuildParameters} */
const BUILD = {
  ...TARGET,
  project: { type: 'string', description: 'Path of a .xcodeproj as a path relative to the session workspace.' },
  workspace: { type: 'string', description: 'Path of a .xcworkspace as a path relative to the session workspace.' },
  scheme: { type: 'string', description: 'Xcode scheme. Automatically selected when it can be discovered.' },
  configuration: { type: 'string', description: 'Xcode configuration. Defaults to the plugin setting (Debug).' },
  derivedDataPath: {
    type: 'string',
    description: 'DerivedData path relative to the session workspace. Defaults to the plugin data directory.',
  },
  bundleId: {
    type: 'string',
    description: 'Bundle id override used when the build settings cannot resolve PRODUCT_BUNDLE_IDENTIFIER.',
  },
  openSimulator: { type: 'boolean', description: 'Open the macOS Simulator app for this build.' },
  timeoutMs: {
    type: 'integer',
    description: 'Build timeout in milliseconds. Defaults to the build timeout setting, which is stored in seconds.',
  },
}

/** An array-of-strings argument, as the original plugin's `launchArgs`. */
/** @type {{type: 'array', items: {type: 'string'}, description: string}} */
const LAUNCH_ARGS = { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the launched process.' }

/** Buttons accepted by `ios_ui_button`. */
const BUTTONS = [...uiProvider.UI_BUTTONS]

/**
 * A result schema for an open JSON object.
 *
 * `additionalProperties` is mandatory in the value schema, and an open object
 * is the honest description of every tool result here: the fields a tool
 * declares are the ones it always answers with, and the registry still checks
 * their types.
 *
 * @type {{type: 'object', additionalProperties: true}}
 */
const OPEN_OBJECT = { type: 'object', additionalProperties: true }

/**
 * Register every tool on the calling context.
 *
 * @param {PluginContext} ctx - the plugin context; must carry `tools`.
 * @param {{config: Record<string, unknown>, logger: HostLogger}} plugin - live config and host logger.
 * @returns {Array<() => void>} disposers, one per registered tool.
 */
export function registerTools(ctx, { config, logger }) {
  /** @type {Array<() => void>} */
  const disposers = []
  /**
   * Register one tool definition and remember its disposer.
   *
   * `defineTool` compiles the two schemas into the registry's contract and
   * validates them at runtime; the definition it receives is built by
   * {@link jsonTool}, which is where those schemas are declared.
   *
   * @param {any} definition - the tool definition to register.
   */
  const register = (definition) => {
    disposers.push(ctx.tools.register(defineTool(definition)))
  }

  /**
   * Build one JSON-valued tool's definition.
   *
   * The body is wrapped so that the runtime is built from the session
   * workspace and the live settings, and so that every failure names the tool
   * that failed. The result is projected into the harness' lossless-JSON
   * domain on the one path every tool result travels.
   *
   * The definition is *built* here and *applied* by the caller, because
   * `defineTool` infers the argument and result types from the two schemas,
   * and it can only do that where the schemas are concrete: inferring them
   * from an unresolved type parameter is what the type checker refuses to do.
   *
   * @template {ParameterSchemaSpec} S
   * @template {ValueSchemaSpec} O
   * @param {{
   *   name: string,
   *   description: string,
   *   parameters: S,
   *   output: O,
   *   render?: (args: import('@deepseek-ai/dsh-tools').InferArgs<S>, value: import('@deepseek-ai/dsh-tools').InferValue<O>)
   *     => import('../util/content.js').ContentBlock[],
   *   run: (rt: Runtime, args: import('@deepseek-ai/dsh-tools').InferArgs<S>, exec: ToolRunContext)
   *     => import('@deepseek-ai/dsh-tools').InferValue<O> | Promise<import('@deepseek-ai/dsh-tools').InferValue<O>>,
   * }} spec - the tool's name, schemas and body.
   * @returns {object} the tool definition, ready for `defineTool`.
   */
  const jsonTool = ({ name, description, parameters, output, render, run }) => ({
    name,
    description,
    parameters,
    output: {
      schema: output,
      render:
        render ??
        ((
          /** @type {import('@deepseek-ai/dsh-tools').InferArgs<S>} */ _args,
          /** @type {import('@deepseek-ai/dsh-tools').InferValue<O>} */ value,
        ) => textContent(value)),
    },
    execute: async (
      /** @type {import('@deepseek-ai/dsh-tools').InferArgs<S>} */ args,
      /** @type {ToolRunContext} */ exec,
    ) => {
      const rt = createRuntime({ config, exec, logger })
      try {
        const value = await run(rt, args, exec)
        // The projection normalizes the provider's value into the
        // lossless-JSON domain; the schema is what says the result is the
        // right shape, and the registry checks it against the schema.
        return /** @type {import('@deepseek-ai/dsh-tools').InferValue<O>} */ (toLosslessJson(value))
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`${name}: ${detail}`)
      }
    },
  })

  register(jsonTool({
    name: 'ios_preflight',
    description:
      'Check whether the host is macOS, whether full Xcode, xcrun simctl, simulator runtimes, simulator devices and an optional UI backend are available, and echo the current plugin settings.',
    parameters: {},
    output: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        supported: { type: 'boolean' },
        platform: { type: 'string' },
        arch: { type: 'string' },
        requiredPlatform: { type: 'string' },
        requiredPlatformLabel: { type: 'string' },
        checks: { type: 'array', items: OPEN_OBJECT },
        settings: OPEN_OBJECT,
        note: { type: 'string' },
      },
      additionalProperties: true,
    },
    run: (rt) => preflightProvider.preflight(rt),
  }))

  register(jsonTool({
    name: 'ios_list_simulators',
    description: 'List the iOS/iPadOS simulators visible to xcrun simctl.',
    parameters: {},
    output: {
      type: 'object',
      properties: {
        simulators: { type: 'array', items: OPEN_OBJECT },
        runtimes: { type: 'array', items: OPEN_OBJECT },
      },
      additionalProperties: true,
    },
    // Wrapped in an object: every tool here declares an object result schema, so
    // the registry rejects a bare array as invalid output.
    run: async (rt) => ({ simulators: await simProvider.list(rt), runtimes: await simProvider.listRuntimes(rt).catch(() => []) }),
  }))

  register(jsonTool({
    name: 'ios_boot_simulator',
    description: 'Boot the selected simulator and optionally open the macOS Simulator window.',
    parameters: { ...TARGET, openSimulator: { type: 'boolean', description: 'Open the Simulator app after booting.' } },
    output: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        udid: { type: 'string' },
        state: { type: 'string' },
        runtime: { type: 'string' },
        available: { type: 'boolean' },
        opened: { type: 'boolean' },
        openWarning: { type: 'string' },
      },
      additionalProperties: true,
    },
    run: (rt, args) =>
      simProvider.boot(rt, {
        udid: args.udid,
        name: args.device,
        runtime: args.runtime,
        open: args.openSimulator ?? rt.settings.autoOpenSimulator,
      }),
  }))

  register(jsonTool({
    name: 'ios_show_simulator',
    description: 'Open the macOS Simulator app and optionally focus a specific UDID.',
    parameters: { udid: { type: 'string', description: 'Simulator UDID to focus.' } },
    output: {
      type: 'object',
      properties: {
        opened: { type: 'boolean' },
        udid: { type: 'string' },
        app: { type: 'string' },
      },
      additionalProperties: true,
    },
    run: (rt, args) => simProvider.show(rt, args.udid),
  }))

  register(jsonTool({
    name: 'ios_shutdown_simulator',
    description:
      'Shut the selected simulator down (simctl shutdown). Added by this plugin: the original tool set could boot a simulator but never stop one.',
    parameters: { ...TARGET },
    output: {
      type: 'object',
      properties: {
        shutdown: { type: 'boolean' },
        wasBooted: { type: 'boolean' },
        alreadyShutdown: { type: 'boolean' },
        simulator: OPEN_OBJECT,
        output: { type: 'string' },
      },
      additionalProperties: true,
    },
    run: (rt, args) => simProvider.shutdown(rt, args),
  }))

  register(jsonTool({
    name: 'ios_discover_project',
    description: 'Find .xcodeproj/.xcworkspace files, schemes, and bundle identifiers in the session workspace.',
    parameters: {
      dir: { type: 'string', description: 'Directory to search relative to the session workspace. Defaults to the workspace root.' },
    },
    output: {
      type: 'object',
      properties: {
        projects: { type: 'array', items: { type: 'string' } },
        workspaces: { type: 'array', items: { type: 'string' } },
        schemes: { type: 'array', items: { type: 'string' } },
        bundleIds: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: true,
    },
    run: (rt, args) => projectProvider.discover(rt, args.dir ? inside(rt.cwd, args.dir) : rt.cwd),
  }))

  register(jsonTool({
    name: 'ios_create_app',
    description:
      'Create a minimal SwiftUI iOS app and Xcode project in the session workspace. Refuses to overwrite generated files unless overwrite is true.',
    parameters: {
      name: { type: 'string', required: true, description: 'App name; letters and digits are kept.' },
      bundleId: { type: 'string', description: 'Dotted bundle identifier, for example com.example.demo.' },
      dir: { type: 'string', description: 'Target directory relative to the session workspace.' },
      deployment: { type: 'string', description: 'iOS deployment target, for example 17.0.' },
      overwrite: { type: 'boolean', description: 'Replace existing generated files. Defaults to false.' },
    },
    output: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        scheme: { type: 'string' },
        bundle: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: true,
    },
    run: (rt, args) => projectProvider.create(rt, args),
  }))

  register(jsonTool({
    name: 'ios_build_app',
    description: 'Build the current or specified Xcode project for the iOS Simulator with xcodebuild.',
    parameters: BUILD,
    output: {
      type: 'object',
      properties: {
        built: { type: 'boolean' },
        app: { type: 'string' },
        bundleId: { type: 'string' },
        configuration: { type: 'string' },
        scheme: { type: 'string' },
        project: { type: 'string' },
        workspace: { type: 'string' },
        target: { type: 'string' },
        sdk: { type: 'string' },
        destination: { type: 'string' },
        log: { type: 'string' },
        output: { type: 'string' },
        error: { type: 'string' },
      },
      additionalProperties: true,
    },
    run: (rt, args) => buildProvider.app(rt, args),
  }))

  register(jsonTool({
    name: 'ios_build_and_run',
    description: 'Build the iOS app, install it, launch it, and show it in the macOS Simulator.',
    parameters: { ...BUILD, launchArgs: LAUNCH_ARGS },
    output: {
      type: 'object',
      properties: {
        built: { type: 'boolean' },
        app: { type: 'string' },
        bundleId: { type: 'string' },
        configuration: { type: 'string' },
        scheme: { type: 'string' },
        project: { type: 'string' },
        workspace: { type: 'string' },
        target: { type: 'string' },
        sdk: { type: 'string' },
        destination: { type: 'string' },
        log: { type: 'string' },
        output: { type: 'string' },
        error: { type: 'string' },
        installed: { type: 'json' },
        launched: { type: 'json' },
      },
      additionalProperties: true,
    },
    run: (rt, args) => buildProvider.runApp(rt, args),
  }))

  register(jsonTool({
    name: 'ios_install_app',
    description: 'Install an .app bundle on the selected simulator.',
    parameters: {
      ...TARGET,
      appPath: { type: 'string', required: true, description: '.app bundle path relative to the workspace, or absolute.' },
    },
    output: {
      type: 'object',
      properties: {
        simulator: OPEN_OBJECT,
        installed: { type: 'boolean' },
        udid: { type: 'string' },
        app: { type: 'string' },
      },
      additionalProperties: true,
    },
    run: async (rt, args) => {
      // Refuse an unusable path before resolving a target: `boot` can start a
      // simulator, and a call that is going to be refused must not start one.
      const app = readablePath(rt.cwd, args.appPath)
      const sim = await simProvider.boot(rt, { udid: args.udid, name: args.device, runtime: args.runtime })
      return { simulator: sim, ...(await simProvider.install(rt, sim.udid, app)) }
    },
  }))

  register(jsonTool({
    name: 'ios_launch_app',
    description: 'Launch an installed app on the selected simulator by bundle id.',
    parameters: { ...TARGET, bundleId: { type: 'string', required: true, description: 'Bundle identifier.' }, launchArgs: LAUNCH_ARGS },
    output: {
      type: 'object',
      properties: {
        simulator: OPEN_OBJECT,
        launched: { type: 'boolean' },
        udid: { type: 'string' },
        bundle: { type: 'string' },
        launchArgs: { type: 'array', items: { type: 'string' } },
        output: { type: 'string' },
      },
      additionalProperties: true,
    },
    run: async (rt, args) => {
      const sim = await simProvider.boot(rt, {
        udid: args.udid,
        name: args.device,
        runtime: args.runtime,
        open: rt.settings.autoOpenSimulator,
      })
      return { simulator: sim, ...(await simProvider.launch(rt, sim.udid, args.bundleId, args.launchArgs ?? [])) }
    },
  }))

  register(jsonTool({
    name: 'ios_terminate_app',
    description: 'Terminate an installed app on the selected simulator by bundle id.',
    parameters: { ...TARGET, bundleId: { type: 'string', required: true, description: 'Bundle identifier.' } },
    output: {
      type: 'object',
      properties: {
        simulator: OPEN_OBJECT,
        terminated: { type: 'boolean' },
        udid: { type: 'string' },
        bundle: { type: 'string' },
      },
      additionalProperties: true,
    },
    run: async (rt, args) => {
      const sim = await simProvider.boot(rt, { udid: args.udid, name: args.device, runtime: args.runtime })
      return { simulator: sim, ...(await simProvider.terminate(rt, sim.udid, args.bundleId)) }
    },
  }))

  register(jsonTool({
    name: 'ios_open_url',
    description: 'Open a URL in the selected simulator.',
    parameters: { ...TARGET, url: { type: 'string', required: true, description: 'Absolute URL with a scheme.' } },
    output: {
      type: 'object',
      properties: {
        simulator: OPEN_OBJECT,
        opened: { type: 'boolean' },
        udid: { type: 'string' },
        url: { type: 'string' },
      },
      additionalProperties: true,
    },
    run: async (rt, args) => {
      const sim = await simProvider.boot(rt, {
        udid: args.udid,
        name: args.device,
        runtime: args.runtime,
        open: rt.settings.autoOpenSimulator,
      })
      return { simulator: sim, ...(await simProvider.openUrl(rt, sim.udid, args.url)) }
    },
  }))

  register(jsonTool({
    name: 'ios_screenshot',
    description:
      'Capture a PNG screenshot from the selected simulator, save it to disk, and return it as an image when the current model accepts image input.',
    parameters: {
      ...TARGET,
      path: {
        type: 'string',
        description: 'Output path relative to the session workspace; defaults under the plugin data directory.',
      },
      openSimulator: { type: 'boolean', description: 'Open the Simulator app before capturing.' },
    },
    output: {
      type: 'object',
      properties: {
        simulator: OPEN_OBJECT,
        path: { type: 'string' },
        absolutePath: { type: 'string' },
        bytes: { type: 'integer' },
        mediaType: { type: 'string' },
        attachment: OPEN_OBJECT,
        imageUnavailable: { type: 'string' },
      },
      additionalProperties: true,
    },
    render: (_args, value) =>
      value.attachment === undefined
        ? textContent(value)
        : imageContent(value, /** @type {ImageAttachmentRef} */ (/** @type {unknown} */ (value.attachment))),
    run: async (rt, args, exec) => {
      const shot = await screenshotProvider.shot(rt, args)
      const value = {
        simulator: shot.simulator,
        path: shot.path,
        absolutePath: shot.absolutePath,
        bytes: shot.bytes,
        mediaType: 'image/png',
      }
      const admitted = await admitImage(rt, ctx, exec, shot.data)
      if (!admitted.ok) return { ...value, imageUnavailable: admitted.reason }
      // The reference is an opaque handle the attachment service owns; the
      // schema describes it as an object, and the service is the only thing
      // that can read it.
      return {
        ...value,
        attachment: /** @type {Record<string, import('@deepseek-ai/dsh-util-values').JsonValue>} */ (
          /** @type {unknown} */ (admitted.attachment)
        ),
      }
    },
  }))

  register(jsonTool({
    name: 'ios_logs',
    description: 'Read recent simulator logs, optionally filtered by bundle id.',
    parameters: {
      ...TARGET,
      bundleId: { type: 'string', description: 'Filter lines by this bundle id, or by its process name.' },
      seconds: { type: 'integer', description: 'How many recent seconds to read. Defaults to the plugin setting, max 3600.' },
      limit: { type: 'integer', description: 'Maximum characters of rendered output.' },
    },
    output: {
      type: 'object',
      properties: {
        simulator: OPEN_OBJECT,
        seconds: { type: 'integer' },
        bundleId: { type: 'json' },
        limit: { type: 'integer' },
        characters: { type: 'integer' },
        truncated: { type: 'boolean' },
        output: { type: 'string' },
      },
      additionalProperties: true,
    },
    run: (rt, args) => logsProvider.logs(rt, args),
  }))

  register(jsonTool({
    name: 'ios_ui_status',
    description:
      'Report whether the optional UI automation backend is available, and which backend the plugin setting selected.',
    parameters: {},
    output: {
      type: 'object',
      properties: {
        backend: { type: 'string' },
        available: { type: 'boolean' },
        setting: { type: 'string' },
        binary: { type: 'string' },
        reservedBackends: { type: 'array', items: { type: 'string' } },
        detail: { type: 'string' },
      },
      additionalProperties: true,
    },
    run: (rt) => uiProvider.status(rt),
  }))

  register(jsonTool({
    name: 'ios_ui_tap',
    description: 'Tap screen coordinates using the optional idb UI backend.',
    parameters: {
      x: { type: 'number', required: true, description: 'Screen x in pixels.' },
      y: { type: 'number', required: true, description: 'Screen y in pixels.' },
      duration: { type: 'number', description: 'Press duration in seconds.' },
    },
    output: UI_ACTION_OUTPUT,
    run: (rt, args) => uiProvider.tap(rt, args),
  }))

  register(jsonTool({
    name: 'ios_ui_swipe',
    description: 'Swipe between screen coordinates using the optional idb UI backend.',
    parameters: {
      x1: { type: 'number', required: true, description: 'Start x in pixels.' },
      y1: { type: 'number', required: true, description: 'Start y in pixels.' },
      x2: { type: 'number', required: true, description: 'End x in pixels.' },
      y2: { type: 'number', required: true, description: 'End y in pixels.' },
      delta: { type: 'number', description: 'Swipe duration in seconds.' },
    },
    output: UI_ACTION_OUTPUT,
    run: (rt, args) => uiProvider.swipe(rt, args),
  }))

  register(jsonTool({
    name: 'ios_ui_type_text',
    description: 'Enter text into the currently focused control using the optional idb UI backend.',
    parameters: { text: { type: 'string', required: true, description: 'Text to type.' } },
    output: UI_ACTION_OUTPUT,
    run: (rt, args) => uiProvider.typeText(rt, args),
  }))

  register(jsonTool({
    name: 'ios_ui_button',
    description: `Press one of ${BUTTONS.join(', ')} using the optional idb UI backend.`,
    parameters: {
      button: { type: 'string', required: true, enum: BUTTONS, description: 'Hardware button to press.' },
      duration: { type: 'number', description: 'Hold duration in seconds.' },
    },
    output: UI_ACTION_OUTPUT,
    run: (rt, args) => uiProvider.button(rt, args),
  }))

  register(jsonTool({
    name: 'ios_ui_describe',
    description: 'Return accessibility information for the current screen using the optional idb UI backend.',
    parameters: { ...TARGET },
    output: UI_ACTION_OUTPUT,
    run: (rt, args) => uiProvider.describe(rt, args),
  }))

  return disposers
}

/**
 * The result schema every UI action shares.
 *
 * @type {{
 *   type: 'object',
 *   properties: {
 *     backend: {type: 'string', description?: string},
 *     udid: {type: 'string', description?: string},
 *     output: {type: 'string', description?: string},
 *   },
 *   additionalProperties: true,
 * }}
 */
const UI_ACTION_OUTPUT = {
  type: 'object',
  properties: {
    backend: { type: 'string' },
    udid: { type: 'string' },
    output: { type: 'string' },
  },
  additionalProperties: true,
}

/**
 * Store a screenshot as a durable image attachment.
 *
 * The harness only accepts an image block that references the attachment
 * store, so the base64 payload is committed here rather than placed in the
 * tool's canonical value. Every refusal degrades to a text-only result that
 * still names the PNG on disk: a screenshot the model cannot see is still
 * useful to the user, and a missing attachments service must not fail the call.
 *
 * @param {Runtime} rt - the call runtime.
 * @param {PluginContext} ctx - the plugin context.
 * @param {ToolRunContext} exec - the tool execution record.
 * @param {string} data - base64 PNG bytes.
 * @returns {Promise<{ok: true, attachment: ImageAttachmentRef} | {ok: false, reason: string}>} the admission outcome.
 */
async function admitImage(rt, ctx, exec, data) {
  const attachments = ctx.get?.('attachments')
  if (attachments === undefined || typeof attachments.saveImages !== 'function') {
    return { ok: false, reason: 'this deployment stores no attachments, so the image was only written to disk' }
  }
  const model = exec?.agent?.options?.model
  const provider = exec?.agent?.options?.provider
  const llm = ctx.get?.('llm')
  if (llm !== undefined && model !== undefined && provider !== undefined) {
    try {
      const info = await llm.resolveModelInfo(provider, model, exec.signal)
      if (Array.isArray(info?.inputModalities) && !info.inputModalities.includes('image')) {
        return { ok: false, reason: `model "${model}" does not declare image input` }
      }
    } catch (error) {
      rt.logger.warn(`ios_screenshot: could not verify image input support: ${message(error)}`)
    }
  }
  try {
    const [attachment] = await attachments.saveImages([
      { data: Buffer.from(data, 'base64'), mediaType: 'image/png', name: 'ios-screenshot.png' },
    ])
    return attachment === undefined
      ? { ok: false, reason: 'the attachment store returned no reference' }
      : { ok: true, attachment }
  } catch (error) {
    return { ok: false, reason: `image admission refused the screenshot: ${message(error)}` }
  }
}

/**
 * Error message of an arbitrary thrown value.
 *
 * @param {unknown} error - the thrown value.
 * @returns {string} its message.
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
