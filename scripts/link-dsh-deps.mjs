#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Bridge the DSH runtime packages into this package for offline development.
 *
 * `pnpm install` is the normal path and installs everything from the registry.
 * This script is for an offline machine that already has DSH: it symlinks each
 * runtime package from where DSH keeps it, so `pnpm test`, `pnpm run check` and
 * the smoke scripts work without a network round trip.
 *
 * `@deepseek-ai/schemastery` and `@deepseek-ai/cordis` normally come from the
 * profile's own `node_modules`; the rest ship inside the DSH application
 * bundle. Pass `--app <dir>` / `--profile <dir>` to point at other locations.
 *
 *   node scripts/link-dsh-deps.mjs
 *   node scripts/link-dsh-deps.mjs --clean
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = path.join(ROOT, 'node_modules')

/** Packages needed to run the suite against a local DSH installation. */
const PACKAGES = [
  { name: '@deepseek-ai/schemastery', scope: 'scoped' },
  { name: '@deepseek-ai/cordis', scope: 'scoped' },
  { name: '@deepseek-ai/dsh-tools', scope: 'scoped' },
  { name: 'react', scope: 'plain' },
  { name: 'react-dom', scope: 'plain' },
]

/** Read `--flag value` from argv. */
function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const appDir = arg('app', process.env.DSH_DESKTOP_APP ?? '/Applications/DSH Desktop.app/Contents/Resources/app')
const profileDir = arg('profile', path.join(process.env.HOME ?? '', '.dsh', 'profiles', 'desktop'))
const extraDirs = [arg('plugins', path.join(process.env.HOME ?? '', 'Work'))]

if (process.argv.includes('--clean')) {
  for (const item of PACKAGES) {
    rmSync(path.join(TARGET, ...item.name.split('/')), { recursive: true, force: true })
    console.log(`removed node_modules/${item.name}`)
  }
  process.exit(0)
}

mkdirSync(path.join(TARGET, '@deepseek-ai'), { recursive: true })

let linked = 0
for (const item of PACKAGES) {
  const candidates = [
    path.join(appDir, 'node_modules', item.name),
    path.join(profileDir, 'node_modules', item.name),
    // A sibling DSH plugin checkout that already ran `pnpm install` also has a
    // complete tree; useful on a machine that only has the app bundle.
    ...extraDirs.map((dir) => path.join(dir, 'dsh-android-emulator-helper', 'node_modules', item.name)),
  ]
  const source = candidates.find((candidate) => existsSync(candidate))
  if (source === undefined) {
    console.warn(`skip ${item.name}: not found in\n  ${candidates.join('\n  ')}`)
    continue
  }
  const link = path.join(TARGET, ...item.name.split('/'))
  rmSync(link, { recursive: true, force: true })
  mkdirSync(path.dirname(link), { recursive: true })
  symlinkSync(source, link, 'dir')
  console.log(`linked ${item.name} -> ${source}`)
  linked += 1
}

console.log(
  `\n${linked}/${PACKAGES.length} runtime packages linked. Run \`node --test test/*.test.js\` next, or use \`pnpm install\` instead.`,
)
