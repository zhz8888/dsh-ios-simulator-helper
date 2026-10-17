import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Contract tests for the package manifest and the Cordis patch.
 *
 * These are the fields DSH reads before it ever loads the plugin, so a wrong
 * value fails the whole profile boot rather than one tool call.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/**
 * Expand the `files` field the way a packer does: a directory entry ships its
 * whole subtree, a file entry ships itself, and the always-included files count
 * regardless.
 *
 * @param {string[]} entries - the manifest's `files` list.
 * @param {string} root - the package root.
 * @returns {Set<string>} package-relative paths that would be published.
 */
function shippedPaths(entries, root) {
  const out = new Set(['package.json', 'LICENSE', 'README.md', 'README.zh-CN.md'])
  const walk = (rel) => {
    const abs = path.join(root, rel)
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs)) walk(path.join(rel, name))
      return
    }
    out.add(rel)
  }
  for (const entry of entries) walk(entry)
  return out
}

test('package name is the client module id', () => {
  // The web shell keys its module graph by the package name and the bundle id
  // must match it, so this name is load-bearing in three places: the manifest,
  // the client bundle id, and the row the bundle patch mounts.
  assert.equal(manifest.name, '@zhz8888/dsh-ios-simulator-helper')
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(source, /id: "@zhz8888\/dsh-ios-simulator-helper"/)
})

test('a plugin list can read a localized display name and description', () => {
  // The harness resolves `<package>/locale/en.json` through the package exports
  // and falls back to the raw package name when it cannot — a fallback with no
  // error anywhere, which is why the export, the shipped directory and the two
  // dictionaries are all pinned here. A missing en.json also drops every other
  // language file, so `en.json` is not optional.
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.ok(manifest.files.includes('locale'), 'the published package must ship locale/')
  const dictionaries = Object.fromEntries(
    ['en', 'zh'].map((language) => [
      language,
      JSON.parse(readFileSync(path.join(ROOT, 'locale', `${language}.json`), 'utf8')),
    ]),
  )
  assert.equal(dictionaries.en.meta.title, 'iOS Simulator Helper')
  assert.equal(dictionaries.zh.meta.title, 'iOS 模拟器助手')
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    assert.ok(dictionary.meta.description.length > 0, `${language} needs a description`)
    assert.ok(!dictionary.meta.title.includes('dsh-'), `${language} must not show the package name`)
    // The title names this plugin, not the Apple product it drives: the role
    // noun has to survive in every language, or the plugin reads as the
    // simulator itself.
    assert.match(dictionary.meta.title, /（?Helper|助手/, `${language} must name the helper, not the simulator`)
    // It is not Apple's plugin either, and every language has to say so.
    assert.match(
      dictionary.meta.description,
      /Not affiliated with Apple|与 Apple 无隶属关系/,
      `${language} needs the non-affiliation line`,
    )
  }
})

test('exports the host half and the client bundle', () => {
  assert.equal(manifest.exports['.'].default, './lib/index.js')
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert.equal(manifest.type, 'module')
})

test('declares the bundle patch and a web client half', () => {
  assert.equal(manifest.dsh.manifestVersion, 1)
  assert.equal(manifest.dsh.name, 'ios-simulator-helper')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
  ])
})

test('pins the DSH releases the host half is built against', () => {
  assert.match(manifest.peerDependencies['@deepseek-ai/dsh-tools'], /0\.2\.0-rc\.2/)
  assert.match(manifest.peerDependencies['@deepseek-ai/cordis'], /4\.0\.4/)
  assert.match(manifest.peerDependencies['@deepseek-ai/schemastery'], /3\.18\.4/)
})

test('official @deepseek-ai packages are peers, never runtime dependencies', () => {
  // The harness ships these packages, so a `dependencies` entry would make the
  // install resolve a second, unshared copy of a package the host already owns.
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    assert.ok(!name.startsWith('@deepseek-ai/'), `${name} must be a peerDependency, not a dependency`)
  }
})

test('a peer range naming a prerelease also names the next prerelease tuple', () => {
  // node-semver only lets a prerelease satisfy a range when some comparator on
  // the same major.minor.patch carries a prerelease tag itself: `^0.2.0-rc.2`
  // alone silently excludes 0.2.1-alpha.5, which is how users meet ERESOLVE.
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (!/-(?:rc|alpha|beta)\.\d+/.test(range)) continue
    assert.match(range, /\|\|/, `${name} needs an explicit branch for the next prerelease tuple`)
  }
})

test('the shipped files list covers every path the host reads at runtime', () => {
  for (const required of ['lib', 'skills', 'cordis.patch.yml']) {
    assert.ok(manifest.files.includes(required), `files must include ${required}`)
  }
})

test('every module the host imports is inside the published file set', () => {
  const shipped = shippedPaths(manifest.files, ROOT)
  const required = [
    'cordis.patch.yml',
    'ios-simulator.png',
    'lib/index.js',
    'lib/client.js',
    'lib/settings.js',
    'lib/runtime.js',
    'lib/tools/index.js',
    ...readdirSync(path.join(ROOT, 'lib', 'providers')).map((name) => `lib/providers/${name}`),
    ...readdirSync(path.join(ROOT, 'lib', 'util')).map((name) => `lib/util/${name}`),
    'skills/ios-dev/SKILL.md',
  ]
  for (const file of required) {
    assert.ok(shipped.has(file), `${file} is imported at runtime but not published`)
  }
  // Development-only trees must stay out of the published package.
  for (const file of shipped) {
    assert.ok(!file.startsWith('test/'), `test file published: ${file}`)
    assert.ok(!file.startsWith('scripts/'), `development script published: ${file}`)
    assert.ok(!file.startsWith('docs/'), `development document published: ${file}`)
    assert.ok(!file.endsWith('.log') && !file.endsWith('.tmp'), `stray file published: ${file}`)
  }
})

test('the declared plugin icon is the artwork, inside the loader limits', () => {
  // The icon is the one asset a plugin list or marketplace renders verbatim.
  // `dsh-app-boot` admits SVG, PNG, JPEG and WebP only, resolves the path inside
  // the manifest directory, and refuses anything over 256 KiB — so the format,
  // the square frame and the size budget are all part of the contract.
  assert.equal(manifest.icon, './ios-simulator.png')
  const file = path.join(ROOT, 'ios-simulator.png')
  assert.ok(existsSync(file), 'the icon the manifest names must exist')
  const bytes = readFileSync(file)
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'the icon must be a PNG',
  )
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  assert.equal(width, height, 'a plugin icon renders in a square seat')
  assert.ok(width >= 128, `too small to stay sharp at 36px: ${width}`)
  assert.ok(bytes.length <= 256 * 1024, 'dsh-app-boot refuses an icon over 256 KiB')
  assert.ok(!existsSync(path.join(ROOT, 'ios.svg')), 'the superseded icon must be removed')
  assert.ok(!existsSync(path.join(ROOT, 'icon.svg')), 'the superseded iconfont must stay gone')
})

test('the icon paints its own background, so it needs no light/dark variant', () => {
  // The superseded icon was a transparent monochrome wordmark and had to invert
  // itself for the dark theme. The artwork shipped now is opaque: it carries its
  // own background and reads the same on either theme, so an alpha channel here
  // would mean a half-transparent tile instead. The IHDR holds those two fields
  // at fixed offsets, which makes this checkable without an image decoder.
  const bytes = readFileSync(path.join(ROOT, 'ios-simulator.png'))
  assert.equal(bytes.readUInt8(24), 8, 'the IHDR bit depth must stay 8')
  assert.equal(bytes.readUInt8(25), 2, 'the IHDR colour type must stay truecolour without alpha')
})

test('the repository fields name the public repo a plugin list links to', () => {
  // The marketplace entry carries `url:` and the storefront reads this manifest
  // from that exact URL, so the two have to agree or the plugin is not linked.
  assert.equal(manifest.repository.url, 'git+https://github.com/zhz8888/dsh-ios-simulator-helper.git')
  assert.equal(manifest.homepage, 'https://github.com/zhz8888/dsh-ios-simulator-helper#readme')
  assert.equal(manifest.bugs.url, 'https://github.com/zhz8888/dsh-ios-simulator-helper/issues')
})

test('the screenshot manifest lists 1-8 images that exist inside the repo', () => {
  // `screenshots.json` next to package.json is what a storefront reads; the
  // paths are relative to it and may not leave the plugin directory.
  const file = path.join(ROOT, 'screenshots.json')
  assert.ok(existsSync(file), 'screenshots.json is missing')
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  const list = Array.isArray(parsed) ? parsed : parsed.screenshots
  assert.ok(Array.isArray(list), 'screenshots.json must be a list or {"screenshots": [...]}')
  assert.ok(list.length >= 1 && list.length <= 8, `expected 1-8 screenshots, saw ${list.length}`)
  for (const entry of list) {
    assert.equal(typeof entry, 'string', 'every screenshot entry must be a path')
    assert.ok(!entry.startsWith('/'), `${entry} must be relative to screenshots.json`)
    assert.ok(!entry.split('/').includes('..'), `${entry} must stay inside the plugin directory`)
    assert.match(entry, /\.(png|jpe?g|webp)$/i, `${entry} must be an image`)
    assert.ok(existsSync(path.join(ROOT, entry)), `${entry} is declared but missing`)
  }
})

test('the patch mounts exactly one row whose id is the settings namespace', () => {
  const patch = readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
  const inserts = [...patch.matchAll(/^\s*-\s+id:\s*(\S+)\s*$/gm)].map((match) => match[1])
  assert.deepEqual(inserts, ['ios-simulator-helper'])
  assert.match(patch, /name:\s*'@zhz8888\/dsh-ios-simulator-helper'/)
  const source = readFileSync(path.join(ROOT, 'lib', 'settings.js'), 'utf8')
  assert.match(source, /SETTINGS_NAMESPACE = 'ios-simulator-helper'/)
})

test('the bundled skill has the frontmatter DSH needs', () => {
  const skill = readFileSync(path.join(ROOT, 'skills', 'ios-dev', 'SKILL.md'), 'utf8')
  assert.match(skill, /^---\r?\n/)
  assert.match(skill, /^name: ios-dev$/m)
  assert.match(skill, /^description: .+$/m)
  assert.match(skill, /macOS/)
})
