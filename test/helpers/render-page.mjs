#!/usr/bin/env node
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as primitives from './primitives-double.mjs'
import { loadBundle, pageGlobals, ROOT } from './load-bundle.mjs'

/**
 * Render the plugin's Plugins-page configuration form and print a JSON report.
 *
 * React is real (`react-dom/server`, so hooks and the element tree are the real
 * thing); the primitives are the double documented in `primitives-double.mjs`,
 * because the shipped ones are a browser bundler input. Run through
 * `test/client-render.test.js`.
 *
 * The page is rendered once per host, because the macOS question is answered
 * from `navigator` synchronously: a macOS browser must show no warning, while a
 * Linux browser must show the "only supports macOS" notice before any request
 * is made. The third run removes `navigator` entirely, which must produce the
 * "could not be determined" line and no warning — an unknown host must not be
 * reported as an unsupported one.
 *
 * The report also carries the dictionaries the bundle registered and the keys
 * its source asks for, so the test can check every key the page uses against
 * the dictionary that answers it — not only the generated `field.` and `group.`
 * keys a rendered markup would show.
 */

const report = {
  failures: [],
  variants: {},
  toast: null,
  placements: null,
  summary: null,
  registered: null,
  unserved: null,
  fieldKeys: [],
  fieldLabels: [],
  injectKeys: [],
  hostApi: {},
  discoveryApi: {},
  dictionaryKeys: { en: [], zh: [] },
  usedKeys: [],
}

/**
 * The last toast the page rendered, and how often it rendered one.
 *
 * The primitives' `Toast` double owns no timers, so nothing in this process can
 * let its hold expire. The wrapper below records the completion callback the
 * page handed the toast, and the driver calls that callback to model the toast
 * finishing — the same way the real `Toast` reports completion.
 */
const toast = { onDone: undefined, renders: 0 }

/** The primitives, with the toast recorder in front of the double's `Toast`. */
const primitivesWithToast = {
  ...primitives,
  Toast: (props) => {
    toast.onDone = props.onDone
    toast.renders += 1
    return primitives.Toast(props)
  },
}

/** The values the fake host serves, matching the plugin's declared defaults. */
const LIVE_VALUES = {
  defaultDevice: 'iPhone 17',
  defaultRuntime: '',
  autoBootSimulator: true,
  exclusiveSimulator: true,
  autoOpenSimulator: true,
  bootTimeoutSeconds: 120,
  uiBackend: 'auto',
  idbBinary: 'idb',
  uiTimeoutSeconds: 60,
  defaultConfiguration: 'Debug',
  buildTimeoutSeconds: 600,
  extraBuildArgs: '',
  derivedDataDir: '',
  disableCodeSigning: true,
  logSeconds: 120,
  logLimit: 20000,
  dataDir: '',
  screenshotDir: '',
}

/** Browser `navigator` stand-ins, one per host scenario. */
const NAVIGATORS = {
  macos: {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    userAgentData: { platform: 'macOS' },
  },
  linux: {
    platform: 'Linux x86_64',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    userAgentData: { platform: 'Linux' },
  },
  windows: {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    userAgentData: { platform: 'Windows' },
  },
  unknown: undefined,
}

/** Replace the global `navigator` for one scenario. */
function setNavigator(value) {
  if (value === undefined) {
    Reflect.deleteProperty(globalThis, 'navigator')
    return
  }
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
}

/** A snapshot-store stand-in with the shape `SettingsFormModel` subscribes to. */
function snapshotStore(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** The shared config form the host would serve for this namespace. */
function fakeConfigForm() {
  const store = snapshotStore({
    status: 'ready',
    value: { ...LIVE_VALUES },
    base: { ...LIVE_VALUES },
    user: { bootTimeoutSeconds: 120 },
    revision: 3,
    writable: true,
    mode: 'host',
  })
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    set: async () => true,
    unset: async () => true,
    mutate: async () => true,
  }
}

/**
 * The Cordis-like browser context the bundle's `apply` expects.
 *
 * @param {{served?: boolean}} [options] - `served: false` models a host that
 *   does not serve the settings namespace: `whileServed` then never calls back.
 * @returns {{ctx: object, registered: object}} the context and its registration record.
 */
function fakeContext(options = {}) {
  const served = options.served ?? true
  const form = fakeConfigForm()
  const registered = { component: undefined, options: undefined, slots: [], dictionaries: [] }
  const dictionaries = () => registered.dictionaries.at(-1)?.dictionaries
  const ctx = {
    configForms: {
      get: () => form,
      describe: () => ({
        getSnapshot: () => ({ view: { namespaces: [{ ns: 'ios-simulator-helper' }], writable: true } }),
      }),
      whileServed: (namespaces, register) => {
        if (!served) return () => {}
        const disposer = register(new Set(namespaces))
        return typeof disposer === 'function' ? disposer : () => {}
      },
    },
    locale: {
      register: (ns, value) => {
        registered.dictionaries.push({ ns, dictionaries: value })
        return () => {}
      },
      bind:
        () =>
        (key, params) => {
          const template = dictionaries()?.en?.[key] ?? key
          return params === undefined
            ? template
            : template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
        },
      getSnapshot: () => ({ revision: 1 }),
      subscribe: () => () => {},
    },
    slots: {
      inject: (name, callback) => {
        registered.slots.push(name)
        return callback()
      },
      register: (options, component) => {
        registered.options = options
        registered.component = component
        return () => {}
      },
      getVersion: () => 1,
      entries: () => [],
      subscribe: () => () => {},
    },
    effect: (callback) => {
      const disposer = callback()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    get: () => undefined,
    logger: { info() {}, warn() {}, error() {} },
  }
  return { ctx, registered }
}

/**
 * Project an `inject()` face into component props the way the slot renderer
 * does: an entry in `hooks` named `foo` becomes a `useFoo(selector)` prop, and
 * the rest of the face is spread through as business props. The real renderer
 * builds those hooks on `useSyncExternalStore`; a server render observes one
 * snapshot, so reading it directly is equivalent here.
 */
function faceToProps(face) {
  const hooks = {}
  for (const [key, store] of Object.entries(face.hooks ?? {})) {
    const name = `use${key.charAt(0).toUpperCase()}${key.slice(1)}`
    hooks[name] = (selector) => selector(store.getSnapshot())
  }
  const { hooks: _hooks, ...rest } = face
  void _hooks
  return { ...hooks, ...rest }
}

const { ctx, registered } = fakeContext()
const { exported } = loadBundle({
  resolve: (specifier) => {
    if (specifier === 'react') return React
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitivesWithToast
    throw new Error(`unexpected require in the render test: ${specifier}`)
  },
  globals: pageGlobals(),
})

report.fieldKeys = (exported.FIELD_META ?? []).map((field) => field.key)
// The labels live in the locale files now, so they are read from there rather
// than from an export: the export carries the field's shape, not its copy.
const dictionary = pageGlobals().__DSH_IOS_SIMULATOR_HELPER_LOCALE__.en
report.fieldLabels = report.fieldKeys.map((key) => dictionary[`field.${key}`]).filter(Boolean)

try {
  exported.apply(ctx)
} catch (error) {
  report.failures.push(`apply() threw: ${error.message}`)
}

// The dictionaries the bundle registered, and every key its source asks for.
// A key the dictionary does not answer is what the harness locale renders as
// the key itself, so the pair is what the test checks.
const registeredDictionaries = registered.dictionaries.at(-1)?.dictionaries ?? {}
report.dictionaryKeys = {
  en: Object.keys(registeredDictionaries.en ?? {}).sort(),
  zh: Object.keys(registeredDictionaries.zh ?? {}).sort(),
}
report.usedKeys = [...new Set(
  [...readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8').matchAll(/\bt\(\s*(['"])([^'"]+)\1/g)]
    .map((match) => match[2]),
)].sort()

// ── the pure host-check logic, independent of the render ────────────────────
try {
  const api = exported.HOST_API
  report.hostApi = {
    macos: api.detectClientPlatform(NAVIGATORS.macos),
    linux: api.detectClientPlatform(NAVIGATORS.linux),
    windows: api.detectClientPlatform(NAVIGATORS.windows),
    none: api.detectClientPlatform(undefined),
    hostWins: api.hostVerdict(api.detectClientPlatform(NAVIGATORS.macos), {
      supported: false,
      platform: 'linux',
      label: 'Linux',
      requiredPlatformLabel: 'macOS',
    }),
    browserWins: api.hostVerdict(api.detectClientPlatform(NAVIGATORS.linux), undefined),
    unknown: api.hostVerdict(api.detectClientPlatform(undefined), undefined),
    requiredPlatform: api.requiredPlatform,
  }
} catch (error) {
  report.failures.push(`HOST_API threw: ${error.message}`)
}

// ── the discovery dropdowns' option builders, independent of the render ─────
// A server render never fetches the inventory, so the option lists a
// discovery dropdown offers are asserted through the builders themselves.
try {
  const api = exported.DISCOVERY_API
  report.discoveryApi = {
    devices: api.deviceOptions([
      { name: 'iPhone 18 Pro', state: 'Shutdown', available: true },
      { name: 'iPhone 17e', state: 'Shutdown', available: true },
      { name: 'iPhone 18 Pro', state: 'Booted', available: true },
      { name: 'Broken Device', state: 'Shutdown', available: false },
    ]),
    runtimes: api.runtimeOptions([
      { name: 'iOS 27.1', identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-1', available: true },
      { name: 'iOS 27.0', identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0', available: true },
      { name: 'iOS 27.10', identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-10', available: true },
      { name: 'iOS 18.0', identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-0', available: false },
    ]),
    fragment: api.runtimeFragment('com.apple.CoreSimulator.SimRuntime.iOS-27-1'),
    // The wiring the page itself uses: one inventory answer in, one option list
    // per discovery source out. A server render never fetches the inventory, so
    // this is what proves the dropdowns are fed by the route rather than by a
    // list written into the bundle.
    suggestions: api.buildSuggestions({
      simulators: [
        { name: 'iPhone 18 Pro', state: 'Shutdown', available: true },
        { name: 'Gone Device', state: 'Shutdown', available: false },
      ],
      runtimes: [
        { name: 'iOS 27.1', identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-1', available: true },
      ],
    }),
    suggestionsEmpty: api.buildSuggestions(undefined),
    suggestionsUnsupported: api.buildSuggestions({ supported: false }),
    keepsStoredValue: api.discoveryOptions('iPhone 99', [
      { value: 'iPhone 18 Pro', label: 'iPhone 18 Pro', found: true },
    ]),
    emptyValue: api.discoveryOptions('', [
      { value: 'iOS-27-1', label: 'iOS 27.1', found: true },
    ]),
    // Nothing is known while the host has not answered, so nothing is marked.
    unknownList: api.discoveryOptions('iPhone 18 Pro', undefined),
    // A fragment the host still answers to is a working setting, not a
    // missing one: the picker matches a device whose name contains it.
    fragmentStillResolves: api.discoveryOptions('iPad mini', [
      { value: 'iPad mini (A17 Pro)', label: 'iPad mini (A17 Pro)', found: true },
    ]),
    fragmentGone: api.discoveryOptions('iPad Air', [
      { value: 'iPhone 18 Pro', label: 'iPhone 18 Pro', found: true },
    ]),
    // The marker's text is the locale's, punctuation included, so the value is
    // interpolated into it rather than concatenated onto it.
    markerLabel: api.discoveryOptionLabel(
      { key: 'defaultDevice' },
      { value: 'iPhone 99', label: 'iPhone 99', found: false },
      (key, values) =>
        String(pageGlobals().__DSH_IOS_SIMULATOR_HELPER_LOCALE__.en[key] ?? key).replace(
          /\{(\w+)\}/g,
          (_, name) => String(values?.[name] ?? ''),
        ),
    ),
    unsetLabel: api.discoveryOptionLabel(
      { key: 'defaultDevice' },
      { value: '', label: '', found: true },
      (key) => String(pageGlobals().__DSH_IOS_SIMULATOR_HELPER_LOCALE__.en[key] ?? key),
    ),
  }
} catch (error) {
  report.failures.push(`DISCOVERY_API threw: ${error.message}`)
}

// A host that does not serve the namespace must render no trace of the form.
const unserved = fakeContext({ served: false })
try {
  exported.apply(unserved.ctx)
} catch (error) {
  report.failures.push(`apply() threw without a served namespace: ${error.message}`)
}
report.unserved = {
  component: unserved.registered.component !== undefined,
  slots: [...new Set(unserved.registered.slots)],
}

if (registered.component === undefined) {
  report.failures.push('apply() registered no plugin-page configuration component')
} else {
  const { component, options } = registered

  // The row's own page keys a row's configuration by the package name and the
  // row id, and draws the title, icon and crumb itself — so the entry carries
  // neither the settings navigation's label nor its order.
  for (const [key, expected] of [
    ['name', 'plugins.row.config'],
    ['key', '@zhz8888/dsh-ios-simulator-helper#ios-simulator-helper'],
    ['locale', 'settings.iosSimulatorHelper'],
  ]) {
    if (options[key] !== expected) {
      report.failures.push(`slot option ${key}=${JSON.stringify(options[key])} (want ${JSON.stringify(expected)})`)
    }
  }
  if (options.label !== undefined) report.failures.push('the row\'s page draws its own title; the entry must not register a label')

  let props
  try {
    props = { t: ctx.locale.bind(options.locale), view: 'page', ...faceToProps(options.inject()) }
  } catch (error) {
    report.failures.push(`inject() threw: ${error.message}`)
  }

  if (props !== undefined) {
    report.injectKeys = Object.keys(props).sort()
    // The row's page asks for a one-line summary as well as the form, and the
    // two views must not change the hook count: a summary answered above the
    // hooks would throw "Rendered more hooks" the moment one instance rendered
    // both. Rendering the summary here is what pins that.
    try {
      report.summary = renderToStaticMarkup(React.createElement(component, { ...props, view: 'summary' }))
    } catch (error) {
      report.failures.push(`summary render threw: ${error.stack ?? error.message}`)
    }
    for (const [name, navigatorStub] of Object.entries(NAVIGATORS)) {
      setNavigator(navigatorStub)
      try {
        report.variants[name] = renderToStaticMarkup(React.createElement(component, props))
      } catch (error) {
        report.failures.push(`render (${name}) threw: ${error.stack ?? error.message}`)
        report.variants[name] = ''
      }
    }
    setNavigator(NAVIGATORS.macos)
    report.registered = { slot: options.name, key: options.key, locale: options.locale, slots: [...new Set(registered.slots)] }

    // The staged-form states the action bar reacts to. A server render observes one
    // snapshot, so each state is produced by driving the real model and rendering
    // again: a draft its spec refuses, a valid one, then a set of drafts that all
    // spell the value already in effect — a switch flipped back, a text field
    // retyped as it was, and a profile override left untouched.
    try {
      props.edit('bootTimeoutSeconds', 'soon')
      report.variants.macosInvalid = renderToStaticMarkup(React.createElement(component, props))
      props.edit('bootTimeoutSeconds', '90')
      report.variants.macosDirty = renderToStaticMarkup(React.createElement(component, props))
      props.discard()
      props.edit('autoBootSimulator', 'true')
      props.edit('defaultDevice', 'iPhone 17')
      props.edit('bootTimeoutSeconds', '120')
      report.variants.macosReverted = renderToStaticMarkup(React.createElement(component, props))
      props.discard()
      // A pending reset is a pending change. The fixture's only override carries
      // the value its base already holds, so the reset stages that base value as
      // its text — the one draft whose text reads as "no change" while the model
      // still holds the `unset` the reset means.
      props.resetField('bootTimeoutSeconds')
      report.variants.macosReset = renderToStaticMarkup(React.createElement(component, props))
      props.discard()
      // The browser half refuses a draft the host's declared range rejects,
      // although the schema itself would accept the number: staging 7200 seconds
      // in the 3600-second log window and a zero timeout must leave both drafts
      // invalid and the save blocked.
      props.edit('logSeconds', '7200')
      props.edit('bootTimeoutSeconds', '0')
      report.variants.macosOutOfRange = renderToStaticMarkup(React.createElement(component, props))
      // An in-range number must still be accepted, so the refusal above is what
      // the range buys and not a blanket refusal of every number draft.
      props.discard()
      props.edit('logSeconds', '1800')
      report.variants.macosRangeValid = renderToStaticMarkup(React.createElement(component, props))
      // A clear on a field the user layer does not override is still a pending
      // change: the model plans the unset, the field is visibly empty, and the
      // bar has to offer the save and the discard.
      props.discard()
      props.edit('defaultDevice', '')
      report.variants.macosCleared = renderToStaticMarkup(React.createElement(component, props))
      props.discard()
      // A write in flight: the model stays in its saving state until the write
      // settles, and the bar's own status line is the message the dictionary
      // carries.
      props.edit('bootTimeoutSeconds', '90')
      props.save()
      report.variants.macosSaving = renderToStaticMarkup(React.createElement(component, props))
    } catch (error) {
      report.failures.push(`staged render threw: ${error.stack ?? error.message}`)
    }

    // ── the saved toast's lifecycle ─────────────────────────────────────────
    // The page announces a landed write through the toast, and the confirmation
    // belongs to the visit that saw the write: a page that mounts later must not
    // replay it. A server render never runs an effect, so the mount notification
    // the browser's effect sends is sent here through the same injected face, and
    // the toast's completion is reported by calling the callback the page handed
    // the shared `Toast`.
    try {
      const settle = () => new Promise((resolve) => setImmediate(resolve))
      // Let the write left in flight above settle; it landed with no page on
      // screen, so it must not have announced anything.
      await settle()
      props.discard()
      const leave = props.pageMounted()
      props.edit('bootTimeoutSeconds', '90')
      props.save()
      await settle()
      toast.renders = 0
      const present = renderToStaticMarkup(React.createElement(component, props))
      report.toast = {
        onDone: typeof toast.onDone === 'function',
        present,
        landingRenders: toast.renders,
      }
      // The shared toast reports completion through this callback: the page must
      // drop the confirmation and never replay it without a new write.
      if (typeof toast.onDone === 'function') toast.onDone()
      report.toast.acked = renderToStaticMarkup(React.createElement(component, props))
      report.toast.repeated = renderToStaticMarkup(React.createElement(component, props))
      report.toast.renders = toast.renders
      // A later write restarts the confirmation, keyed by its own sequence: the
      // acknowledgement above must not swallow the next landing.
      props.edit('bootTimeoutSeconds', '80')
      props.save()
      await settle()
      report.toast.relapsed = renderToStaticMarkup(React.createElement(component, props))
      if (typeof toast.onDone === 'function') toast.onDone()
      // A write that lands while the page is not on screen is counted but never
      // announced, and a page that mounts again does not replay it.
      leave()
      props.edit('bootTimeoutSeconds', '75')
      props.save()
      await settle()
      report.toast.offscreen = renderToStaticMarkup(React.createElement(component, props))
      const remount = props.pageMounted()
      report.toast.remount = renderToStaticMarkup(React.createElement(component, props))

      // ── two placements of the same form ───────────────────────────────────
      // The row's page and the Settings dialog can both be on screen, and the
      // placement count is the controller's so that closing one leaves the
      // other alone. A component-local counter would count only itself: the
      // first teardown would report "last" and drop the other's staged edits.
      //
      // The remount above is still open, so it is closed first: the probe has to
      // start from a known count, or "the second teardown is the last" would be
      // measuring the leftover placement instead of the two it opened.
      remount()
      const first = props.pageMounted()
      const second = props.pageMounted()
      props.edit('bootTimeoutSeconds', '70')
      const stagedWhileBothOpen = renderToStaticMarkup(React.createElement(component, props))
      const firstWasLast = first()
      const stagedAfterOneLeft = renderToStaticMarkup(React.createElement(component, props))
      const secondWasLast = second()
      report.placements = {
        stagedWhileBothOpen,
        stagedAfterOneLeft,
        firstWasLast,
        secondWasLast,
        // A teardown that runs twice must not decrement twice.
        firstAgain: first(),
      }
    } catch (error) {
      report.failures.push(`toast lifecycle threw: ${error.stack ?? error.message}`)
    }
  }
}

// ── the action-bar state machine, independent of the render ─────────────────
try {
  const api = exported.ACTION_BAR_API
  const clean = { dirty: false, invalid: false, saving: false, failed: false }
  const identity = (key) => key
  report.actionBar = {
    clean: api.actionBarState(clean, identity),
    dirty: api.actionBarState({ ...clean, dirty: true }, identity),
    invalid: api.actionBarState({ ...clean, dirty: true, invalid: true }, identity),
    saving: api.actionBarState({ ...clean, dirty: true, saving: true }, identity),
    failed: api.actionBarState({ ...clean, failed: true }, identity),
    failedDraft: api.actionBarState({ ...clean, dirty: true, failed: true }, identity),
  }
} catch (error) {
  report.failures.push(`ACTION_BAR_API threw: ${error.message}`)
}

process.stdout.write(`${JSON.stringify(report)}\n`)
