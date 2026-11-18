import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config, SETTINGS_NAMESPACE } from './settings.js'
import { MESSAGES } from './i18n.js'
import { createRuntime } from './runtime.js'
import { hostInfo } from './providers/host.js'
import { inventory, preflight } from './providers/preflight.js'
import { registerTools } from './tools/index.js'

/**
 * @typedef {import('@deepseek-ai/cordis').Context} PluginContext
 * @typedef {import('@deepseek-ai/dsh-settings')} SettingsService
 * @typedef {import('@deepseek-ai/dsh-skill')} SkillService
 * @typedef {import('@deepseek-ai/dsh-commands')} CommandService
 * @typedef {import('@deepseek-ai/dsh-client-connection')} ConnectionService
 * @typedef {import('./runtime.js').Runtime} Runtime
 * @typedef {import('./runtime.js').HostLogger} HostLogger
 * @typedef {import('./providers/preflight.js').PreflightReport} PreflightReport
 * @typedef {import('./providers/preflight.js').PreflightCheck} PreflightCheck
 */

/**
 * One row of the web server's index-injection table.
 *
 * The web server renders each row into the document head ahead of the
 * application bundle. A `global` row becomes a script that assigns the value
 * to a name on `globalThis`, which is how the configuration page's copy
 * reaches the browser without a request.
 *
 * @typedef {object} IndexInjectionRow
 * @property {'global'} kind - the row kind this plugin publishes.
 * @property {string} name - the name the value is published under.
 * @property {unknown} value - the value itself.
 */

/**
 * The plugin context, with the index-injection event.
 *
 * The event is not part of the harness' `Events` map, so the intersection is
 * what lets the listener be typed at all.
 *
 * @typedef {PluginContext & {on: (name: 'webserver/index-inject', listener: (table: IndexInjectionRow[]) => void) => (() => void)}} WebServerContext
 */

/**
 * Host half of `@zhz8888/dsh-ios-simulator-helper`.
 *
 * One Cordis entry contributes five things, each behind its own optional
 * service so a deployment that lacks it still loads the rest:
 *
 *   - 21 model-facing `ios_*` tools on `ctx.tools`;
 *   - the embedded `ios-dev` skill on `ctx.skills`;
 *   - an `/ios-dev` command on `ctx.commands`;
 *   - three exact Fetch routes on `ctx.connection` that back the plugin's
 *     configuration page (`/host` answers the macOS question without spawning
 *     anything, `/status` runs the full diagnostic, `/inventory` discovers
 *     devices and runtimes);
 *   - the "this plugin renders its own configuration page" policy on `ctx.settings`.
 *
 * @module @zhz8888/dsh-ios-simulator-helper
 */

/** Cordis plugin name; matches the `dsh.name` field and the patch row id. */
export const name = 'ios-simulator-helper'

/**
 * Required services.
 *
 * Only `tools` is listed. `skills`, `commands`, `connection` and `settings` are
 * optional services reached through `ctx.inject` instead: an unresolved entry in
 * this array leaves the whole plugin pending forever, which would take the
 * session down over a missing convenience feature.
 */
export const inject = ['tools']

export { Config, SETTINGS_NAMESPACE }

/** Directory holding the plugin's bundled skill. */
const SKILL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ios-dev')

/** Route prefix owned by this plugin; every path is registered under `/api`. */
const ROUTE_PREFIX = '/api/ios-simulator-helper'

/**
 * The page-initialization global the configuration page's copy is published
 * under.
 *
 * The web server renders every `kind: 'global'` row of its index-injection
 * table as a script in the document head, ahead of the plugin bundle, so the
 * browser half can read the copy synchronously at module scope.
 */
export const LOCALE_GLOBAL = '__DSH_IOS_SIMULATOR_HELPER_LOCALE__'

/**
 * Mount the plugin.
 *
 * @param {PluginContext} ctx - the host plugin context.
 * @param {Record<string, unknown>} config - the entry's live configuration.
 */
export function apply(ctx, config) {
  const logger = ctx.logger ?? silentLogger
  // `ctx.tools.register` already returns a disposer bound to this fiber, so the
  // tools need no extra effect wrapper: disposing the entry unregisters them.
  registerTools(ctx, { config, logger })
  configureAutoPage(ctx)
  registerSkill(ctx, logger)
  registerCommand(ctx, { config, logger })
  registerRoutes(ctx, { config, logger })
  registerLocaleInjection(ctx)
}

/**
 * Publish the configuration page's copy to the browser.
 *
 * The copy is **not** a Fetch route, and that is deliberate. A route is
 * asynchronous by construction, so the page would draw raw keys until the
 * answer landed and would need a subscription to repaint - machinery this data
 * does not justify, because the dictionaries are static and known at mount
 * time. The injected global is in place before the bundle runs, so the first
 * render is already correct and the bundle registers its dictionaries with the
 * shell's locale service once, complete.
 *
 * The listener is registered unconditionally rather than behind
 * `ctx.inject(['webServer'])`: the event is emitted by the web server itself,
 * so a deployment without one never emits it and the listener is simply never
 * called. That keeps the copy available to a shell that renders its own index
 * without exposing a `webServer` service.
 *
 * @param {PluginContext} ctx - the host plugin context.
 */
function registerLocaleInjection(ctx) {
  const wctx = /** @type {WebServerContext} */ (ctx)
  // `ctx.on` registers the listener on this fiber, so disposing the entry
  // removes it; no extra effect wrapper is needed.
  wctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: LOCALE_GLOBAL, value: MESSAGES })
  })
}

/**
 * Tell the settings service this plugin renders its own configuration page.
 *
 * `autoGenerate` defaults to true, and a client that generates pages from the
 * schema would otherwise show a second, redundant form for this entry. The
 * policy must be registered from a child of the settings service so a
 * late-mounted or replaced service still adopts it, and the plugin keeps
 * working when the service is absent.
 *
 * @param {PluginContext} ctx - the host plugin context.
 */
function configureAutoPage(ctx) {
  ctx.inject(['settings'], (sctx) => {
    if (typeof sctx.settings?.configure !== 'function') return
    sctx.effect(
      () => sctx.settings.configure({ auto: false }, ctx.fiber),
      'ios-simulator-helper: configuration page policy',
    )
  })
}

/**
 * Contribute the bundled `ios-dev` skill.
 *
 * The body is read from the package at mount time and registered as an embedded
 * runtime skill, with the skill directory as its resource base.
 *
 * @param {PluginContext} ctx - the host plugin context.
 * @param {HostLogger} logger - host logger.
 */
function registerSkill(ctx, logger) {
  ctx.inject(['skills'], (sctx) => {
    return sctx.effect(() => {
      let loaded
      try {
        loaded = loadSkillFiles()
      } catch (error) {
        logger.warn(`ios-simulator-helper: could not read the bundled skill: ${message(error)}`)
        return () => {}
      }
      return sctx.skills.register({
        name: loaded.name,
        description: loaded.description,
        ...(loaded.whenToUse === undefined ? {} : { whenToUse: loaded.whenToUse }),
        content: loaded.content,
        // A skill contributed by a running plugin has no discovery source; the
        // registry leaves the field as it was given, and `runtime` is the value
        // its own source vocabulary reserves for exactly this case.
        source: 'runtime',
        resourceBase: { kind: 'directory', path: SKILL_DIR },
      })
    }, 'ios-simulator-helper: ios-dev skill')
  })
}

/**
 * Read and parse the bundled skill synchronously into memory.
 *
 * @returns {{name: string, description: string, whenToUse?: string, content: string}} the skill definition.
 * @throws When the SKILL.md is missing or has no usable description.
 */
function loadSkillFiles() {
  const raw = readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8')
  const { front, body } = splitFrontmatter(raw)
  const description = front.description
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new Error('skills/ios-dev/SKILL.md has no description in its frontmatter')
  }
  return {
    name: typeof front.name === 'string' && front.name.trim().length > 0 ? front.name.trim() : 'ios-dev',
    description: description.trim(),
    ...(typeof front.whenToUse === 'string' && front.whenToUse.trim().length > 0
      ? { whenToUse: front.whenToUse.trim() }
      : {}),
    content: body.trim(),
  }
}

/**
 * Split YAML frontmatter from a Markdown body without a YAML dependency.
 *
 * The skill frontmatter is a flat map of single-line scalars, so a full parser
 * would be dead weight; anything more complex is left in the body untouched.
 *
 * @param {string} raw - the file contents.
 * @returns {{front: Record<string, string>, body: string}} the parsed parts.
 */
export function splitFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return { front: {}, body: raw }
  /** @type {Record<string, string>} */
  const front = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim())
    if (!pair) continue
    let value = (pair[2] ?? '').trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    front[pair[1] ?? ''] = value
  }
  return { front, body: raw.slice(match[0].length) }
}

/**
 * Contribute the `/ios-dev` command.
 *
 * The original ZCode command injected a prompt into the model's conversation.
 * DSH commands deliberately never create a model message, so this command does
 * the one thing that is useful without the model: it runs the diagnostic and
 * reports the verdict plus the suggested next step. On a non-macOS host that
 * verdict is the macOS-only refusal, which is the first thing a user needs.
 *
 * @param {PluginContext} ctx - the host plugin context.
 * @param {{config: Record<string, unknown>, logger: HostLogger}} plugin - live config and logger.
 */
function registerCommand(ctx, { config, logger }) {
  ctx.inject(['commands'], (cctx) => {
    cctx.effect(
      () =>
        cctx.commands.register({
          name: 'ios-dev',
          description: 'Run the iOS Simulator environment diagnostic and print the next step',
          // The composer reads `input.hint`, so the placeholder is an object
          // with a `hint` key rather than a bare string.
          input: { hint: '[goal, e.g. "build and screenshot the app"]' },
          handler: async ({ rawInput }) => {
            const rt = createRuntime({ config, exec: undefined, logger })
            try {
              const report = await preflight(rt)
              return { kind: report.supported ? 'success' : 'error', text: renderCommandReport(report, String(rawInput ?? '').trim()) }
            } catch (error) {
              return { kind: 'error', text: `ios_preflight failed: ${message(error)}` }
            }
          },
        }),
      'ios-simulator-helper: ios-dev command',
    )
  })
}

/**
 * Render the `/ios-dev` output: the failing checks first, then the goal.
 *
 * @param {PreflightReport} report - the preflight report.
 * @param {string} goal - the raw command input.
 * @returns {string} the user-facing text.
 */
export function renderCommandReport(report, goal) {
  const failed = report.checks.filter((check) => !check.ok)
  const lines = [
    report.supported
      ? report.ok
        ? 'iOS Simulator environment: ready.'
        : `iOS Simulator environment: not ready (${failed.length} check(s) failed).`
      : `iOS Simulator environment: unsupported host (${report.platform}). This plugin only supports ${report.requiredPlatformLabel}.`,
  ]
  if (report.note) lines.push('', report.note)
  lines.push('', ...report.checks.map((check) => `${check.ok ? '[ok]  ' : '[FAIL]'} ${check.name}`))
  for (const check of failed) {
    lines.push('', `--- ${check.name} ---`, check.detail, check.fix ? `Fix: ${check.fix}` : '')
  }
  lines.push(
    '',
    report.supported
      ? goal.length > 0
        ? `Next: ask the agent to ${goal} — it will use the ios-dev skill and the ios_* tools.`
        : 'Next: ask the agent to build and run the iOS app — it will use the ios-dev skill and the ios_* tools.'
      : `Next: run DSH on ${report.requiredPlatformLabel} with full Xcode installed. No ios_* tool can work on this host.`,
    "Environment values are edited on this plugin's page in the Plugins panel (Plugins → Installed plugins → iOS Simulator Helper).",
  )
  return lines.filter((line) => line !== undefined).join('\n')
}

/**
 * Contribute the three exact Fetch routes the configuration page calls.
 *
 * `connection.fetch.register` is the harness' sanctioned way for a plugin to
 * answer a same-origin browser request; the request passes the Host/Origin
 * fence and browser authentication before reaching the handler. The optional
 * `connection` service is reached through `ctx.inject`, so a deployment without
 * it simply loses the buttons and the host verdict rather than failing to boot.
 *
 * @param {PluginContext} ctx - the host plugin context.
 * @param {{config: Record<string, unknown>, logger: HostLogger}} plugin - live config and logger.
 */
function registerRoutes(ctx, { config, logger }) {
  ctx.inject(['connection'], (cctx) => {
    const register = cctx.connection?.fetch?.register
    if (typeof register !== 'function') {
      logger.warn(
        'ios-simulator-helper: this deployment exposes no exact Fetch route registry; the configuration page will show no diagnostics',
      )
      return
    }
    // One exact Fetch route.
    //
    // `runtime` is a factory rather than a value, and that is deliberate on
    // both counts. A route that reads no setting must not pay for building a
    // runtime at all, so `/host` never asks for one. And a runtime that
    // cannot be built - a live reference that throws - must still answer with
    // a JSON body instead of rejecting the request, because the configuration
    // page fetches these routes and renders whatever comes back.
    const route = (
      /** @type {string} */ path,
      /** @type {(runtime: () => Runtime) => unknown | Promise<unknown>} */ work,
    ) =>
      cctx.effect(
        () =>
          register({
            path: `${ROUTE_PREFIX}/${path}`,
            methods: ['GET'],
            requestBody: 'buffered',
            fetch: async () => {
              try {
                return jsonResponse(200, await work(() => createRuntime({ config, exec: undefined, logger })))
              } catch (error) {
                return jsonResponse(500, { error: message(error) })
              }
            },
          }),
        `ios-simulator-helper: ${path} route`,
      )

    // `/host` answers the macOS question with no subprocess at all, so the
    // configuration page can show the "only supports macOS" notice immediately.
    // It reads no setting, so it never asks for a runtime.
    route('host', () => ({ ...hostInfo(), plugin: SETTINGS_NAMESPACE, node: process.version }))
    route('status', (runtime) => preflight(runtime()))
    route('inventory', (runtime) => inventory(runtime()))
  })
}

/**
 * Build a JSON Fetch response.
 *
 * @param {number} status - HTTP status.
 * @param {unknown} body - the JSON payload.
 * @returns {Response} the response.
 */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Logger used when the composition provides none. */
const silentLogger = {
  info() {},
  warn() {},
  error() {},
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
