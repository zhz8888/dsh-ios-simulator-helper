#!/usr/bin/env node
import process from 'node:process'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, STATIC_MODULES, loadBundle, stripComments } from '../test/helpers/load-bundle.mjs'

/**
 * Consistency gate for the browser bundle.
 *
 * The client half cannot import the host's settings module — the client bundle
 * purity gate forbids cross-plugin value imports — so the field table, the
 * settings namespace and the three route paths are written twice. This script
 * is the check that keeps the two copies identical, plus the structural checks
 * a host-side test cannot make about a file the browser evaluates on its own.
 *
 * Every check is a named function that returns the problems it found, so the
 * test suite can call the SHIPPED gate on a crafted drift and assert that the
 * drift is reported. A copy of a check in the test suite would keep passing
 * after the check itself stopped checking.
 *
 * Run with `pnpm run check`.
 */

/**
 * Everything the checks read.
 *
 * @typedef {object} GateContext
 * @property {string} clientSource - the browser half's source.
 * @property {string} clientCode - that source without its comments.
 * @property {string} hostSource - the host half's source.
 * @property {string} patch - the Cordis patch file.
 * @property {Record<string, unknown>} manifest - the package manifest.
 * @property {{id: string, factory: Function}} registration - the bundle's registration.
 * @property {Record<string, unknown>} exported - what the bundle exports.
 * @property {string[]} required - the modules the bundle asked for.
 * @property {Record<string, string>} localeEn - the English dictionary.
 * @property {Record<string, string>} localeZh - the Chinese dictionary.
 * @property {object} host - the host half's own tables.
 */

/**
 * The host half's own tables, read through the module the gate imports.
 *
 * @typedef {object} HostTables
 * @property {string} namespace - the settings namespace.
 * @property {string[]} fieldKeys - the field keys, in declaration order.
 * @property {Map<string, object>} fields - the field descriptors, by key.
 * @property {object[]} groups - the group descriptors, in page order.
 * @property {string} localeGlobal - the name the copy is published under.
 */

/**
 * Read one locale file's `settings` dictionary.
 *
 * @param {string} language - the language id, which is also the file name.
 * @param {string[]} problems - the problems found so far; a missing object joins them.
 * @returns {Record<string, string>} the dictionary, or an empty one.
 */
function readDictionary(language, problems) {
  const file = path.join(ROOT, 'locale', `${language}.json`)
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  const settings = parsed?.settings
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    problems.push(`locale/${language}.json must declare a "settings" object`)
    return {}
  }
  return settings
}
// --- the checks ------------------------------------------------------------

/**
 * The modules the bundle names must be in the shell's static table.
 *
 * The loader's own assertion fires first and would report an undeclared
 * module as a raw stack trace instead of a curated problem, so the source is
 * read before the bundle is evaluated.
 *
 * @param {string} source - the browser half's source.
 * @returns {string[]} the problems found.
 */
export function checkDeclaredExternals(source) {
  const problems = []
  const declared = new Set(
    [...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]),
  )
  for (const specifier of declared) {
    if (!STATIC_MODULES.includes(specifier)) {
      problems.push(
        `the client bundle requires "${specifier}", which is not a shell static module`
          + " (add it to dsh.client.external and to the loader's static module table)",
      )
    }
  }
  return problems
}

/**
 * The bundle must be a classic script that loads nothing at run time.
 *
 * The source is read without its comments: a JSDoc type reference names a
 * module the same way a runtime import would, and it is not one.
 *
 * @param {string} source - the browser half's source.
 * @returns {string[]} the problems found.
 */
export function checkScriptHygiene(source) {
  const problems = []
  if (/^\s*(import|export)\s/m.test(source)) {
    problems.push('the client bundle must be a classic script: no import/export statements')
  }
  const code = stripComments(source)
  // A classic script evaluated through `new Function` can still call the
  // dynamic `import()` form, and that would load a module outside the shell's
  // static table without any `require` the load contract sees.
  if (/\bimport\s*\(/.test(code) || /\bimport\s*\.\s*meta/.test(code)) {
    problems.push('the client bundle must not use dynamic import() or import.meta')
  }
  return problems
}

/**
 * The bundle must identify itself as the package and export what the page needs.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkBundleIdentity(context) {
  const problems = []
  const { registration, exported, manifest } = context
  if (registration.id !== manifest.name) {
    problems.push(
      `bundle id ${JSON.stringify(registration.id)} must equal the package name ${JSON.stringify(manifest.name)}`,
    )
  }
  if (!Array.isArray(exported.inject) || exported.inject.length === 0) {
    problems.push('the client bundle must export a non-empty inject list')
  }
  for (const name of ['apply', 'inject', 'NS', 'FIELD_META', 'HOST_API', 'PLUGIN_SURFACE']) {
    if (exported[name] === undefined) problems.push(`the client bundle must export ${name}`)
  }
  return problems
}

/**
 * The settings namespace must be the patch row id on both sides.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkNamespace(context) {
  const problems = []
  const { exported, patch } = context
  const namespace = context.host.namespace
  if (exported.NS !== namespace) {
    problems.push(
      `client namespace ${JSON.stringify(exported.NS)} must equal SETTINGS_NAMESPACE ${JSON.stringify(namespace)}`,
    )
  }
  if (!patch.includes(`id: ${namespace}`)) {
    problems.push(`cordis.patch.yml must mount a row whose id is ${namespace}`)
  }
  return problems
}
/**
 * The page must register into the Plugins panel's bundle slot, and nowhere else.
 *
 * The form is a bundle's own configuration on the Plugins page, in the
 * `plugins.bundle.config` keyed slot. That slot is keyed by the BUNDLE's
 * package name — the value the plugin manager's inventory compares against —
 * so the key is the package name and never the settings namespace. The
 * namespace stays load-bearing as the patch row id whose live form the page
 * binds to.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkPluginSurface(context) {
  const problems = []
  const { clientSource, exported, manifest } = context
  const surface = exported.PLUGIN_SURFACE
  if (surface === undefined) {
    problems.push('the client bundle must export PLUGIN_SURFACE')
    return problems
  }
  // The parameter page is the ROW's own page: the Plugins page renders the
  // entry through its keyed slot, and the row's Configure control opens it.
  // The bundle's page keeps its description, its rows and its source.
  if (surface.slot !== 'plugins.row.config') {
    problems.push(`the form must register into plugins.row.config, not ${JSON.stringify(surface.slot)}`)
  }
  const expectedKey = `${manifest.name}#${context.host.namespace}`
  if (surface.key !== expectedKey) {
    problems.push(
      `the plugins.row.config key ${JSON.stringify(surface.key)} must be ${JSON.stringify(expectedKey)}`,
    )
  }
  const packageNameConstant = /const PACKAGE_NAME = "([^"]+)"/.exec(clientSource)
  if (packageNameConstant === null) {
    problems.push('lib/client.js must declare PACKAGE_NAME for the plugins.row.config key')
  } else if (packageNameConstant[1] !== manifest.name) {
    problems.push(
      `lib/client.js PACKAGE_NAME ${JSON.stringify(packageNameConstant[1])} must equal the package name ${JSON.stringify(manifest.name)}`,
    )
  }
  // The registration takes its name from the constant rather than from a
  // literal, so what has to be there is the constant itself.
  if (!/const PLUGIN_SURFACE = Object\.freeze\(\{/.test(clientSource)) {
    problems.push('lib/client.js must declare the PLUGIN_SURFACE constant')
  }
  return problems
}

/**
 * The Settings dialog's section must exist, be gated by the page's own switch,
 * and take its names from the surface rather than from a literal.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkSettingsSection(context) {
  const problems = []
  const { clientSource, exported, host } = context
  const surface = exported.SETTINGS_SURFACE
  if (surface === undefined) {
    problems.push('the client bundle must export SETTINGS_SURFACE')
    return problems
  }
  if (surface.section !== 'settings.section') {
    problems.push(`the Settings section must be settings.section, not ${JSON.stringify(surface.section)}`)
  }
  if (surface.icon !== 'settings.section.icon') {
    problems.push(`the Settings icon must be settings.section.icon, not ${JSON.stringify(surface.icon)}`)
  }
  if (surface.id !== host.namespace) {
    problems.push(`the Settings section id must be the settings namespace ${JSON.stringify(host.namespace)}`)
  }
  // The switch is what keeps a fresh profile at one configuration page, so it
  // has to be a setting the host declares.
  if (!host.fieldKeys.includes(surface.field)) {
    problems.push(`the host must declare the ${surface.field} setting the Settings section is gated by`)
  }
  // The two slot names may only be spelled in the surface constant: a literal
  // somewhere else is a registration the gate cannot see. The constant is cut
  // out of the source first, so what is left is everything else.
  const constant = /const SETTINGS_SURFACE = Object\.freeze\(\{[\s\S]*?\n\t*\}\)/.exec(clientSource)
  if (constant === null) {
    problems.push('lib/client.js must declare the SETTINGS_SURFACE constant')
  } else {
    const outside = clientSource.replace(constant[0], '')
    for (const name of ['settings.section', 'settings.section.icon']) {
      if (outside.includes(name)) {
        problems.push(`the slot name ${name} may only appear in the SETTINGS_SURFACE constant`)
      }
    }
  }
  return problems
}

/**
 * The two field tables must agree, key by key and in order.
 *
 * The copy is not part of the duplicated table any more: it lives in the
 * locale files, so what is compared here is the page's SHAPE — the control,
 * its options, its bounds — against the host's.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkFieldTable(context) {
  const problems = []
  const clientFields = context.exported.FIELD_META ?? []
  const fieldKeys = context.host.fieldKeys
  if (clientFields.length !== fieldKeys.length) {
    problems.push(`client declares ${clientFields.length} fields but the host schema declares ${fieldKeys.length}`)
  }
  const hostOrder = [...context.host.fields.keys()]
  const clientOrder = clientFields.map((field) => field.key)
  if (hostOrder.join(',') !== clientOrder.join(',')) {
    problems.push(`field order differs:\n  host:   ${hostOrder.join(', ')}\n  client: ${clientOrder.join(', ')}`)
  }
  for (const field of clientFields) {
    const host = context.host.fields.get(field.key)
    if (host === undefined) {
      problems.push(`client declares unknown field "${field.key}"`)
      continue
    }
    if (host.kind !== field.kind) {
      problems.push(`field "${field.key}": host kind ${host.kind} != client kind ${field.kind}`)
    }
    if (host.options !== undefined) {
      const hostOptions = host.options.join('|')
      const clientOptions = (field.options ?? []).join('|')
      if (hostOptions !== clientOptions) {
        problems.push(`field "${field.key}": host options [${hostOptions}] != client options [${clientOptions}]`)
      }
    }
    // A placeholder is a flag on the client (the text is looked up by key),
    // so the two agree on whether the field has one, not on what it says.
    if ((host.placeholder !== undefined) !== (field.placeholder !== undefined)) {
      problems.push(
        `field "${field.key}": host placeholder ${JSON.stringify(host.placeholder ?? null)}`
          + ` != client placeholder ${JSON.stringify(field.placeholder ?? null)}`,
      )
    } else if (field.placeholder !== undefined && field.placeholder !== true) {
      problems.push(`field "${field.key}": the client placeholder must be the flag true, not ${JSON.stringify(field.placeholder)}`)
    }
    // The browser half refuses to stage a number outside the range the host
    // declares, so the two ranges are part of the duplicated table too.
    for (const bound of ['min', 'max']) {
      if ((host[bound] ?? undefined) !== (field[bound] ?? undefined)) {
        problems.push(
          `field "${field.key}": host ${bound} ${JSON.stringify(host[bound] ?? null)}`
            + ` != client ${bound} ${JSON.stringify(field[bound] ?? null)}`,
        )
      }
    }
    // A discovery field's options come from the list its `suggest` names, so
    // the two halves have to name the same list: a field that read the devices
    // on one side and the runtimes on the other would offer the wrong options
    // without anything failing.
    if ((host.suggest ?? undefined) !== (field.suggest ?? undefined)) {
      problems.push(
        `field "${field.key}": host suggest ${JSON.stringify(host.suggest ?? null)}`
          + ` != client suggest ${JSON.stringify(field.suggest ?? null)}`,
      )
    }
  }
  return problems
}

/**
 * Every discovery field must name a list the page actually builds.
 *
 * A `discovery` field's options come from the inventory route, and the page
 * builds one list per source in `buildSuggestions`. A `suggest` name the page
 * does not provide yields `undefined`, which becomes an empty list and empties
 * the dropdown silently — the field still renders, so nothing else notices.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkDiscoverySources(context) {
  const problems = []
  const sources = context.exported.DISCOVERY_SOURCES
  if (!Array.isArray(sources)) {
    problems.push('lib/client.js must export DISCOVERY_SOURCES so the gate can check the discovery lists')
    return problems
  }
  for (const field of context.exported.FIELD_META ?? []) {
    if (field.kind !== 'discovery') continue
    if (typeof field.suggest !== 'string' || field.suggest.length === 0) {
      problems.push(`field "${field.key}" is a discovery field but names no suggest source`)
      continue
    }
    if (!sources.includes(field.suggest)) {
      problems.push(
        `field "${field.key}" reads the discovery list "${field.suggest}", which the page does not build`
          + ` (it builds: ${sources.join(', ')})`,
      )
    }
  }
  return problems
}

/**
 * The two group tables must agree, and each group must hold the fields it claims.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkGroupTable(context) {
  const problems = []
  const clientGroups = context.exported.GROUP_META ?? []
  const groups = context.host.groups
  if (clientGroups.length !== groups.length) {
    problems.push(`client declares ${clientGroups.length} groups but the host schema declares ${groups.length}`)
    return problems
  }
  for (const [index, host] of groups.entries()) {
    const client = clientGroups[index]
    if (client.id !== host.id) {
      problems.push(`group ${index}: host id ${host.id} != client id ${client.id}`)
      continue
    }
    // Which card a field renders on is part of the table, not decoration: the
    // page draws one card per group, so a field moved to another group on the
    // client side alone would leave the two halves describing different
    // layouts. The client publishes each group's field keys for this check.
    const hostFields = host.fields.map((field) => field.key)
    const clientFieldKeys = Array.isArray(client.fields) ? client.fields : []
    if (hostFields.join(',') !== clientFieldKeys.join(',')) {
      problems.push(
        `group "${host.id}": host fields [${hostFields.join(', ')}]`
          + ` != client fields [${clientFieldKeys.join(', ')}]`,
      )
    }
  }
  return problems
}
/**
 * The three routes must be registered by the host and called by the page.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkRoutes(context) {
  const problems = []
  const { clientSource, hostSource } = context
  const hostPrefix = /const ROUTE_PREFIX = '([^']+)'/.exec(hostSource)?.[1]
  if (hostPrefix === undefined) {
    problems.push('lib/index.js must declare ROUTE_PREFIX')
    return problems
  }
  for (const route of ['host', 'status', 'inventory']) {
    if (!clientSource.includes(`"${hostPrefix}/${route}"`)) {
      problems.push(`the client page does not call the host route ${route}`)
    }
    // Any helper that registers a route counts: the name of the helper is an
    // implementation detail, and the gate's question is whether the route is
    // registered at all.
    if (!new RegExp(`\\w*[Rr]oute\\('${route}'`).test(hostSource)) {
      problems.push(`lib/index.js does not register the ${route} route`)
    }
  }
  return problems
}

/**
 * Every key the page can look up must exist in both locale files.
 *
 * The keys are derived: the chrome the client exports, the groups and fields
 * the host declares, the placeholders the fields carry, and the option labels
 * the client lists. A key the page looks up but the files do not declare
 * renders as itself.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkDictionaryCoverage(context) {
  const problems = []
  const { exported, localeEn, localeZh } = context
  const clientFields = exported.FIELD_META ?? []
  const expected = new Set()
  for (const key of exported.FIXED_KEYS ?? []) expected.add(key)
  for (const group of context.host.groups) {
    expected.add(`group.${group.id}`)
    expected.add(`group.${group.id}.hint`)
  }
  for (const field of context.host.fields.values()) {
    expected.add(`field.${field.key}`)
    expected.add(`field.${field.key}.hint`)
    if (field.placeholder !== undefined) expected.add(`field.${field.key}.placeholder`)
    // A discovery dropdown always offers an entry for the unset value, and its
    // label is looked up under this key. The key is derived from the field
    // table rather than listed by hand in the browser half, so a third
    // discovery field cannot ship a page that renders the raw key.
    if (field.kind === 'discovery') expected.add(`option.${field.key}.any`)
  }
  for (const field of clientFields) {
    for (const value of field.optionLabel ?? []) expected.add(`option.${field.key}.${value}`)
  }
  for (const key of expected) {
    if (typeof localeEn[key] !== 'string' || localeEn[key].length === 0) {
      problems.push(`locale/en.json declares no "${key}"`)
    }
    if (typeof localeZh[key] !== 'string' || localeZh[key].length === 0) {
      problems.push(`locale/zh.json declares no "${key}"`)
    }
  }
  return problems
}

/**
 * The two locale files must declare the same keys, and no key nothing looks up.
 *
 * A key that exists in one file and not the other renders as the key itself in
 * that language. A key nothing looks up is a key that looks like copy but is
 * never rendered, so nothing will ever notice it go stale.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkDictionarySymmetry(context) {
  const problems = []
  const { localeEn, localeZh } = context
  const enKeys = Object.keys(localeEn).sort()
  const zhKeys = Object.keys(localeZh).sort()
  if (enKeys.join(',') !== zhKeys.join(',')) {
    const onlyEn = enKeys.filter((key) => !zhKeys.includes(key))
    const onlyZh = zhKeys.filter((key) => !enKeys.includes(key))
    problems.push(
      `the locale files declare different keys`
        + (onlyEn.length > 0 ? `; only in en: ${onlyEn.join(', ')}` : '')
        + (onlyZh.length > 0 ? `; only in zh: ${onlyZh.join(', ')}` : ''),
    )
  }
  const expected = new Set()
  for (const key of context.exported.FIXED_KEYS ?? []) expected.add(key)
  for (const group of context.host.groups) {
    expected.add(`group.${group.id}`)
    expected.add(`group.${group.id}.hint`)
  }
  for (const field of context.host.fields.values()) {
    expected.add(`field.${field.key}`)
    expected.add(`field.${field.key}.hint`)
    if (field.placeholder !== undefined) expected.add(`field.${field.key}.placeholder`)
    // The unset entry a discovery dropdown offers is looked up under this
    // key, so a discovery field declares it whether or not the browser half
    // lists it by hand.
    if (field.kind === 'discovery') expected.add(`option.${field.key}.any`)
  }
  for (const field of context.exported.FIELD_META ?? []) {
    for (const value of field.optionLabel ?? []) expected.add(`option.${field.key}.${value}`)
  }
  for (const key of enKeys) {
    if (!expected.has(key)) problems.push(`locale/en.json declares "${key}", which no control looks up`)
  }
  return problems
}

/**
 * The browser half must carry no copy of its own.
 *
 * A `{zh, en}` literal or a CJK string in the bundle is a second source that
 * will drift. The bundle's identifiers and keys are ASCII, so any CJK inside
 * a string literal is copy that escaped the locale files.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkNoInlineCopy(context) {
  const problems = []
  const code = context.clientCode
  if (/\{\s*zh\s*:\s*["'`][^"'`]*["'`]\s*,\s*en\s*:/.test(code)) {
    problems.push(
      'lib/client.js must not carry inline copy: a `{zh: …, en: …}` literal belongs in locale/en.json and locale/zh.json',
    )
  }
  const cjk = /["'`][^"'`\n]*[\u4e00-\u9fff][^"'`\n]*["'`]/.exec(code)
  if (cjk !== null) {
    problems.push(
      `lib/client.js must not carry inline copy: the CJK string ${JSON.stringify(cjk[0])} belongs in locale/zh.json`,
    )
  }
  return problems
}

/**
 * The two halves must agree on the name the copy is published under.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkLocaleGlobal(context) {
  const problems = []
  const global = context.exported.LOCALE_GLOBAL
  if (global === undefined) {
    problems.push('lib/client.js must export the name it reads the copy from')
    return problems
  }
  if (global !== context.host.localeGlobal) {
    problems.push(
      `the copy global differs: client ${JSON.stringify(global)}`
        + ` != host ${JSON.stringify(context.host.localeGlobal)}`,
    )
  }
  return problems
}
/**
 * The page must decide the macOS question without a request, and agree with the host.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkMacOsGate(context) {
  const problems = []
  const { clientSource, exported } = context
  if (!/REQUIRED_PLATFORM = "darwin"/.test(clientSource)) {
    problems.push('the client page must declare the required platform (darwin)')
  }
  if (!/hostUnsupportedTitle/.test(clientSource) || !/hostUnsupportedBody/.test(clientSource)) {
    problems.push('the client page must carry the "only supports macOS" notice keys')
  }
  if (!/export function requireMacOS/.test(readFileSync(path.join(ROOT, 'lib', 'providers', 'host.js'), 'utf8'))) {
    problems.push('the host half must keep the requireMacOS gate')
  }
  const hostInfo = exported.HOST_API
  if (hostInfo?.requiredPlatform !== 'darwin') problems.push('the client host API must pin the required platform')
  if (hostInfo?.detectClientPlatform({ platform: 'MacIntel' })?.supported !== true) {
    problems.push('the client host API must treat a Mac user agent as supported')
  }
  if (hostInfo?.detectClientPlatform({ platform: 'Linux x86_64' })?.supported !== false) {
    problems.push('the client host API must treat a Linux user agent as unsupported')
  }
  if (hostInfo?.hostVerdict({ platform: 'linux', supported: false }, { supported: true })?.source !== 'host') {
    problems.push('the host route verdict must win over the browser guess')
  }
  return problems
}

/**
 * The modules the bundle actually asked for must be in the shell's static table.
 *
 * The loader already refuses a module outside the table, so what reaches this
 * point is the set the bundle really asked for.
 *
 * @param {GateContext} context - what the checks read.
 * @returns {string[]} the problems found.
 */
export function checkRequiredModules(context) {
  const problems = []
  for (const specifier of new Set(context.required)) {
    if (!STATIC_MODULES.includes(specifier)) {
      problems.push(`the client bundle requires "${specifier}", which is not a shell static module`)
    }
  }
  return problems
}

/**
 * Every check, in the order the gate runs them.
 *
 * The two source-only checks come first: the loader cannot evaluate the bundle
 * once an undeclared module is in it, so a failure there has to stop the run
 * before the bundle is loaded.
 *
 * @type {ReadonlyArray<{name: string, run: (context: GateContext) => string[]}>}
 */
export const CHECKS = Object.freeze([
  { name: 'the bundle declares only shell static modules', run: (context) => checkDeclaredExternals(context.clientSource) },
  { name: 'the bundle is a classic script that loads nothing at run time', run: (context) => checkScriptHygiene(context.clientSource) },
  { name: 'the bundle identifies itself as the package', run: checkBundleIdentity },
  { name: 'the settings namespace is the patch row id', run: checkNamespace },
  { name: 'the page registers into the Plugins panel', run: checkPluginSurface },
  { name: 'the Settings section is gated by the page\'s own switch', run: checkSettingsSection },
  { name: 'the two field tables agree', run: checkFieldTable },
  { name: 'the two group tables agree', run: checkGroupTable },
  { name: 'every discovery field names a list the page builds', run: checkDiscoverySources },
  { name: 'the three routes agree', run: checkRoutes },
  { name: 'every key the page looks up is in both locale files', run: checkDictionaryCoverage },
  { name: 'the two locale files declare the same keys', run: checkDictionarySymmetry },
  { name: 'the browser half carries no copy of its own', run: checkNoInlineCopy },
  { name: 'the two halves agree on the copy global', run: checkLocaleGlobal },
  { name: 'the macOS gate is intact', run: checkMacOsGate },
  { name: 'the bundle asks only for shell static modules', run: checkRequiredModules },
])

/**
 * The host half's own tables.
 *
 * The host half is imported LAZILY, so a locale file it cannot read is a
 * problem the gate reports rather than an exception that kills it: the host
 * reads its copy at import time, and a key missing from either locale file
 * throws there.
 *
 * @returns {Promise<HostTables>} the tables.
 */
async function loadHostTables() {
  const settings = await import('../lib/settings.js')
  const host = await import('../lib/index.js')
  return {
    namespace: settings.SETTINGS_NAMESPACE,
    fieldKeys: settings.FIELD_KEYS,
    fields: settings.FIELDS,
    groups: settings.FIELD_GROUPS,
    localeGlobal: host.LOCALE_GLOBAL,
  }
}

/**
 * Read everything the checks read.
 *
 * @returns {GateContext} the context.
 */
export async function buildContext() {
  const clientSource = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const { registration, exported, required } = loadBundle()
  const problems = []
  const localeEn = readDictionary('en', problems)
  const localeZh = readDictionary('zh', problems)
  if (problems.length > 0) throw new Error(problems.join('\n'))
  return {
    clientSource,
    clientCode: stripComments(clientSource),
    hostSource: readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8'),
    patch: readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8'),
    manifest: JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')),
    registration,
    exported,
    required,
    localeEn,
    localeZh,
    host: await loadHostTables(),
  }
}

/**
 * Run every check and report the ones that failed.
 *
 * @returns {number} the number of problems found.
 */
export async function main() {
  const clientSource = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  // The source checks run first and alone: the loader cannot evaluate the
  // bundle once an undeclared module is in it, so a failure there has to stop
  // the run before the bundle is loaded.
  const early = [...checkDeclaredExternals(clientSource), ...checkScriptHygiene(clientSource)]
  if (early.length > 0) {
    console.error(`check-bundle: ${early.length} problem(s)\n`)
    for (const message of early) console.error(`  - ${message}`)
    process.exit(1)
  }
  let context
  try {
    context = await buildContext()
  } catch (error) {
    // The host half reads its copy at import time, so a locale file it cannot
    // read throws there. That is a problem the gate found, not a crash.
    const message = error instanceof Error ? error.message : String(error)
    console.error('check-bundle: 1 problem(s)\n')
    console.error(`  - the host half could not be loaded: ${message}`)
    process.exit(1)
  }
  const problems = []
  for (const check of CHECKS) problems.push(...check.run(context))
  if (problems.length > 0) {
    console.error(`check-bundle: ${problems.length} problem(s)\n`)
    for (const message of problems) console.error(`  - ${message}`)
    process.exit(1)
  }
  const fields = context.exported.FIELD_META ?? []
  console.log(
    `check-bundle: OK — bundle id, namespace, plugin surface, ${fields.length} fields, ${Object.keys(context.localeEn).length} locale keys, 3 routes, the macOS gate and script hygiene all agree.`,
  )
  return 0
}

/**
 * Whether this file is the process's entry point.
 *
 * The comparison resolves both sides through `realpathSync`, because a
 * temporary directory on macOS is a symlink: `os.tmpdir()` answers
 * `/var/folders/...` while the same path resolved is
 * `/private/var/folders/...`, and the naive comparison would never match. A
 * gate that silently did nothing would look exactly like a gate that passed.
 *
 * @returns {boolean} whether this file was run rather than imported.
 */
export function isEntryPoint() {
  const entry = process.argv[1]
  if (entry === undefined) return false
  const self = fileURLToPath(import.meta.url)
  try {
    return realpathSync(self) === realpathSync(entry)
  } catch {
    return self === entry
  }
}

if (isEntryPoint()) await main()