import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT, STATIC_MODULES, loadBundle } from './helpers/load-bundle.mjs'
import { FIELD_KEYS, SETTINGS_NAMESPACE } from '../lib/settings.js'

/**
 * Structural verification of the browser bundle.
 *
 * The client half is a hand-written `window.__ModuleLoader__.load({…})` script,
 * not a build artifact, so nothing else would catch a bundle the host cannot
 * load. These tests execute it against the shell's own contract: a classic
 * script, the frozen static module table, and the factory's returned exports.
 */

test('client bundle registers under the package name', () => {
  const { registration } = loadBundle()
  assert.equal(registration.id, 'dsh-ios-simulator-helper')
  assert.equal(typeof registration.factory, 'function')
})

test('client bundle exports apply, inject, its namespace and its host API', () => {
  const { exported } = loadBundle()
  assert.equal(typeof exported.apply, 'function')
  assert.deepEqual(exported.inject, ['slots', 'locale', 'configForms'])
  assert.equal(exported.NS, SETTINGS_NAMESPACE)
  assert.equal(exported.HOST_API.requiredPlatform, 'darwin')
  assert.equal(exported.HOST_API.detectClientPlatform({ platform: 'MacIntel' }).supported, true)
  assert.equal(exported.HOST_API.detectClientPlatform({ platform: 'Linux x86_64' }).supported, false)
})

test('the client field table matches the host schema exactly', () => {
  const { exported } = loadBundle()
  const client = exported.FIELD_META
  assert.deepEqual(client.map((field) => field.key), FIELD_KEYS)
})

test('client bundle resolves only modules from the static table', () => {
  const { required } = loadBundle()
  assert.ok(required.length > 0, 'the bundle requires at least React')
  for (const specifier of required) {
    assert.ok(STATIC_MODULES.includes(specifier), `unexpected require: ${specifier}`)
  }
})

test('client bundle is a classic script, not an ES module', () => {
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.ok(!/^\s*import\s/m.test(source), 'bundle must not use import statements')
  assert.ok(!/^\s*export\s/m.test(source), 'bundle must not use export statements')
  assert.match(source, /window\.__ModuleLoader__\.load\(\{/)
})

test('client bundle tags its stylesheet for framework reclamation', () => {
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(source, /tag\.dataset\.pluginCss = CSS_TAG/)
  assert.match(source, /tag\.dataset\.plugin = "dsh-ios-simulator-helper"/)
})

test('client bundle calls exactly the routes the host registers', () => {
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  for (const route of ['/host', '/status', '/inventory']) {
    assert.ok(source.includes(`"/api/ios-simulator-helper${route}"`), `the page must call ${route}`)
  }
})
