import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The consistency gate, run as part of `pnpm test`.
 *
 * `scripts/check-bundle.mjs` cross-checks the two halves of this plugin — the
 * browser bundle's identity, namespace and plugin surface, the two field tables
 * key by key with their labels, hints and placeholders in both languages, the
 * three routes and the classic-script rules — and none of that is reachable
 * from the host-side suites, because the client bundle is a text file the shell
 * evaluates.
 *
 * It used to run only from `pnpm run check`, which is the release gate and not
 * what a change normally runs, so a release validated by `pnpm test` alone had
 * none of those guarantees. Running it here closes that gap: `pnpm test` now
 * fails on a field table drift the moment it happens, and `pnpm run check`
 * keeps running it again as the last step of the release gate.
 *
 * The script is executed rather than imported: it is a program with its own
 * exit code, and importing it would evaluate the browser bundle in this
 * process, which is exactly what its own loader is for.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/test/gate
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the bundle consistency gate passes as part of the unit suite', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-bundle.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  })
  assert.equal(result.error, undefined, 'the gate script must be runnable')
  assert.equal(result.status, 0, `${String(result.stdout)}${String(result.stderr)}`)
  assert.match(String(result.stdout), /check-bundle: OK/)
})
