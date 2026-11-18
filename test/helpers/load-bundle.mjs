import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Load the browser bundle exactly the way the DSH web shell does.
 *
 * Shared by the test suite and `scripts/check-bundle.mjs`. The shell injects a
 * `window.__ModuleLoader__` facade and evaluates the bundle as a classic
 * script, so this reproduces that: a `window` stand-in, the shell's static
 * module table as the only resolvable `require`, and the factory invoked with
 * the same `require`.
 *
 * @module test/helpers/load-bundle
 */

/** Package root, derived from this file's location. */
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The shell's frozen platform seed table, as extracted from the built SPA.
 * Nothing outside this list may be `require`d by a client bundle unless it is
 * declared in `dsh.client.external` and provided by another plugin's row.
 */
export const STATIC_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** A permissive stand-in for a required module: used only to execute the factory. */
export function stubModule(extra = {}) {
  return new Proxy(extra, {
    get(target, key) {
      if (key in target) return target[key]
      if (typeof key !== 'string') return undefined
      return /^[A-Z]/.test(key) ? (props) => ({ type: key, props }) : () => undefined
    },
  })
}

/**
 * The page-initialization globals a real page carries.
 *
 * The host half publishes the plugin's copy under this name, and the web server
 * renders it into the document head ahead of the bundle. A test that loads the
 * bundle therefore has to install it too, or the page renders its dictionary
 * keys.
 *
 * @returns {Record<string, unknown>} the globals to install around the factory.
 */
export function pageGlobals() {
  const read = (language) => {
    const file = path.join(ROOT, 'locale', `${language}.json`)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const settings = parsed?.settings
    assert.ok(settings && typeof settings === 'object', `${file} declares no settings object`)
    return settings
  }
  return { __DSH_IOS_SIMULATOR_HELPER_LOCALE__: { en: read('en'), zh: read('zh') } }
}

/**
 * Evaluate `lib/client.js` and return the registration plus the module exports.
 *
 * @param {{resolve?: (specifier: string) => unknown, globals?: Record<string, unknown>}} [options] - module resolver override and the globals to install around the factory.
 * @returns {{registration: {id: string, factory: Function}, exported: object, required: string[]}} the outcome.
 */
export function loadBundle(options = {}) {
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const required = []
  let registration
  const resolve =
    options.resolve ??
    ((specifier) => {
      assert.ok(
        STATIC_MODULES.includes(specifier),
        `client bundle required "${specifier}", which is not in the shell's static module table`,
      )
      return stubModule({
        useId: () => 'id',
        useRef: (value) => ({ current: value }),
        useCallback: (fn) => fn,
        useState: (value) => [value, () => {}],
        useMemo: (fn) => fn(),
        useEffect: () => {},
        createElement: () => null,
        Fragment: 'Fragment',
      })
    })
  const require = (specifier) => {
    required.push(specifier)
    return resolve(specifier)
  }
  const window = {
    __ModuleLoader__: {
      load(entry) {
        registration = entry
      },
    },
  }
  // A classic script, not a module: no import/export, and `return` is not top-level.
  const run = new Function('window', 'require', `${source}\nreturn undefined`)
  run(window, require)
  assert.ok(registration, 'the bundle did not call window.__ModuleLoader__.load')
  // The globals are installed around the FACTORY call, not around `run`: the
  // factory body is the bundle's module scope, which is where the copy is read.
  const globals = options.globals ?? {}
  const installed = Object.keys(globals)
  for (const name of installed) globalThis[name] = globals[name]
  try {
    return { registration, exported: registration.factory(require), required }
  } finally {
    for (const name of installed) delete globalThis[name]
  }
}
