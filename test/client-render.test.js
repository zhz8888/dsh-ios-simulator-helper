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
 * configuration page.
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

test('the form registers into the plugin row\'s own page', () => {
  // The parameter page is the ROW's page: the `plugins.row.config` slot is
  // keyed by the package name and the row id, and the Plugins page gives the
  // row a Configure control that opens it. The bundle's page keeps its
  // description, its rows and its source.
  assert.equal(report.registered.slot, 'plugins.row.config')
  assert.equal(report.registered.key, '@zhz8888/dsh-ios-simulator-helper#ios-simulator-helper')
  assert.equal(report.registered.locale, 'settings.iosSimulatorHelper')
  assert.deepEqual(report.registered.slots, ['plugins.row.config'])
})

test('the injected face carries the form actions and the view the page asks for', () => {
  // The render drives the `page` view — the row's page also asks for a
  // one-line `summary`, and `view` is how the form tells the two apart — and
  // the form needs no `label` of its own because the page draws the title. The
  // lifecycle pair is the page's alone: it marks the visit whose writes may be
  // confirmed, and acknowledges that confirmation.
  assert.deepEqual(report.injectKeys, [
    'acknowledgeSaved',
    'discard',
    'edit',
    'loadHost',
    'loadInventory',
    'loadStatus',
    'pageMounted',
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

test('the form draws no title of its own; the row\'s page owns the chrome', () => {
  // The page draws the plugin's title, icon, crumb and description above this
  // section. Repeating any of that here would render the plugin's name twice on
  // one screen, so the form contributes an effect note and the category cards.
  assert.ok(!report.variants.macos.includes('ismh_title'), 'the form must not draw its own title')
  assert.ok(!/<h[12]\b/.test(report.variants.macos), 'the form must start at section headings')
  assert.match(report.variants.macos, /Changes are saved to this profile and take effect on the next tool call\./)
})

test('every category is its own card', () => {
  // Six field groups plus the diagnostics card: the card outline is what
  // separates the categories, so each one must keep carrying it.
  const cards = report.variants.macos.match(/class="ismh_group"/g) ?? []
  assert.equal(cards.length, 7)
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

test('the device and the runtime are picked from a dropdown, not typed', () => {
  // Both settings name something this machine has to have, so the control is a
  // dropdown over what the inventory found and not a text box: a value the user
  // typed could name a device that was never installed.
  const blocks = report.variants.macos.split('class="ismh_field"').slice(1)
  const device = blocks.find((block) => block.includes('>Default device<'))
  const runtime = blocks.find((block) => block.includes('>Default runtime<'))
  assert.ok(device, 'the default device field must be rendered')
  assert.ok(runtime, 'the default runtime field must be rendered')
  for (const block of [device, runtime]) {
    assert.match(block, /<select/, 'the picker must be a dropdown')
    assert.ok(!/<input[^>]*type="text"/.test(block), 'the picker must not accept a typed value')
  }
})

test('the dropdown arrow is the stroked chevron, not a CSS triangle', () => {
  // One inline SVG path in one place, so every dropdown draws the same 1px-line
  // icon the theme uses everywhere else.
  const markup = report.variants.macos
  assert.match(markup, /<svg class="ismh_chevron"[^>]*><path d="M4 6l4 4 4-4"><\/path><\/svg>/)
  assert.ok(!markup.includes('ismh_selectWrap::after'), 'the CSS triangle must be gone')
})

test('the discovery dropdowns offer the devices and runtimes this machine has', () => {
  const api = report.discoveryApi
  // A device is shown under its own name and stored under it, because the
  // setting stores a device-name fragment. An unavailable device is left out:
  // simctl marks a device whose runtime is missing, and offering one would
  // store a name no call could resolve.
  assert.deepEqual(api.devices, [
    { value: 'iPhone 17e', label: 'iPhone 17e', found: true },
    { value: 'iPhone 18 Pro', label: 'iPhone 18 Pro', found: true },
  ])
  // A runtime is shown under its display name but stored under the fragment the
  // simulator picker matches a device on: 'iOS 27.1' is not a substring of
  // 'com.apple.CoreSimulator.SimRuntime.iOS-27-1', so storing the display name
  // would leave the setting pointing at no runtime at all.
  assert.deepEqual(api.runtimes.map((option) => [option.value, option.label]), [
    ['iOS-27-1', 'iOS 27.1'],
    ['iOS-27-0', 'iOS 27.0'],
    ['iOS-27-10', 'iOS 27.10'],
  ])
  assert.equal(api.fragment, 'iOS-27-1')
})

test('the dropdowns are fed by the inventory route, one list per source', () => {
  // The page builds its option lists from the inventory answer, and each field
  // names the list it reads. This is the wiring a server render cannot show,
  // because the fetch happens in an effect.
  const built = report.discoveryApi.suggestions
  assert.deepEqual(Object.keys(built).sort(), ['devices', 'runtimes'])
  assert.deepEqual(built.devices, [{ value: 'iPhone 18 Pro', label: 'iPhone 18 Pro', found: true }])
  assert.deepEqual(built.runtimes, [{ value: 'iOS-27-1', label: 'iOS 27.1', found: true }])
  // Before the inventory answers, no list is known: an empty list is a finding
  // (the host looked and found nothing), and only a known list may mark a
  // stored value as missing.
  assert.deepEqual(report.discoveryApi.suggestionsEmpty, { devices: null, runtimes: null })
  // A host that cannot run the simulator stack enumerated nothing either, so
  // it knows nothing about the stored value either.
  assert.deepEqual(report.discoveryApi.suggestionsUnsupported, { devices: null, runtimes: null })
})

test('a value this machine no longer has stays visible, and an unset value has an entry', () => {
  // A profile written by hand, or one that names a device that has since been
  // deleted, must stay visible so the user can see it and fix it — a select
  // whose value matches no option renders as nothing selected.
  assert.deepEqual(report.discoveryApi.keepsStoredValue, [
    { value: 'iPhone 18 Pro', label: 'iPhone 18 Pro', found: true },
    { value: 'iPhone 99', label: 'iPhone 99', found: false },
  ])
  // An unset value needs an entry of its own, or the control would render with
  // nothing selected and the reader could not tell it from a broken control.
  assert.deepEqual(report.discoveryApi.emptyValue, [
    { value: '', label: '', found: true },
    { value: 'iOS-27-1', label: 'iOS 27.1', found: true },
  ])
})

test('a value is not marked missing while the host has not answered', () => {
  // The dropdown claims to hold what this machine has, so it must not call a
  // device missing while the inventory request is still in flight - and must
  // not keep calling it missing when the request fails and never answers.
  assert.deepEqual(report.discoveryApi.unknownList, [
    { value: 'iPhone 18 Pro', label: 'iPhone 18 Pro', found: true },
  ])
})

test('the marker for a missing value is the locale string, with the value in it', () => {
  // The wording belongs to the locale files, punctuation included: the browser
  // half carries no copy of its own, and a separator spelled in the bundle is
  // a second source of copy that can drift.
  assert.equal(report.discoveryApi.markerLabel, 'iPhone 99 — not in this machine\'s list')
  assert.equal(report.discoveryApi.unsetLabel, 'Not set (the plugin\'s fallback decides)')
})

test('a value the host still resolves is not marked missing', () => {
  // The picker matches a fragment: a device whose name contains the stored
  // value. A profile that named `iPad mini` keeps working, so the page must
  // not tell the user to re-pick a setting that is in effect.
  assert.deepEqual(report.discoveryApi.fragmentStillResolves, [
    { value: 'iPad mini (A17 Pro)', label: 'iPad mini (A17 Pro)', found: true },
    { value: 'iPad mini', label: 'iPad mini', found: true },
  ])
  // A value nothing on this machine answers to is still marked, so a deleted
  // device stays visible as something to fix.
  assert.deepEqual(report.discoveryApi.fragmentGone, [
    { value: 'iPhone 18 Pro', label: 'iPhone 18 Pro', found: true },
    { value: 'iPad Air', label: 'iPad Air', found: false },
  ])
})

test('text fields stack, and the switches sit on the row right-hand side', () => {
  // Text inputs, selects and textareas keep the stacked frame: a 100%-wide
  // control under its label is the natural reading order. A switch reads as
  // a row instead — label and hint on the left, the track pinned to the
  // right edge (`margin-left:auto`), so every switch lines up on one column.
  const markup = report.variants.macos
  // Split on the whole class attribute, quote included: `ismh_fieldRowText`
  // and `ismh_fieldRowControl` carry `ismh_field` as a prefix, and a split on
  // the prefix alone would count them as field blocks of their own.
  const blocks = [...markup.matchAll(/class="ismh_field( ismh_fieldRow)?"/g)].map((match) => ({
    row: match[1] !== undefined,
    body: markup.slice(match.index + match[0].length, match.index + match[0].length + 4000),
  }))
  assert.equal(blocks.length, 19, 'one block per field')

  // The four switches of the field table render as rows; every other control
  // keeps the stacked label/control/hint order inside its block. The lookup
  // goes through the key→label pair the helper collects, because the markup
  // carries the translated copy, not the dictionary keys.
  const switchKeys = ['autoBootSimulator', 'exclusiveSimulator', 'autoOpenSimulator', 'disableCodeSigning', 'showInSettings']
  for (const key of switchKeys) {
    const label = report.fieldLabels[report.fieldKeys.indexOf(key)]
    assert.ok(label, `${key} must have a label the helper collected`)
    const row = blocks.find((block) => block.row && block.body.includes(`>${label}<`))
    assert.ok(row, `${key} must render as a row`)
    const at = row.body.indexOf('ismh_label')
    const hint = row.body.indexOf('ismh_hint')
    const track = row.body.indexOf('role="switch"')
    const control = row.body.indexOf('ismh_fieldRowControl')
    assert.ok(at >= 0 && hint > at, 'the text column holds label then hint')
    assert.ok(control > hint, 'the control column comes after the text column')
    assert.ok(track > control, 'the track sits inside the control column, on the right')
  }

  const stacked = blocks.filter((block) => !block.row)
  assert.equal(stacked.length, 14, 'the stacked fields keep the stacked block')
  for (const block of stacked) {
    const body = block.body
    const label = body.indexOf('ismh_label')
    const at = [body.indexOf('ismh_control'), body.indexOf('role="switch"')].filter((index) => index >= 0)
    const control = Math.min(...at)
    const hint = body.indexOf('ismh_hint')
    assert.ok(label >= 0 && control > label, 'the label comes before its control')
    assert.ok(hint > control, 'the hint comes after the control')
  }
})

test('all 19 fields are rendered, in the host schema order', () => {
  assert.equal(report.fieldKeys.length, 19)
  assert.deepEqual(report.fieldLabels.length, 19)
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

test('a draft outside the declared range is invalid and blocks the save', () => {
  // The schema stores a natural number and the host refuses a zero, but it
  // declares no maximum on purpose: a value written by an older build must not
  // stop the plugin from mounting. The browser half is what refuses to *stage*
  // an out-of-range draft — 7200 s in the 3600-second log window and a zero
  // timeout must both stay inline errors, and neither may start a save.
  const markup = report.variants.macosOutOfRange
  assert.match(markup, /class="ismh_actions ismh_actionsError"/)
  assert.match(markup, /One value is invalid; fix it before saving/)
  assert.equal((markup.match(/aria-invalid="true"/g) ?? []).length, 2, 'both out-of-range drafts are flagged')
  assert.equal(
    (markup.match(/Enter a whole number, or leave blank to use the default\./g) ?? []).length,
    2,
    'each invalid field resolves the inline message instead of the hint',
  )
  const save = /<button[^>]*data-variant="primary"[^>]*>/.exec(markup)?.[0]
  assert.ok(save?.includes('disabled'), 'the blocked draft must not be saveable')
})

test('a number inside the declared range is accepted, so the range is what is enforced', () => {
  // The pair proves the refusal above is the range and not a blanket refusal of
  // every number draft: the same field, a value inside its range, is staged and
  // offered for save.
  const markup = report.variants.macosRangeValid
  assert.match(markup, /class="ismh_actions"/)
  assert.match(markup, /Unsaved changes/)
  assert.ok(!/aria-invalid="true"/.test(markup), 'an in-range draft must not be flagged invalid')
  const save = /<button[^>]*data-variant="primary"[^>]*>/.exec(markup)?.[0]
  assert.ok(save !== undefined && !save.includes('disabled'), 'an in-range draft may be saved')
})

test('a clear on a field the user layer does not override is still a pending change', () => {
  // The clear stages an empty draft on a field the profile does not override,
  // and the model plans the unset. The bar has to report it: otherwise the
  // change would look saved and could be neither applied nor discarded.
  const markup = report.variants.macosCleared
  assert.match(markup, /class="ismh_actions"/, 'the clear keeps the action bar')
  assert.match(markup, /Unsaved changes/)
  assert.match(markup, /data-variant="ghost"[^>]*>Discard changes</)
  const save = /<button[^>]*data-variant="primary"[^>]*>/.exec(markup)?.[0]
  assert.ok(save !== undefined && !save.includes('disabled'), 'the clear must be saveable')
})

test('a write in flight shows the message the dictionary carries', () => {
  const markup = report.variants.macosSaving
  assert.match(markup, /Saving…/, 'the bar names the write that is running')
  assert.ok(!/>writing</.test(markup), 'the saving state must not render an unresolved key')
})

test('a write that lands shows the saved confirmation exactly once', () => {
  // The page drives a real write through the shared form; the landing is then
  // announced by the toast the page renders, keyed by the landed-write
  // sequence. The toast receives the completion callback the shared `Toast`
  // reports through, which is what the next test uses.
  assert.equal(report.toast.onDone, true, 'the toast must hand the page its completion callback')
  assert.match(report.toast.present, /data-toast="success"/)
  assert.match(report.toast.present, /Saved to this profile/)
  assert.equal(report.toast.landingRenders, 1, 'the landing rendered the toast exactly once')
})

test('the saved confirmation is not replayed after the toast reports completion', () => {
  // Completion clears the sequence: a re-render after it must show no toast, and
  // a later render without a new write must not bring it back.
  assert.ok(!report.toast.acked.includes('data-toast'), 'acknowledging must remove the toast')
  assert.ok(!report.toast.repeated.includes('data-toast'), 'a later render must not replay it')
  assert.equal(report.toast.renders, 1, 'no replay means the toast rendered exactly once')
})

test('a later write restarts the confirmation instead of being swallowed', () => {
  // The toast is keyed by the landed-write sequence, so a save after the
  // acknowledgement must confirm itself rather than stay hidden by the last
  // acknowledgement.
  assert.match(report.toast.relapsed, /data-toast="success"/)
  assert.match(report.toast.relapsed, /Saved to this profile/)
})

test('a landing that arrives while the page is off screen is never announced later', () => {
  // The confirmation belongs to the visit that saw the write. A write that
  // settles after the page unmounted is counted, but the next visit must not be
  // shown a confirmation for it.
  assert.ok(!report.toast.offscreen.includes('data-toast'), 'no toast without the page on screen')
  assert.ok(!report.toast.remount.includes('data-toast'), 'a new visit must not replay it')
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
