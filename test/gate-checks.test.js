import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as gate from '../scripts/check-bundle.mjs'
import { ROOT } from './helpers/load-bundle.mjs'

/**
 * Unit tests for the consistency gate itself.
 *
 * The gate is a script that runs once and exits; this suite imports the
 * SHIPPED one - not a copy - and calls its named checks on a crafted drift, to
 * assert that the drift is reported. A copy of a check would keep passing
 * after the check itself stopped checking, which is the failure mode this
 * suite exists to prevent.
 *
 * The checks that read the repository's own files are driven through a
 * context built from the real tree and then edited in memory, so a case
 * cannot depend on the repository being in a particular state.
 */

/** The real context, rebuilt for every case that changes it. */
const context = async () => await gate.buildContext()

test('every named check is wired into the run', async () => {
  // A check that is exported but never run is a check that never fires.
  const names = gate.CHECKS.map((check) => check.name)
  assert.equal(new Set(names).size, names.length, 'the checks have distinct names')
  for (const name of [
    'checkDeclaredExternals',
    'checkScriptHygiene',
    'checkBundleIdentity',
    'checkNamespace',
    'checkPluginSurface',
    'checkFieldTable',
    'checkGroupTable',
    'checkRoutes',
    'checkDictionaryCoverage',
    'checkDictionarySymmetry',
    'checkNoInlineCopy',
    'checkLocaleGlobal',
    'checkMacOsGate',
    'checkRequiredModules',
  ]) {
    assert.equal(typeof gate[name], 'function', `${name} must be exported`)
  }
  assert.ok(gate.CHECKS.length >= 14, 'every exported check must be wired in')
})

test('a bundle that names a module outside the shell table is reported', async () => {
  const problems = gate.checkDeclaredExternals('require("some-other-package")')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /not a shell static module/)
  assert.deepEqual(gate.checkDeclaredExternals('require("react")'), [])
})

test('an import statement or a runtime import in the bundle is reported', async () => {
  assert.match(gate.checkScriptHygiene('import x from "y"')[0], /classic script/)
  assert.match(gate.checkScriptHygiene('const m = await import("y")')[0], /dynamic import/)
  // A JSDoc type reference names a module the way a runtime import would
  // and is not one, so it must not be reported.
  assert.deepEqual(gate.checkScriptHygiene('/** @type {import("react").ReactNode} */'), [])
})

test('a bundle that identifies itself as another package is reported', async () => {
  const ctx = await context()
  ctx.registration = { id: 'someone-else', factory: () => ({}) }
  assert.match(gate.checkBundleIdentity(ctx)[0], /must equal the package name/)
})

test('a namespace that is not the patch row id is reported', async () => {
  const ctx = await context()
  ctx.exported = { ...ctx.exported, NS: 'another-namespace' }
  assert.match(gate.checkNamespace(ctx)[0], /must equal SETTINGS_NAMESPACE/)
  const other = await context()
  other.patch = 'id: something-else'
  assert.match(gate.checkNamespace(other)[0], /must mount a row whose id/)
})

test('a form that registers into the wrong slot is reported', async () => {
  const ctx = await context()
  ctx.exported = { ...ctx.exported, PLUGIN_SURFACE: { slot: 'plugins.bundle.config', key: ctx.manifest.name } }
  assert.match(gate.checkPluginSurface(ctx)[0], /must register into plugins\.row\.config/)
})

test('a row page keyed by anything but the package and the row id is reported', async () => {
  const ctx = await context()
  ctx.exported = { ...ctx.exported, PLUGIN_SURFACE: { slot: 'plugins.row.config', key: ctx.manifest.name } }
  assert.match(gate.checkPluginSurface(ctx).join('\n'), /must be/)
})

test('a Settings section that is not gated by the page\'s own switch is reported', async () => {
  const ctx = await context()
  ctx.exported = {
    ...ctx.exported,
    SETTINGS_SURFACE: { ...ctx.exported.SETTINGS_SURFACE, field: 'notASetting' },
  }
  assert.match(gate.checkSettingsSection(ctx).join('\n'), /must declare the notASetting setting/)
})

test('a Settings slot name spelled outside the surface constant is reported', async () => {
  const ctx = await context()
  ctx.clientSource = `${ctx.clientSource}\nctx.slots.register({ name: "settings.section" });`
  assert.match(gate.checkSettingsSection(ctx).join('\n'), /may only appear in the SETTINGS_SURFACE constant/)
})

test('a field the host does not declare is reported', async () => {
  const ctx = await context()
  ctx.exported = {
    ...ctx.exported,
    FIELD_META: [...ctx.exported.FIELD_META, { key: 'notAField', kind: 'text' }],
  }
  const problems = gate.checkFieldTable(ctx).join('\n')
  assert.match(problems, /unknown field "notAField"/)
})

test('a field whose kind or bounds differ from the host is reported', async () => {
  const ctx = await context()
  const fields = ctx.exported.FIELD_META.map((field) =>
    field.key === 'defaultDevice' ? { ...field, kind: 'number' } : field,
  )
  ctx.exported = { ...ctx.exported, FIELD_META: fields }
  assert.match(gate.checkFieldTable(ctx).join('\n'), /host kind discovery != client kind number/)
})

test('a discovery field whose list differs from the host is reported', async () => {
  const ctx = await context()
  // The two halves must name the same discovery list: a field that read the
  // devices on one side and the runtimes on the other would offer the wrong
  // options without anything failing.
  const fields = ctx.exported.FIELD_META.map((field) =>
    field.key === 'defaultDevice' ? { ...field, suggest: 'runtimes' } : field,
  )
  ctx.exported = { ...ctx.exported, FIELD_META: fields }
  assert.match(gate.checkFieldTable(ctx).join('\n'), /host suggest "devices" != client suggest "runtimes"/)
})

test('a discovery field naming a list the page does not build is reported', async () => {
  const ctx = await context()
  // A mistyped source name yields an empty list and empties the dropdown
  // silently: the field still renders, so nothing else would notice.
  const fields = ctx.exported.FIELD_META.map((field) =>
    field.key === 'defaultDevice' ? { ...field, suggest: 'devicez' } : field,
  )
  ctx.exported = { ...ctx.exported, FIELD_META: fields }
  assert.match(
    gate.checkDiscoverySources(ctx).join('\n'),
    /reads the discovery list "devicez", which the page does not build/,
  )
})

test('a discovery field that names no list at all is reported', async () => {
  const ctx = await context()
  const fields = ctx.exported.FIELD_META.map((field) =>
    field.key === 'defaultRuntime' ? { ...field, suggest: undefined } : field,
  )
  ctx.exported = { ...ctx.exported, FIELD_META: fields }
  assert.match(gate.checkDiscoverySources(ctx).join('\n'), /names no suggest source/)
})

test('a discovery field without the copy for its unset entry is reported', async () => {
  const ctx = await context()
  // A discovery dropdown always offers an entry for the unset value, and its
  // label is looked up under `option.<key>.any`. That key is derived from the
  // field table, so a third discovery field cannot ship a page that renders
  // the raw key in place of a label.
  const fields = new Map(ctx.host.fields)
  fields.set('defaultTarget', {
    ...ctx.host.fields.get('defaultDevice'),
    key: 'defaultTarget',
    kind: 'discovery',
    suggest: 'devices',
    default: '',
  })
  ctx.host = { ...ctx.host, fields }
  delete ctx.localeEn['option.defaultTarget.any']
  delete ctx.localeZh['option.defaultTarget.any']
  assert.match(
    gate.checkDictionaryCoverage(ctx).join('\n'),
    /locale\/en\.json declares no "option\.defaultTarget\.any"/,
  )
})

test('a group that holds different fields is reported', async () => {
  const ctx = await context()
  const groups = ctx.exported.GROUP_META.map((group) =>
    group.id === 'target' ? { ...group, fields: [...group.fields].reverse() } : group,
  )
  ctx.exported = { ...ctx.exported, GROUP_META: groups }
  assert.match(gate.checkGroupTable(ctx).join('\n'), /host fields .* != client fields/)
})

test('a route the host does not register is reported', async () => {
  const ctx = await context()
  // A helper whose name does not end in "Route" is not one that registers a
  // route, so the gate must not count it as one.
  ctx.hostSource = ctx.hostSource.replace("route('status'", "registerStatus('status'")
  assert.match(gate.checkRoutes(ctx).join('\n'), /does not register the status route/)
})

test('a key the page looks up but neither locale file declares is reported', async () => {
  const ctx = await context()
  delete ctx.localeEn['field.defaultDevice']
  assert.match(gate.checkDictionaryCoverage(ctx).join('\n'), /locale\/en\.json declares no "field\.defaultDevice"/)
})

test('a key only one locale file declares is reported, and so is one nothing looks up', async () => {
  const ctx = await context()
  ctx.localeEn['field.onlyInEnglish'] = 'Only here'
  const problems = gate.checkDictionarySymmetry(ctx).join('\n')
  assert.match(problems, /the locale files declare different keys/)
  assert.match(problems, /which no control looks up/)
})

test('inline copy in the browser half is reported', async () => {
  const ctx = await context()
  ctx.clientCode = 'const x = { zh: "中文", en: "English" };'
  assert.match(gate.checkNoInlineCopy(ctx).join('\n'), /must not carry inline copy/)
  ctx.clientCode = 'const x = "中文";'
  assert.match(gate.checkNoInlineCopy(ctx).join('\n'), /CJK string/)
})

test('two halves that disagree on the copy global are reported', async () => {
  const ctx = await context()
  ctx.exported = { ...ctx.exported, LOCALE_GLOBAL: '__DSH_SOMEONE_ELSE__' }
  assert.match(gate.checkLocaleGlobal(ctx).join('\n'), /the copy global differs/)
})

test('a page that lost the macOS notice is reported', async () => {
  const ctx = await context()
  ctx.clientSource = ctx.clientSource.replace('REQUIRED_PLATFORM = "darwin"', 'REQUIRED_PLATFORM = "linux"')
  assert.match(gate.checkMacOsGate(ctx).join('\n'), /must declare the required platform/)
  const other = await context()
  other.clientSource = other.clientSource.replaceAll('hostUnsupportedTitle', 'somethingElse')
  assert.match(gate.checkMacOsGate(other).join('\n'), /only supports macOS/)
})

test('a locale file the host half cannot read is a problem, not a crash', async () => {
  // The host reads its copy at import time, so a key missing from either
  // locale file throws there. The gate loads the host lazily, so it can report
  // that as the problem it is instead of dying with a stack trace.
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'ios-gate-missing-'))
  for (const entry of ['lib', 'scripts', 'locale']) {
    cpSync(path.join(ROOT, entry), path.join(scratch, entry), { recursive: true })
  }
  cpSync(path.join(ROOT, 'test'), path.join(scratch, 'test'), { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml']) {
    cpSync(path.join(ROOT, file), path.join(scratch, file))
  }
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(scratch, 'node_modules'), 'dir')
  const locale = JSON.parse(readFileSync(path.join(scratch, 'locale', 'en.json'), 'utf8'))
  delete locale.settings['field.defaultDevice']
  writeFileSync(path.join(scratch, 'locale', 'en.json'), JSON.stringify(locale, null, 2) + '\n')
  const run = spawnSync(process.execPath, [path.join(scratch, 'scripts', 'check-bundle.mjs')], {
    encoding: 'utf8',
  })
  assert.equal(run.status, 1, 'the gate must fail')
  assert.match(run.stderr, /the host half could not be loaded/)
  assert.match(run.stderr, /field\.defaultDevice/)
  assert.doesNotMatch(run.stderr, /at Object\./, 'the failure must be curated, not a stack trace')
})
test('the gate runs from a symlinked path, where a naive comparison would not', async () => {
  // A temporary directory on macOS is a symlink, so `os.tmpdir()` answers
  // `/var/folders/...` while the same path resolved is
  // `/private/var/folders/...`. A gate that compared the two naively would
  // silently do nothing there - and a gate that does nothing looks exactly
  // like a gate that passed.
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'ios-gate-'))
  for (const entry of ['lib', 'scripts', 'locale']) {
    cpSync(path.join(ROOT, entry), path.join(scratch, entry), { recursive: true })
  }
  cpSync(path.join(ROOT, 'test'), path.join(scratch, 'test'), { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml']) {
    cpSync(path.join(ROOT, file), path.join(scratch, file))
  }
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(scratch, 'node_modules'), 'dir')
  const gatePath = path.join(scratch, 'scripts', 'check-bundle.mjs')
  const absolute = spawnSync(process.execPath, [gatePath], { encoding: 'utf8' })
  assert.equal(absolute.status, 0, absolute.stderr)
  assert.match(absolute.stdout, /check-bundle: OK/, 'the gate must run and report')
})