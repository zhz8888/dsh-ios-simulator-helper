import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { ROOT } from './helpers/load-bundle.mjs'

/**
 * Render the plugin's Plugins-page configuration form with real React.
 *
 * The form is the artifact a port most easily gets wrong: a missing dictionary
 * key, a field the host never sends, an `inject` face that does not match what
 * the slot renderer calls, or an uncontrolled input. Rendering it through
 * `react-dom/server` turns all of those into a failing test instead of a broken
 * plugin detail page.
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

/** Render once per host scenario; the form is deterministic for a fixed snapshot. */
async function renderPage() {
  const { stdout } = await run(process.execPath, [path.join(ROOT, 'test', 'helpers', 'render-page.mjs')], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  })
  return JSON.parse(stdout.trim().split('\n').at(-1))
}

const report = await renderPage()

test('the configuration form renders without throwing on every host', () => {
  assert.deepEqual(report.failures, [])
  for (const [host, markup] of Object.entries(report.variants)) {
    assert.ok(markup.length > 1000, `the ${host} form must render real markup`)
  }
})

test('the form registers into the plugin detail page, not the Settings page', () => {
  // A plugin's own configuration belongs on the Plugins page: the
  // `plugins.bundle.config` slot is keyed by the BUNDLE's package name, and the
  // page renders the entry inside the plugin detail. `settings.section` still
  // renders, but registering there as well would give the plugin two
  // configuration pages — this form must name exactly one slot.
  assert.equal(report.registered.slot, 'plugins.bundle.config')
  assert.equal(report.registered.key, '@zhz8888/dsh-ios-simulator-helper')
  assert.equal(report.registered.locale, 'settings.iosSimulatorHelper')
  assert.deepEqual(report.registered.slots, ['plugins.bundle.config'])
})

test('the injected face carries the form actions and the view the page asks for', () => {
  // The page asks for `view: 'page'`; there is no summary view for a bundle's
  // own configuration, and the form needs no `label` of its own because the
  // page draws the title.
  assert.deepEqual(report.injectKeys, [
    'discard',
    'edit',
    'loadHost',
    'loadInventory',
    'loadStatus',
    'resetField',
    'save',
    't',
    'useIosSimulatorSettings',
    'view',
  ])
})

test('every field group is rendered with its heading and hint', () => {
  for (const heading of ['Simulator and device', 'UI automation', 'Build and DerivedData', 'Logs', 'Output directories']) {
    assert.ok(report.variants.macos.includes(heading), `missing group heading: ${heading}`)
  }
})

test('the controls carry the values the host serves, not placeholders', () => {
  const markup = report.variants.macos
  assert.match(markup, /value="iPhone 17"/)
  assert.match(markup, /value="120"/)
  assert.match(markup, /role="switch" aria-checked="true"/)
  assert.match(markup, /<option value="auto" selected="">/)
  assert.match(markup, /<option value="idb">/)
})

test('an overridden value shows the badge and its reset control', () => {
  // The fake host stores a user override for one field, so the shared form
  // marks it and offers the reset. Both are harness behaviour, but the form is
  // what has to place them inside the field frame.
  assert.match(report.variants.macos, />Overridden</)
  assert.match(report.variants.macos, />Reset to default</)
})

test('a host that does not serve the namespace renders no form at all', () => {
  // The registration hangs off `whileServed`, so a deployment without the host
  // half must not leave a slot entry behind.
  assert.equal(report.unserved.component, false, 'no component when the namespace is not served')
  assert.deepEqual(report.unserved.slots, [], 'no slot may be injected when the namespace is not served')
})

test('the form draws no title of its own; the plugin detail page owns the chrome', () => {
  // The page draws the plugin's title, icon, crumb and description above this
  // section. Repeating any of that here would render the plugin's name twice on
  // one screen, so the form contributes an effect note and the category cards.
  assert.ok(!report.variants.macos.includes('ismh_title'), 'the form must not draw its own title')
  assert.ok(!/<h[12]\b/.test(report.variants.macos), 'the form must start at section headings')
  assert.match(report.variants.macos, /Changes are saved to this profile and take effect on the next tool call\./)
})

test('every category is its own card', () => {
  // Five field groups plus the diagnostics card: the card outline is what
  // separates the categories, so each one must keep carrying it.
  const cards = report.variants.macos.match(/class="ismh_group"/g) ?? []
  assert.equal(cards.length, 6)
})

test('a switch does not repeat its state as on/off text', () => {
  const markup = report.variants.macos
  assert.ok(!/>on<\/span>/.test(markup), 'the track already shows the state')
  assert.ok(!/>off<\/span>/.test(markup))
  assert.match(markup, /role="switch" aria-checked="true"/)
})

test('the backend select shows translated text while storing the raw value', () => {
  const markup = report.variants.macos
  assert.match(markup, /<option value="auto" selected="">Auto-detect \(recommended\)<\/option>/)
  assert.match(markup, /<option value="idb">Require idb<\/option>/)
})

test('every field is a stacked label/control/hint block', () => {
  const blocks = report.variants.macos.split('class="ismh_field"').slice(1)
  assert.equal(blocks.length, 17, 'one block per field')
  for (const block of blocks) {
    const label = block.indexOf('ismh_label')
    const at = [block.indexOf('ismh_control'), block.indexOf('role="switch"')].filter((index) => index >= 0)
    const control = Math.min(...at)
    const hint = block.indexOf('ismh_hint')
    assert.ok(label >= 0 && control > label, 'the label comes before its control')
    assert.ok(hint > control, 'the hint comes after the control')
  }
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
  assert.match(markup, /Host check, diagnostics and discovery/)
})

test('the save control is an action bar, absent while nothing is staged', () => {
  const markup = report.variants.macos
  assert.ok(!/ismh_actions/.test(markup), 'a clean form shows no action bar')
  assert.ok(!/>Save</.test(markup), 'and therefore no save button')
})

test('a staged edit shows the bar with its discard and save buttons', () => {
  const markup = report.variants.macosDirty
  assert.match(markup, /class="ismh_actions"/)
  assert.match(markup, /Unsaved changes/)
  assert.match(markup, /data-state="warning"/)
  assert.match(markup, /data-variant="ghost"[^>]*>Discard changes</)
  const save = /<button[^>]*data-variant="primary"[^>]*>/.exec(markup)?.[0]
  assert.ok(save !== undefined && !save.includes('disabled'), 'a valid draft may be saved')
})

test('an invalid draft turns the bar into an error and blocks the save', () => {
  const markup = report.variants.macosInvalid
  assert.match(markup, /class="ismh_actions ismh_actionsError"/)
  assert.match(markup, /One value is invalid; fix it before saving/)
  assert.match(markup, /data-state="error"/)
  const save = /<button[^>]*data-variant="primary"[^>]*>/.exec(markup)?.[0]
  assert.ok(save?.includes('disabled'), 'save must be disabled while a draft is invalid')
})

test('a draft that reverts to the value in effect stops counting as an edit', () => {
  const clean = report.variants.macos
  const reverted = report.variants.macosReverted
  assert.ok(!/ismh_actions/.test(reverted), 'the bar closes once no save would write anything')
  const badges = (markup) => (markup.match(/data-tone="outline"/g) ?? []).length
  // The fixture profile keeps one override of its own, so one badge is expected in
  // both renders: the reverted drafts (a switch, a text field, and that override's
  // own value) must not add another.
  assert.equal(badges(clean), 1)
  assert.equal(badges(reverted), 1, 'a reverted draft must not raise the overridden badge')
})

test('a pending reset keeps the form dirty and the action bar present', () => {
  // The fixture's only override carries the value its base already holds, so a
  // reset stages that base value as its text: the one draft whose text reads as
  // "no change" while the model still holds the `unset` the reset means. The
  // page has to keep offering the save that applies it.
  const markup = report.variants.macosReset
  assert.match(markup, /class="ismh_actions"/, 'a pending reset keeps the bar')
  assert.match(markup, /Unsaved changes/)
  const save = /<button[^>]*data-variant="primary"[^>]*>/.exec(markup)?.[0]
  assert.ok(save !== undefined && !save.includes('disabled'), 'a pending reset must be saveable')
})

test('a write in flight shows the message the dictionary carries', () => {
  const markup = report.variants.macosSaving
  assert.match(markup, /Saving…/, 'the bar names the write that is running')
  assert.ok(!/>writing</.test(markup), 'the saving state must not render an unresolved key')
})

test('the bar state machine covers clean, pending, blocked and failed', () => {
  const bar = report.actionBar
  assert.equal(bar.clean, null, 'a clean form has nothing to say')
  assert.deepEqual(bar.dirty, { tone: 'pending', message: 'pendingWrite', canSave: true, canDiscard: true })
  assert.equal(bar.saving.tone, 'pending')
  // The message is part of the state: an unresolved key is rendered as the key
  // itself, so the bar must name a dictionary entry in every state.
  assert.equal(bar.saving.message, 'saving', 'the saving state names the message the dictionary carries')
  assert.equal(bar.saving.canSave, false, 'a write in flight must not be started twice')
  assert.equal(bar.saving.canDiscard, false, 'nor discarded while it is being written')
  assert.equal(bar.invalid.tone, 'error')
  assert.equal(bar.invalid.message, 'writeBlocked', 'a blocked draft names the message the dictionary carries')
  assert.equal(bar.invalid.canSave, false, 'an invalid draft must not be savable')
  assert.deepEqual(bar.failed, { tone: 'error', message: 'writeFailed', canDiscard: true, canSave: false })
  assert.equal(bar.failedDraft.canSave, true, 'a failed write with valid edits may be retried')
})

test('no confirmation is shown before a write lands', () => {
  for (const [host, markup] of Object.entries(report.variants)) {
    assert.ok(!markup.includes('data-toast'), `the ${host} page must not report a save that never happened`)
  }
})

test('no unresolved dictionary key leaks into the markup', () => {
  // `ctx.locale.bind` returns the key itself for a missing entry, which is what
  // a typo in one of the generated keys would look like.
  for (const [host, markup] of Object.entries(report.variants)) {
    assert.ok(!/field\.[A-Za-z]+/.test(markup), `an unresolved field key leaked into the ${host} markup`)
    assert.ok(!/group\.[A-Za-z]+/.test(markup), `an unresolved group key leaked into the ${host} markup`)
  }
  // Every key the bundle asks for is answered by the dictionary it registered, in
  // both languages — the generated keys included, which no single render shows.
  for (const language of ['en', 'zh']) {
    const known = new Set(report.dictionaryKeys[language])
    for (const key of report.usedKeys) {
      assert.ok(known.has(key), `the ${language} dictionary has no entry for "${key}"`)
    }
  }
  assert.deepEqual(report.dictionaryKeys.en, report.dictionaryKeys.zh, 'the two dictionaries carry the same keys')
})
