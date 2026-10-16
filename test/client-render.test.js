import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { ROOT } from './helpers/load-bundle.mjs'

/**
 * Render the settings page with real React.
 *
 * The page is the artifact a port most easily gets wrong: a missing dictionary
 * key, a field the host never sends, an `inject` face that does not match what
 * the slot renderer calls, or an uncontrolled input. Rendering it through
 * `react-dom/server` turns all of those into a failing test instead of a broken
 * Settings panel.
 *
 * React is real. `@deepseek-ai/dsh-client-ui-primitives` is doubled, because the
 * shipped package is a browser bundler input (`*.module.css`, `simple-icons`,
 * `zustand/vanilla`) that plain Node cannot import; the double mirrors the
 * documented contract. See `test/helpers/primitives-double.mjs`.
 *
 * The render runs in a child process so the JSON report is not polluted by
 * anything else the module graph prints — and so each host scenario can replace
 * the global `navigator`.
 */

const run = promisify(execFile)

/** Render once per host scenario; the page is deterministic for a fixed snapshot. */
async function renderPage() {
  const { stdout } = await run(process.execPath, [path.join(ROOT, 'test', 'helpers', 'render-page.mjs')], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  })
  return JSON.parse(stdout.trim().split('\n').at(-1))
}

const report = await renderPage()

test('the settings page renders without throwing on every host', () => {
  assert.deepEqual(report.failures, [])
  for (const [host, markup] of Object.entries(report.variants)) {
    assert.ok(markup.length > 1000, `the ${host} page must render real markup`)
  }
})

test('the page registers the slot entry the settings shell expects', () => {
  assert.deepEqual(report.registered, { id: 'ios-simulator', order: 17 })
  assert.deepEqual(report.injectKeys, [
    'close',
    'discard',
    'edit',
    'loadHost',
    'loadInventory',
    'loadStatus',
    'resetField',
    'save',
    't',
    'useIosSimulatorSettings',
  ])
})

test('the section label is a locale-following thunk returning the nav text', () => {
  assert.equal(report.navLabel, 'iOS Simulator')
})

test('every field group is rendered with its heading and hint', () => {
  for (const heading of ['Simulator and device', 'UI automation', 'Build and DerivedData', 'Logs', 'Output directories']) {
    assert.ok(report.variants.macos.includes(heading), `missing group heading: ${heading}`)
  }
})

test('the controls carry the values the host serves, not placeholders', () => {
  const markup = report.variants.macos
  assert.match(markup, /value="iPhone 17"/)
  assert.match(markup, /value="120000"/)
  assert.match(markup, /role="switch" aria-checked="true"/)
  assert.match(markup, /<option value="auto" selected="">/)
  assert.match(markup, /<option value="idb">/)
})

test('all 17 fields are rendered, in the host schema order', () => {
  assert.equal(report.fieldKeys.length, 17)
  assert.deepEqual(report.fieldLabels.length, 17)
  for (const label of report.fieldLabels) {
    assert.ok(report.variants.macos.includes(label), `missing control label: ${label}`)
  }
})

test('a macOS browser shows no warning and reports the host as supported', () => {
  const markup = report.variants.macos
  assert.ok(!markup.includes('role="alert"'), 'macOS must not show the unsupported-host alert')
  assert.match(markup, /Host system: macOS — supported\./)
})

test('a non-macOS browser is told the plugin only supports macOS', () => {
  for (const host of ['linux', 'windows']) {
    const markup = report.variants[host]
    assert.match(markup, /role="alert"/, `${host} must show the alert`)
    assert.match(markup, /This plugin only supports macOS/, `${host} alert title`)
    assert.match(markup, /which is not macOS/, `${host} alert body`)
  }
  assert.match(report.variants.linux, /The host reports Linux, which is not macOS/)
  assert.match(report.variants.windows, /The host reports Windows, which is not macOS/)
})

test('the alert names the detected platform so the user can act on it', () => {
  assert.match(report.variants.linux, /<code class="ismh_mono">linux<\/code>/)
  assert.match(report.variants.windows, /<code class="ismh_mono">win32<\/code>/)
})

test('an undetectable host warns about nothing', () => {
  const markup = report.variants.unknown
  assert.ok(!markup.includes('role="alert"'), 'an unknown host must not be reported as unsupported')
  assert.match(markup, /Host system: could not be determined\./)
})

test('the pure host verdict prefers the host route over the browser', () => {
  assert.deepEqual(report.hostApi.macos, { platform: 'darwin', label: 'macOS', supported: true })
  assert.equal(report.hostApi.linux.supported, false)
  assert.equal(report.hostApi.none.supported, null)
  assert.equal(report.hostApi.hostWins.supported, false)
  assert.equal(report.hostApi.hostWins.source, 'host')
  assert.equal(report.hostApi.browserWins.source, 'browser')
  assert.equal(report.hostApi.unknown.supported, null)
  assert.equal(report.hostApi.requiredPlatform, 'darwin')
})

test('the host check, diagnostics, discovery and save controls are present', () => {
  const markup = report.variants.macos
  assert.match(markup, /Run diagnostic/)
  assert.match(markup, /Refresh simulators and runtimes/)
  assert.match(markup, />Save</)
  assert.match(markup, /Host check, diagnostics and discovery/)
})

test('no unresolved dictionary key leaks into the markup', () => {
  // `ctx.locale.bind` returns the key itself for a missing entry, which is what
  // a typo in one of the generated keys would look like.
  for (const [host, markup] of Object.entries(report.variants)) {
    assert.ok(!/field\.[A-Za-z]+/.test(markup), `an unresolved field key leaked into the ${host} markup`)
    assert.ok(!/group\.[A-Za-z]+/.test(markup), `an unresolved group key leaked into the ${host} markup`)
  }
})
