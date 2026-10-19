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
 * One tool is new: `ios_shutdown_simulator`, because the original could boot a
 * simulator but never stop one.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/tools
 */

/** Shared target arguments: which simulator to act on. */
const TARGET = {
  udid: {
    type: 'string',
    description: 'Simulator UDID. When omitted, the plugin uses a booted simulator or the configured default device.',
  },
  device: { type: 'string', description: 'Simulator device name fragment, for example iPhone 17.' },
  runtime: { type: 'string', description: 'Runtime name fragment, for example iOS-27.' },
}

/** Shared build arguments. */
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

/** A result schema that accepts any JSON object. */
const ANY_OBJECT = { type: 'object', additionalProperties: true }

/** An array-of-strings argument, as the original plugin's `launchArgs`. */
const LAUNCH_ARGS = { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the launched process.' }

/** Buttons accepted by `ios_ui_button`. */
const BUTTONS = [...uiProvider.UI_BUTTONS]

/**
 * Register every tool on the calling context.
 *
 * @param {object} ctx - the plugin context; must carry `tools`.
 * @param {{config: Record<string, unknown>, logger: object}} plugin - live config and host logger.
 * @returns {Array<() => void>} disposers, one per registered tool.
 */
export function registerTools(ctx, { config, logger }) {
  const disposers = []
  const register = (definition) => {
    disposers.push(ctx.tools.register(defineTool(definition)))
  }

  /**
   * Wrap one provider call: build the runtime, run it, render the JSON result.
   *
   * @param {string} name - tool name, for the error prefix.
   * @param {(rt: object, args: object, exec: object) => Promise<unknown>} work - the provider call.
   * @returns {(args: object, exec: object) => Promise<object>} the tool body.
   */
  const body = (name, work) => async (args, exec) => {
    const rt = createRuntime({ config, exec, logger })
    try {
      // The registry snapshots the returned value as lossless JSON and rejects
      // `undefined`, so normalization happens here, on the one path every
      // result takes, rather than in each provider.
      return toLosslessJson(await work(rt, args ?? {}, exec))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`${name}: ${detail}`)
    }
  }

  /** Define one JSON-valued tool. */
  const jsonTool = ({ name, description, parameters, run }) => {
    register({
      name,
      description,
      parameters,
      output: { schema: ANY_OBJECT, render: (_args, value) => textContent(value) },
      execute: body(name, run),
    })
  }

  /** Define one device-targeted tool: adds {@link TARGET} to the parameters. */
  const targetTool = (spec) => jsonTool({ ...spec, parameters: { ...TARGET, ...(spec.parameters ?? {}) } })

  jsonTool({
    name: 'ios_preflight',
    description:
      'Check whether the host is macOS, whether full Xcode, xcrun simctl, simulator runtimes, simulator devices and an optional UI backend are available, and echo the current plugin settings.',
    parameters: {},
    run: (rt) => preflightProvider.preflight(rt),
  })

  jsonTool({
    name: 'ios_list_simulators',
    description: 'List the iOS/iPadOS simulators visible to xcrun simctl.',
    parameters: {},
    // Wrapped in an object: every tool here declares an object result schema, so
    // the registry rejects a bare array as invalid output.
    run: async (rt) => ({ simulators: await simProvider.list(rt), runtimes: await simProvider.listRuntimes(rt).catch(() => []) }),
  })

  jsonTool({
    name: 'ios_boot_simulator',
    description: 'Boot the selected simulator and optionally open the macOS Simulator window.',
    parameters: { ...TARGET, openSimulator: { type: 'boolean', description: 'Open the Simulator app after booting.' } },
    run: (rt, args) =>
      simProvider.boot(rt, {
        udid: args.udid,
        name: args.device,
        runtime: args.runtime,
        open: args.openSimulator ?? rt.settings.autoOpenSimulator,
      }),
  })

  jsonTool({
    name: 'ios_show_simulator',
    description: 'Open the macOS Simulator app and optionally focus a specific UDID.',
    parameters: { udid: { type: 'string', description: 'Simulator UDID to focus.' } },
    run: (rt, args) => simProvider.show(rt, args.udid),
  })

  targetTool({
    name: 'ios_shutdown_simulator',
    description:
      'Shut the selected simulator down (simctl shutdown). Added by this plugin: the original tool set could boot a simulator but never stop one.',
    run: (rt, args) => simProvider.shutdown(rt, args),
  })

  jsonTool({
    name: 'ios_discover_project',
    description: 'Find .xcodeproj/.xcworkspace files, schemes, and bundle identifiers in the session workspace.',
    parameters: {
      dir: { type: 'string', description: 'Directory to search relative to the session workspace. Defaults to the workspace root.' },
    },
    run: (rt, args) => projectProvider.discover(rt, args.dir ? inside(rt.cwd, args.dir) : rt.cwd),
  })

  jsonTool({
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
    run: (rt, args) => projectProvider.create(rt, args),
  })

  jsonTool({
    name: 'ios_build_app',
    description: 'Build the current or specified Xcode project for the iOS Simulator with xcodebuild.',
    parameters: BUILD,
    run: (rt, args) => buildProvider.app(rt, args),
  })

  jsonTool({
    name: 'ios_build_and_run',
    description: 'Build the iOS app, install it, launch it, and show it in the macOS Simulator.',
    parameters: { ...BUILD, launchArgs: LAUNCH_ARGS },
    run: (rt, args) => buildProvider.runApp(rt, args),
  })

  jsonTool({
    name: 'ios_install_app',
    description: 'Install an .app bundle on the selected simulator.',
    parameters: {
      ...TARGET,
      appPath: { type: 'string', required: true, description: '.app bundle path relative to the workspace, or absolute.' },
    },
    run: async (rt, args) => {
      // Refuse an unusable path before resolving a target: `boot` can start a
      // simulator, and a call that is going to be refused must not start one.
      const app = readablePath(rt.cwd, args.appPath)
      const sim = await simProvider.boot(rt, { udid: args.udid, name: args.device, runtime: args.runtime })
      return { simulator: sim, ...(await simProvider.install(rt, sim.udid, app)) }
    },
  })

  jsonTool({
    name: 'ios_launch_app',
    description: 'Launch an installed app on the selected simulator by bundle id.',
    parameters: { ...TARGET, bundleId: { type: 'string', required: true, description: 'Bundle identifier.' }, launchArgs: LAUNCH_ARGS },
    run: async (rt, args) => {
      const sim = await simProvider.boot(rt, {
        udid: args.udid,
        name: args.device,
        runtime: args.runtime,
        open: rt.settings.autoOpenSimulator,
      })
      return { simulator: sim, ...(await simProvider.launch(rt, sim.udid, args.bundleId, args.launchArgs ?? [])) }
    },
  })

  jsonTool({
    name: 'ios_terminate_app',
    description: 'Terminate an installed app on the selected simulator by bundle id.',
    parameters: { ...TARGET, bundleId: { type: 'string', required: true, description: 'Bundle identifier.' } },
    run: async (rt, args) => {
      const sim = await simProvider.boot(rt, { udid: args.udid, name: args.device, runtime: args.runtime })
      return { simulator: sim, ...(await simProvider.terminate(rt, sim.udid, args.bundleId)) }
    },
  })

  jsonTool({
    name: 'ios_open_url',
    description: 'Open a URL in the selected simulator.',
    parameters: { ...TARGET, url: { type: 'string', required: true, description: 'Absolute URL with a scheme.' } },
    run: async (rt, args) => {
      const sim = await simProvider.boot(rt, {
        udid: args.udid,
        name: args.device,
        runtime: args.runtime,
        open: rt.settings.autoOpenSimulator,
      })
      return { simulator: sim, ...(await simProvider.openUrl(rt, sim.udid, args.url)) }
    },
  })

  register({
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
      schema: ANY_OBJECT,
      render: (_args, value) =>
        value.attachment === undefined ? textContent(value) : imageContent(value, value.attachment),
    },
    execute: body('ios_screenshot', async (rt, args, exec) => {
      const shot = await screenshotProvider.shot(rt, args)
      const value = {
        simulator: shot.simulator,
        path: shot.path,
        absolutePath: shot.absolutePath,
        bytes: shot.bytes,
        mediaType: 'image/png',
      }
      const admitted = await admitImage(rt, ctx, exec, shot.data)
      return admitted.ok ? { ...value, attachment: admitted.attachment } : { ...value, imageUnavailable: admitted.reason }
    }),
  })

  targetTool({
    name: 'ios_logs',
    description: 'Read recent simulator logs, optionally filtered by bundle id.',
    parameters: {
      bundleId: { type: 'string', description: 'Filter lines by this bundle id, or by its process name.' },
      seconds: { type: 'integer', description: 'How many recent seconds to read. Defaults to the plugin setting, max 3600.' },
      limit: { type: 'integer', description: 'Maximum characters of rendered output.' },
    },
    run: (rt, args) => logsProvider.logs(rt, args),
  })

  jsonTool({
    name: 'ios_ui_status',
    description:
      'Report whether the optional UI automation backend is available, and which backend the plugin setting selected.',
    parameters: {},
    run: (rt) => uiProvider.status(rt),
  })

  targetTool({
    name: 'ios_ui_tap',
    description: 'Tap screen coordinates using the optional idb UI backend.',
    parameters: {
      x: { type: 'number', required: true, description: 'Screen x in pixels.' },
      y: { type: 'number', required: true, description: 'Screen y in pixels.' },
      duration: { type: 'number', description: 'Press duration in seconds.' },
    },
    run: (rt, args) => uiProvider.tap(rt, args),
  })

  targetTool({
    name: 'ios_ui_swipe',
    description: 'Swipe between screen coordinates using the optional idb UI backend.',
    parameters: {
      x1: { type: 'number', required: true, description: 'Start x in pixels.' },
      y1: { type: 'number', required: true, description: 'Start y in pixels.' },
      x2: { type: 'number', required: true, description: 'End x in pixels.' },
      y2: { type: 'number', required: true, description: 'End y in pixels.' },
      delta: { type: 'number', description: 'Swipe duration in seconds.' },
    },
    run: (rt, args) => uiProvider.swipe(rt, args),
  })

  targetTool({
    name: 'ios_ui_type_text',
    description: 'Enter text into the currently focused control using the optional idb UI backend.',
    parameters: { text: { type: 'string', required: true, description: 'Text to type.' } },
    run: (rt, args) => uiProvider.typeText(rt, args),
  })

  targetTool({
    name: 'ios_ui_button',
    description: `Press one of ${BUTTONS.join(', ')} using the optional idb UI backend.`,
    parameters: {
      button: { type: 'string', required: true, enum: BUTTONS, description: 'Hardware button to press.' },
      duration: { type: 'number', description: 'Hold duration in seconds.' },
    },
    run: (rt, args) => uiProvider.button(rt, args),
  })

  targetTool({
    name: 'ios_ui_describe',
    description: 'Return accessibility information for the current screen using the optional idb UI backend.',
    run: (rt, args) => uiProvider.describe(rt, args),
  })

  return disposers
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
 * @param {object} rt - the call runtime.
 * @param {object} ctx - the plugin context.
 * @param {object} exec - the tool execution record.
 * @param {string} data - base64 PNG bytes.
 * @returns {Promise<{ok: true, attachment: unknown}|{ok: false, reason: string}>} the admission outcome.
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

/** Error message of an arbitrary thrown value. */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
