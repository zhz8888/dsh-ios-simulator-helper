import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, pixelAt } from './helpers/decode-png.mjs'

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
  // The form registers into the Plugins page's slot, which the plugin-manager
  // client module declares; naming it here is what orders that module before
  // this bundle's browser half. `ui-settings` is what serves `configForms`.
  for (const module of [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-plugin-manager',
    '@deepseek-ai/dsh-client-ui-settings',
  ]) {
    assert.ok(manifest.dsh.client.inject.includes(module), `dsh.client.inject must name ${module}`)
  }
})

test('pins the DSH releases the host half is built against', () => {
  assert.match(manifest.peerDependencies['@deepseek-ai/dsh-tools'], /0\.2\.1-rc\.2/)
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

/**
 * The DSH requirement follows the radeon-cloud-patcher plugin's pattern: a
 * lower bound only, no upper bound, declared verbatim in three places. The
 * install path runs pnpm's peer resolution over the `@deepseek-ai/dsh*` peers,
 * and the 0.2.1 loader's compatibility check reads `engines.dsh` directly (an
 * own `engines.dsh` decides alone there), so a copy that drifts is a plugin the
 * loader refuses to mount. Asserting the three agree keeps the declaration
 * honest; `dshReleases` records the release actually exercised.
 */
test('the DSH range states a lower bound only, declared identically three times', () => {
  assert.equal(manifest.engines.dsh, '>=0.2.1-rc.2')
  assert.equal(manifest.dsh.compatibility.dsh, manifest.engines.dsh)
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-tools'], manifest.engines.dsh)
  assert.equal(manifest.dsh.compatibility.dshReleases['0.2.1-rc.2'], 'compatible')
  // No upper bound anywhere: `^`, `~` or `<` would mean re-releasing this
  // plugin every time the harness or a peer bumps a major.
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    assert.match(range, /^>=/, `${name} must state a lower bound only`)
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

test('the icon keys the grey backdrop out of the four corners', () => {
  // The artwork sits on a flat #F5F5F7 tile, which reads as a washed-out grey
  // square in a dark list, so the tile is keyed out and the blue artwork — which
  // carries its own contrast on either theme — now sits on whatever surface the
  // host paints. The key has to carry the edge colours outwards: erasing a flat
  // background naively leaves a rim of half-blended tile pixels, invisible on a
  // white page and glaring on dark. That is why this test decodes the sprite
  // instead of reading its header.
  const image = decodePng(readFileSync(path.join(ROOT, 'ios-simulator.png')))
  assert.equal(image.width, 192)
  assert.equal(image.height, 192)
  assert.equal(image.channels, 4, 'the icon must carry an alpha channel')

  // The whole corner region, not one pixel of it: the rounded corner is what
  // the tile was filling, and a 12 px inset is still inside it.
  const CORNER = 12
  const corners = [
    [0, 0],
    [image.width - CORNER, 0],
    [0, image.height - CORNER],
    [image.width - CORNER, image.height - CORNER],
  ]
  for (const [x0, y0] of corners) {
    for (let y = y0; y < y0 + CORNER; y += 1) {
      for (let x = x0; x < x0 + CORNER; x += 1) {
        assert.equal(pixelAt(image, x, y).a, 0, `the corner at ${x},${y} must be transparent`)
      }
    }
  }

  // Two halves of the same defect: a partially covered pixel that still carries
  // the tile's exact colour, and one pale enough to read as tile against a dark
  // host. The artwork's own pale pixels (the device shapes) are opaque, so the
  // second check only has to look at partial coverage.
  const TILE = { r: 245, g: 245, b: 247 }
  const TOLERANCE = 6
  let transparent = 0
  let palest = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const { r, g, b, a } = pixelAt(image, x, y)
      if (a === 0) {
        transparent += 1
        continue
      }
      if (a === 255) continue
      const offTile = Math.max(Math.abs(r - TILE.r), Math.abs(g - TILE.g), Math.abs(b - TILE.b))
      assert.ok(offTile > TOLERANCE, `the half-transparent pixel at ${x},${y} still carries the keyed-out tile colour`)
      palest = Math.max(palest, 0.299 * r + 0.587 * g + 0.114 * b)
    }
  }
  // The tile's own luma is 245, so a partially covered pixel this pale is a
  // leftover rim rather than artwork.
  assert.ok(palest < 200, `a half-transparent pixel is as pale as the keyed-out tile: ${palest.toFixed(0)}`)

  // The key must remove the tile without hollowing the artwork out.
  assert.equal(pixelAt(image, 96, 96).a, 255, 'the artwork itself must stay opaque')
  assert.ok(transparent > 4000, `the tile does not look keyed out: only ${transparent} transparent pixels`)
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

test('the ignore rules keep run artefacts out without hiding a tracked image', () => {
  // AGENTS.md says a run's screenshots, logs, DerivedData, scratch profiles,
  // tarballs and the verification documents are never committed. A blanket
  // `*.png` covered the captures, but it also ignored every PNG at every depth,
  // so a future figure or marketplace frame the repository means to track would
  // have been dropped by `git add` without a word. The rules are asserted
  // through `git check-ignore` rather than by reading the file, because it is
  // the resulting decision that commits depend on — `--no-index` answers for
  // paths that do not exist, so no temporary file has to be written.
  const cases = [
    // What a run must never commit.
    ['DerivedData/Build/Products/x.app', true],
    ['screenshots/2026-10-22-target.png', true],
    ['capture.png', true],
    ['.tmp-smoke/out.png', true],
    ['.dsh-scratch/settings.json', true],
    ['build/app.tgz', true],
    ['run.log', true],
    ['coverage/lcov.info', true],
    ['docs/verification/2026-10-22-release-verification-findings.md', true],
    // What must stay addable: the curated marketplace frames, the plugin icon
    // and any future image outside the directories a run writes to.
    ['assets/2026-10-22-target.png', false],
    ['ios-simulator.png', false],
    ['lib/figures/diagram.png', false],
    ['README.md', false],
  ]
  for (const [file, ignored] of cases) {
    const result = spawnSync('git', ['check-ignore', '-q', '--no-index', '--', file], { cwd: ROOT })
    assert.equal(result.error, undefined, 'git must be available: the ignore rules are checked through it')
    assert.notEqual(result.status, 128, `git check-ignore failed: ${String(result.stderr)}`)
    assert.equal(
      result.status === 0,
      ignored,
      `${file} must ${ignored ? '' : 'not '}be ignored by .gitignore`,
    )
  }
})
