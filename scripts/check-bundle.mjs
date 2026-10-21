#!/usr/bin/env node
import process from 'node:process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FIELD_GROUPS, FIELD_KEYS, FIELDS, SETTINGS_NAMESPACE } from '../lib/settings.js'
import { ROOT, STATIC_MODULES, loadBundle } from '../test/helpers/load-bundle.mjs'

/**
 * Consistency gate for the browser bundle.
 *
 * The client half cannot import the host's settings module — the client bundle
 * purity gate forbids cross-plugin value imports — so the field table, the
 * settings namespace and the three route paths are written twice. This script
 * is the check that keeps the two copies identical, plus the structural checks
 * a host-side test cannot make about a file the browser evaluates on its own.
 *
 * Run with `pnpm run check`.
 */

const failures = []

/** Record one failed invariant. */
function fail(message) {
  failures.push(message)
}

/**
 * Compare one localized string pair between the host table and the client.
 *
 * Both sides carry `{zh, en}`; a missing pair on either side is a difference
 * too, because a field that lost its hint on one side renders differently in
 * that language.
 *
 * @param {string} subject - what is being compared, for the message.
 * @param {string} part - the property name, for the message.
 * @param {{zh: string, en: string} | undefined} host - the host's value.
 * @param {{zh: string, en: string} | undefined} client - the client's value.
 */
function compareLocalized(subject, part, host, client) {
  if (host === undefined && client === undefined) return
  if (host === undefined || client === undefined) {
    fail(
      `${subject}.${part}: host ${JSON.stringify(host ?? null)} != client ${JSON.stringify(client ?? null)}`,
    )
    return
  }
  for (const language of ['zh', 'en']) {
    if (host[language] !== client[language]) {
      fail(
        `${subject}.${part}.${language}: host ${JSON.stringify(host[language])}`
          + ` != client ${JSON.stringify(client[language])}`,
      )
    }
  }
}

// The externals are checked from the source text, before the bundle is
// evaluated: the loader's own assertion fires first and would report an
// undeclared module as a raw stack trace instead of a curated problem. A
// failure here stops the run, because the loader cannot even evaluate the
// bundle once an undeclared module is in it.
const clientSource = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const declaredExternals = new Set(
  [...clientSource.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]),
)
for (const specifier of declaredExternals) {
  if (!STATIC_MODULES.includes(specifier)) {
    fail(
      `the client bundle requires "${specifier}", which is not a shell static module`
        + " (add it to dsh.client.external and to the loader's static module table)",
    )
  }
}
if (failures.length > 0) {
  console.error(`check-bundle: ${failures.length} problem(s)\n`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

const { registration, exported, required } = loadBundle()

// --- bundle identity -------------------------------------------------------
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
if (registration.id !== manifest.name) {
  fail(`bundle id ${JSON.stringify(registration.id)} must equal the package name ${JSON.stringify(manifest.name)}`)
}
if (!Array.isArray(exported.inject) || exported.inject.length === 0) {
  fail('the client bundle must export a non-empty inject list')
}
for (const name of ['apply', 'inject', 'NS', 'FIELD_META', 'HOST_API', 'PLUGIN_SURFACE']) {
  if (exported[name] === undefined) fail(`the client bundle must export ${name}`)
}

// --- namespace agreement ---------------------------------------------------
if (exported.NS !== SETTINGS_NAMESPACE) {
  fail(`client namespace ${JSON.stringify(exported.NS)} must equal SETTINGS_NAMESPACE ${JSON.stringify(SETTINGS_NAMESPACE)}`)
}
const patch = readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
if (!patch.includes(`id: ${SETTINGS_NAMESPACE}`)) {
  fail(`cordis.patch.yml must mount a row whose id is ${SETTINGS_NAMESPACE}`)
}

// --- plugin surface agreement ---------------------------------------------
// The form is not a Settings dialog section any more: it is a bundle's own
// configuration on the Plugins page, in the `plugins.bundle.config` keyed slot.
// That slot is keyed by the BUNDLE's package name — the value the plugin
// manager's inventory compares against — so the key is the package name and
// never the settings namespace above. The namespace stays load-bearing as the
// patch row id whose live form the page binds to.
const surface = exported.PLUGIN_SURFACE
if (surface === undefined) {
  fail('the client bundle must export PLUGIN_SURFACE')
} else {
  if (surface.slot !== 'plugins.bundle.config') {
    fail(`the form must register into plugins.bundle.config, not ${JSON.stringify(surface.slot)}`)
  }
  if (surface.key !== manifest.name) {
    fail(
      `the plugins.bundle.config key ${JSON.stringify(surface.key)} must equal the package name ${JSON.stringify(manifest.name)}`,
    )
  }
}
const packageNameConstant = /const PACKAGE_NAME = "([^"]+)"/.exec(clientSource)
if (packageNameConstant === null) {
  fail('lib/client.js must declare PACKAGE_NAME for the plugins.bundle.config key')
} else if (packageNameConstant[1] !== manifest.name) {
  fail(`lib/client.js PACKAGE_NAME ${JSON.stringify(packageNameConstant[1])} must equal the package name ${JSON.stringify(manifest.name)}`)
}
if (!clientSource.includes('name: "plugins.bundle.config"')) {
  fail('lib/client.js must register into plugins.bundle.config')
}
if (clientSource.includes('"settings.section"')) {
  fail('lib/client.js must not register into the Settings dialog: plugin pages live on the Plugins page')
}

// --- field table agreement -------------------------------------------------
const clientFields = exported.FIELD_META ?? []
if (clientFields.length !== FIELD_KEYS.length) {
  fail(`client declares ${clientFields.length} fields but the host schema declares ${FIELD_KEYS.length}`)
}
const hostOrder = [...FIELDS.keys()]
const clientOrder = clientFields.map((field) => field.key)
if (hostOrder.join(',') !== clientOrder.join(',')) {
  fail(`field order differs:\n  host:   ${hostOrder.join(', ')}\n  client: ${clientOrder.join(', ')}`)
}
for (const field of clientFields) {
  const host = FIELDS.get(field.key)
  if (host === undefined) {
    fail(`client declares unknown field "${field.key}"`)
    continue
  }
  if (host.kind !== field.kind) {
    fail(`field "${field.key}": host kind ${host.kind} != client kind ${field.kind}`)
  }
  if (host.options !== undefined) {
    const hostOptions = host.options.join('|')
    const clientOptions = (field.options ?? []).join('|')
    if (hostOptions !== clientOptions) {
      fail(`field "${field.key}": host options [${hostOptions}] != client options [${clientOptions}]`)
    }
  }
  // The labels and hints are the bulk of the duplicated table — about 3,600
  // characters across two languages — and comparing only the keys left every
  // one of them unchecked. The client therefore publishes the same metadata
  // the host declares, and the two are compared field by field here.
  compareLocalized(`field "${field.key}"`, 'label', host.label, field.label)
  compareLocalized(`field "${field.key}"`, 'hint', host.hint, field.hint)
  if ((host.placeholder ?? undefined) !== (field.placeholder ?? undefined)) {
    fail(
      `field "${field.key}": host placeholder ${JSON.stringify(host.placeholder ?? null)}`
        + ` != client placeholder ${JSON.stringify(field.placeholder ?? null)}`,
    )
  }
}

// --- group table agreement --------------------------------------------------
const clientGroups = exported.GROUP_META ?? []
if (clientGroups.length !== FIELD_GROUPS.length) {
  fail(`client declares ${clientGroups.length} groups but the host schema declares ${FIELD_GROUPS.length}`)
} else {
  for (const [index, host] of FIELD_GROUPS.entries()) {
    const client = clientGroups[index]
    if (client.id !== host.id) {
      fail(`group ${index}: host id ${host.id} != client id ${client.id}`)
      continue
    }
    compareLocalized(`group "${host.id}"`, 'title', host.title, client.title)
    compareLocalized(`group "${host.id}"`, 'hint', host.hint, client.hint)
  }
}

// --- route agreement -------------------------------------------------------
const hostSource = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const hostPrefix = /const ROUTE_PREFIX = '([^']+)'/.exec(hostSource)?.[1]
if (hostPrefix === undefined) {
  fail('lib/index.js must declare ROUTE_PREFIX')
} else {
  for (const route of ['host', 'status', 'inventory']) {
    if (!clientSource.includes(`"${hostPrefix}/${route}"`)) fail(`the client page does not call the host route ${route}`)
    if (!hostSource.includes(`route('${route}'`)) fail(`lib/index.js does not register the ${route} route`)
  }
}

// --- the macOS-only notice -------------------------------------------------
// The page must decide this without a request (a non-macOS browser must be told
// immediately), and the host must expose the same verdict for confirmation.
if (!/REQUIRED_PLATFORM = "darwin"/.test(clientSource)) {
  fail('the client page must declare the required platform (darwin)')
}
if (!/hostUnsupportedTitle/.test(clientSource) || !/hostUnsupportedBody/.test(clientSource)) {
  fail('the client page must carry the "only supports macOS" notice keys')
}
if (!/export function requireMacOS/.test(readFileSync(path.join(ROOT, 'lib', 'providers', 'host.js'), 'utf8'))) {
  fail('the host half must keep the requireMacOS gate')
}
const hostInfo = exported.HOST_API
if (hostInfo?.requiredPlatform !== 'darwin') fail('the client host API must pin the required platform')
if (hostInfo?.detectClientPlatform({ platform: 'MacIntel' })?.supported !== true) {
  fail('the client host API must treat a Mac user agent as supported')
}
if (hostInfo?.detectClientPlatform({ platform: 'Linux x86_64' })?.supported !== false) {
  fail('the client host API must treat a Linux user agent as unsupported')
}
if (hostInfo?.hostVerdict({ platform: 'linux', supported: false }, { supported: true })?.source !== 'host') {
  fail('the host route verdict must win over the browser guess')
}

// --- client bundle hygiene -------------------------------------------------
if (/^\s*(import|export)\s/m.test(clientSource)) {
  fail('the client bundle must be a classic script: no import/export statements')
}
// The loader already refuses a module outside the shell's static table, so
// what reaches this point is the set the bundle actually asked for. It is
// compared against the same table rather than a hand-written subset of it: the
// subset used to be three entries long, and every other shell module the
// bundle legitimately needs was only a warning.
for (const specifier of new Set(required)) {
  if (!STATIC_MODULES.includes(specifier)) {
    fail(`the client bundle requires "${specifier}", which is not a shell static module`)
  }
}

if (failures.length > 0) {
  console.error(`check-bundle: ${failures.length} problem(s)\n`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

console.log(
  `check-bundle: OK — bundle id, namespace, plugin surface, ${clientFields.length} fields, 3 routes, the macOS gate and script hygiene all agree.`,
)
