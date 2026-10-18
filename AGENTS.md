# AGENTS.md

Working notes for coding agents in this repository. Everything below is specific to this project: the command that gates a change, the invariants that break loudly or silently, and the conventions the existing history follows.

## What this is

`@zhz8888/dsh-ios-simulator-helper` — a DeepSeek Harness (DSH) native port of the official ZCode `ios-simulator@0.1.0` plugin, published on npm and listed for the DSH plugin market.

| Piece | Detail |
|---|---|
| Tools | 21 native `ios_*` tools: project discovery/scaffolding, simulator boot/install/launch/terminate, screenshots, logs, optional `idb` UI automation. 20 keep the original names and arguments; `ios_shutdown_simulator` is added. |
| Settings page | Settings → iOS Simulator: 17 fields in 5 groups, editable live through `ctx.configForms`. |
| Skill / command | Bundled `ios-dev` skill (`skills/ios-dev/SKILL.md`) and a `/ios-dev [goal]` command that runs the environment diagnostic. |
| Host | macOS only, with full Xcode. Every Apple-tooling call refuses elsewhere; `ios_preflight` reports the failed host check instead, and the pure-filesystem tools (`ios_discover_project`, `ios_create_app`) plus `ios_ui_status` still answer. |
| Package | Two halves: `lib/index.js` (host, Cordis) and `lib/client.js` (browser bundle for the settings page). |

The plugin page shows **iOS Simulator Helper** / **iOS 模拟器助手** from `locale/`, not the package name — the title names this plugin, not the Apple product it drives, and the descriptions carry the non-affiliation line. The settings namespace, the `cordis.patch.yml` row id and the route prefix are all `ios-simulator-helper`.

## Commands

```bash
pnpm install                 # test dependencies only (react, react-dom)
pnpm test                    # 102 tests, no Xcode and no simulator needed
node --test test/host.test.js  # one suite while iterating
pnpm run check               # THE GATE: tests + bundle consistency + real-host mount
pnpm run verify:mount        # real Cordis Context + real ToolRuntime registry only
pnpm run smoke               # read-only probes against the real machine
pnpm run smoke:simulator     # create → build → install → launch → screenshot → logs → shutdown
pnpm run link:dsh-deps       # offline dev: symlink this machine's @deepseek-ai packages
npm pack --dry-run --cache /tmp/npm-cache --registry https://registry.npmjs.org   # what a publish would ship
```

`package.json` pins the toolchain — `engines.node` is `>=22`, `packageManager` is `pnpm@11.8.0` — and `pnpm-lock.yaml` is committed. `npm` is the publisher only: installing with it would add a `package-lock.json` this repo does not track.

`pnpm run check` is the definition of done. It runs the unit suites, `scripts/check-bundle.mjs` (cross-half consistency) and `scripts/verify-mount.mjs` (mounting on a real Cordis `Context` and the real `ToolRuntime`). Do not report work as finished on `pnpm test` alone.

`smoke:simulator` accepts `--device <fragment>`, `--data-dir <path>`, `--keep` and `--no-macros`. Swift macro expansion needs `swift-plugin-server`, which cannot start its nested `sandbox-exec` when the caller is itself sandboxed; `ios_build_app` now repairs that by itself — it retries once with `OTHER_SWIFT_FLAGS=-disable-sandbox` and reports `macroSandboxRetry` — so `--no-macros` is only a way to isolate macro expansion from this plugin's own orchestration. It rewrites the generated `ContentView.swift` into a macro-free variant. The run needs no `--data-dir`: with none and no `IOS_SIM_PLUGIN_DATA` it writes under the generated project, which is what lets it finish from a sandboxed shell. Cleanup shuts down **only a simulator this run booted** — a target that was already running is left running.

## Repository map

```
package.json          version, the dsh manifest (bundle patch + client + compatibility), peer ranges, files whitelist
cordis.patch.yml      the one `insert` row that mounts the host half
ios-simulator.png     plugin icon: the ZCode plugin's artwork at 192 px, its grey backdrop keyed out (test decodes it)
locale/en.json        plugin-page title/description; its presence is what enables the other languages
locale/zh.json        the Simplified Chinese pair
README.md             the user document (English, primary): install, settings, tools, limitations
README.zh-CN.md       its structural Simplified Chinese mirror
lib/index.js          host half: tools, skill, command, the three Fetch routes, settings policy
lib/client.js         browser half: a hand-written __ModuleLoader__ bundle — there is no build step
lib/settings.js       field declarations and the schemastery Config (every field .volatile())
lib/runtime.js        per-call runtime: session cwd + live settings + platform → data directories
lib/tools/index.js    the 21 defineTool definitions, argument/result schemas, image admission
lib/providers/        ported providers: build, sim, project, logs, screenshot, ui, preflight, host
lib/util/             process execution, path handling, content blocks
skills/ios-dev/       the bundled skill
scripts/              check-bundle.mjs, verify-mount.mjs, smoke.mjs, link-dsh-deps.mjs
test/                 node:test suites plus render/bundle helpers
assets/               the four curated marketplace screenshots
screenshots.json      the market-facing list of those four images (relative paths, validated by test/)
```

## Invariants

These are load-bearing. Some fail at the loader, some fail silently in a UI.

1. **The package name is the client module id.** `package.json` `name` = `id:` in `lib/client.js` = the `name:` of the row in `cordis.patch.yml`. `scripts/check-bundle.mjs` compares the first two.
2. **One settings namespace.** The patch row id = `SETTINGS_NAMESPACE` in `lib/settings.js` = the literal in `lib/client.js` = the `/api/ios-simulator-helper` route prefix. Changing it means changing all four, and existing profiles keep their saved values keyed by the old id.
3. **The browser half is a classic script, not a module.** It may only `require` the shell's nine static modules — `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit` (the table in `test/helpers/load-bundle.mjs`) — and must never import a host module. Editing `lib/client.js` edits what ships — nothing compiles it.
4. **Two field tables must agree.** `lib/settings.js` (host) and the mirrored metadata in `lib/client.js` are compared key by key and option by option by the consistency gate. Change one, change both.
5. **Platform logic lives in one place**: `lib/providers/host.js`. The platform is an injectable parameter so the non-macOS branch is testable on a Mac.
6. **The plugin-page name is a package resource.** DSH resolves `<package>/locale/en.json` through `exports`, so `./locale/*.json` must stay exported and `locale` must stay in `files`; drop either and the page silently shows the raw package name. `en.json` also gates every other language file.
7. **No runtime dependencies, and every `@deepseek-ai/*` peer states a lower bound only.** `>=0.2.0-rc.2`, never `^`/`~`/`<`: a hard upper bound means re-releasing this plugin every time the harness or a peer bumps a major, which is the trade the radeon-cloud-patcher plugin makes and this repository follows. `engines.dsh` and `dsh.compatibility.dsh` restate the `@deepseek-ai/dsh-tools` range verbatim, and `dsh.compatibility.dshReleases` names the release actually exercised (`0.2.0-rc.2`; `test/manifest.test.js` pins it). The DSH install gate reads only the `@deepseek-ai/dsh*` peers, but pnpm still resolves every peer — `cordis` and `schemastery` are widened for the same reason, since a hard upper bound on either blocks the install just the same. The harness reads neither `engines.dsh` nor `dsh.manifestVersion`. The cost is that node-semver does not admit a *new* tuple's prerelease (`0.2.1-alpha.1`) by default, and pnpm's peer resolution is the step that then fails; README → Install → Version gate tells users the two workarounds (a range branch for that tuple, or `--config.strict-peer-dependencies=false`).
8. **Mount the package exactly once**, through `dsh.profile.bundles` or a profile patch row. Two mounts register every tool name twice and fail at the loader.
9. **External commands are spawned directly**, through `node:child_process` in `lib/util/`, deliberately: `xcodebuild`, `simctl` and `idb` then behave byte-for-byte as they did in the original. That bypasses DSH's subprocess seam — no unified process management, environment scrubbing or shutdown-time termination — so every external call keeps an explicit timeout and a `SIGTERM`, and no credential environment variable is ever read or forwarded. Do not "fix" this into the harness seam without re-verifying the ported behaviour.

## Changing things safely

- **A tool** — add it in `lib/tools/index.js` with an argument and result schema. The count is pinned in five places, so the gate fails until all agree: `test/host.test.js` and `scripts/verify-mount.mjs` (both `21`), the `description` of `locale/en.json` and `locale/zh.json`, and the README's tool list. `verify-mount.mjs` also dispatches the read-only tools through the real registry and validates their JSON.
- **A settings field** — both field tables, then every place the count is pinned: `test/settings.test.js` ("17 fields in 5 groups"), `test/client-render.test.js` (field count and registration order), `scripts/verify-mount.mjs` (volatile count), and the README settings table. The gate fails on drift.
- **A provider** — keep the ported behaviour; the parsers are covered by `test/providers.test.js`. Anything that needs a Mac belongs in `scripts/smoke.mjs`, not in `test/`.
- **The window app** — Xcode 26 replaced `Simulator.app` with Device Hub (`com.apple.dt.Devices`, under `Contents/Applications`), so `open -a Simulator` alone is dead on a current Xcode. `lib/providers/sim.js` is the only place that resolves it, opening the window is best-effort there (its failure is returned as `openWarning`, never thrown out of `boot`), and `ios_show_simulator` is the only tool for which opening the window *is* the operation.
- **The settings page** — `test/client-render.test.js` renders it with real React and `react-dom/server` in four host scenarios (macOS, Linux, Windows, undetectable), drives the real form model into the dirty and invalid states the action bar reacts to, and asserts every dictionary key resolves.
- **Testing the plugin by hand** — install this directory into a scratch profile (`dsh plugin --profile <scratch> add /absolute/path/to/dsh-ios-simulator-helper`), or through the DSH Desktop plugin manager. Never leave a scratch profile in the repository.

## Code style

- English everywhere: code, comments, JSDoc, commit messages, `README.md`, and this file. Two translations are deliberate: the settings page's UI strings (`en`/`zh` dictionaries inside the client half) and `README.zh-CN.md`.
- `README.md` and `README.zh-CN.md` are structural mirrors — same headings in the same order, same tables, same counts. A change to one is a change to the other.
- The READMEs are the **user document**: what the plugin is, how to install and configure it, what it does, what it does not. Development, verification, release and repository-shape conventions belong in this file instead, so keep them out of the READMEs — and do not restate here what a reader can work out unaided (how to clone and install from source, what an obviously named file contains).
- ESM only, no transpiler, no bundler, no linter, no formatter. Keep to the style of the file you are editing.
- 2-space indentation in every hand-written module. `lib/client.js` is the exception: its body sits one level inside the module-loader factory and is indented with tabs.
- Every `lib/` module carries a JSDoc header naming it (`@module @zhz8888/dsh-ios-simulator-helper/<name>`); imports may precede the header. It explains why the module exists, not what each line does.
- Comment the decisions that are not obvious from the code — why a fallback order is what it is, why a limit exists, what a silent failure would look like. Do not narrate straightforward code.

## The icon is the upstream artwork with its backdrop keyed out

`ios-simulator.png` is the artwork ZCode's own marketplace serves for the
`ios-simulator` plugin it ships, cropped to its content and kept at 192 × 192.
The artwork sits on a flat `#F5F5F7` tile, and that tile is keyed out here: a
light grey square reads as a washed-out box in a dark list, while the blue
rounded square carries its own contrast on either theme. Replacing this with a
hand-drawn mark is a regression, not a restyle.

The key works by flooding the flat tile inwards from the border, keeping a core
at least six pixels inside the silhouette as the colour sources, filling every
pixel with the nearest core colour, and taking alpha from unmixing the observed
pixel against that colour and `#F5F5F7`. Both shortcuts fail visibly: a plain
`-fuzz N% -transparent` leaves a rim of half-blended tile pixels, because the
antialiased edge is neither tile nor artwork, and a coarse colour threshold cuts
through the artwork's own shading and leaves flat patches. The soft drop shadow
under the rounded square comes through the same unmixing as a low-alpha edge,
which is what keeps it from surviving as a grey ring.

`dsh-app-boot` resolves `package.json.icon` to a regular file inside the package
directory, admits SVG, PNG, JPEG and WebP only, caps it at 256 KiB, and inlines
the bytes as a base64 data URL — so the icon ships in the tarball. It has no
opacity requirement; the artwork's own contrast is what makes transparency safe
here, and the superseded opaque tile was the version that needed a background.
`test/manifest.test.js` pins the PNG signature, the square frame, the 128 px
floor and that cap, then decodes the sprite (`test/helpers/decode-png.mjs`, built
on `node:zlib`) to confirm the four corner blocks are fully transparent, that no
partially transparent pixel still carries the tile colour or is as pale as it,
and that the artwork itself stays opaque. A re-exported opaque icon, a naively
fuzzed one, or one hollowed out by an over-aggressive key fails the suite instead
of shipping.

## Testing

- `node:test` via `pnpm test`; no test framework, no mocking library.
- The tests are a contract, not a smoke screen: they pin the manifest and patch shape, the two field tables, the settings projection, the ported parsers, and the rendered page.
- Render tests use real React and `react-dom/server`; only `@deepseek-ai/dsh-client-ui-primitives` is doubled, because it is a browser bundler input (CSS modules, `simple-icons`, `zustand/vanilla`) that plain Node cannot import.
- Anything requiring Xcode, `simctl` or `idb` is a `scripts/smoke.mjs` concern and must never become a `pnpm test` requirement.

Four layers, and what each one actually proves:

| Layer | Command | Proves |
|---|---|---|
| Unit / parsers | `pnpm test` | bundle loading contract and static-module limits, manifest and patch contract, settings projection (volatile reads, env fallbacks, out-of-range fallbacks, boolean spellings), and the ported parsers |
| Settings-page render | `pnpm test` (`client-render.test.js`) | the whole page rendered with real React in four host scenarios (macOS, Linux, Windows, undetectable), every dictionary key resolving, and the "only supports macOS" notice shown exactly on non-macOS |
| Consistency gate | `scripts/check-bundle.mjs` | bundle id = package name, namespace = patch row id, the two field tables agreeing key by key, the three routes on both sides, the macOS verdict and notice keys still in place, and the bundle still a classic script |
| Real host mount | `scripts/verify-mount.mjs` | real Cordis `Context` + real `ToolRuntime`: 21 tools registered, the read-only ones dispatched through the registry and schema-validated, malformed arguments and unknown tool names refused, 17 fields volatile, everything unregistered after dispose |

`pnpm run smoke` covers what only a real machine can prove: Xcode discovery, actual `simctl` calls, whether the generated project compiles, product discovery and bundle-id resolution, and install / launch / screenshot / logs / terminate / shutdown.

## Commit conventions

Conventional Commits, English, imperative subject, no trailing period, subject under ~72 characters. Types: `feat`, `fix`, `docs`, `chore`, `build`, `test`.

```
feat: preserve the original tool and argument names
fix: resolve the bundle id the way simctl installs it
docs: rewrite the READMEs around the published package
build: bump the version to 1.0.0
```

- The body explains **why**, not what: the failure that motivated the change, the trade-off taken, what was verified. Wrap at ~72 columns and use bullets when a commit carries several points.
- One logical change per commit. This project squashes and amends rather than stacking "fix the previous commit" entries, including on pushed history.
- `build: bump the version to x.y.z` is the release commit; the tag points at it.
- Never commit run artifacts — screenshots, logs, DerivedData, coverage, `.tmp-*`/`.dsh-*` scratch profiles, `*.tgz` (see `.gitignore`). `assets/` is the single curated exception: the four screenshots `screenshots.json` declares to the plugin market, and `test/manifest.test.js` validates their count, paths and existence.
- A published tag is immutable. `v1.0.0` must keep pointing at the commit npm recorded as its `gitHead`; rewrite history only ahead of a release that has already been announced.
- `main` is the only long-lived branch and is pushed directly. Two remotes exist: `origin` is GitHub (canonical), a secondary remote mirrors from a self-hosted Gitea. After rewriting history, push both — the mirror can otherwise push the old tip back.

## Release and publishing conventions

1. Bump `version` in `package.json`, commit it as `build: bump the version to x.y.z`.
2. Tag `vX.Y.Z` (lightweight, like the existing tags) and push `main` **and** the tag.
3. Publish from the tagged commit. Both flags are required: the local `.npmrc` points `registry` at a read-only mirror, and a scoped package stays private without public access.

   ```bash
   npm publish --registry https://registry.npmjs.org --access public
   ```

   On a 2FA account npm adds a browser approval step and stages a temporary `0.0.0-stage` version before the real one — that placeholder is expected, not a mistake.
4. Verify the release rather than assuming it: `gitHead` must equal the tag commit, and the published tarball's shasum must equal the one `npm pack --dry-run` printed locally.

   ```bash
   npm view @zhz8888/dsh-ios-simulator-helper@X.Y.Z gitHead --registry https://registry.npmjs.org
   git rev-parse vX.Y.Z^{commit}
   ```
5. Write the GitHub Release for the tag. **English and Chinese, in that order, with the same sections in both halves**, following the previous release:

   - a one-line summary headline, then a short paragraph on what the version is,
   - what the version contains,
   - differences or changes since the previous version,
   - install (`dsh plugin --profile <profile> add @zhz8888/dsh-ios-simulator-helper`),
   - verification — the checks that were actually run, with their results,
   - release artifact — npm version, tarball file count and size, sha256, and the `gitHead` ↔ tag match.

   The body is a Chinese half and an English half separated by `---`; each half opens with its own `##` headline, exactly as `v1.0.0` is written.

6. The README rendered on the npm page is the copy **inside the published tarball**. README edits reach npm only with the next publish, so land documentation before cutting the version that should carry it.

## Marketplace requirements

The repository is shaped for the [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) list, and `test/manifest.test.js` pins the parts that list checks:

- `dsh.bundle.patch` → `./cordis.patch.yml`, with `cordis.patch.yml` next to `package.json` and exactly one `insert` row whose id is the settings namespace.
- Official `@deepseek-ai/*` packages declared as `peerDependencies`, never `dependencies`.
- `screenshots.json` declaring 1–8 screenshots by relative, `..`-free image paths that all exist (the four live in `assets/`, which is a convention rather than an assertion).
- `repository`, `homepage` and `bugs` pointing at the listed repository.

The submission is a single YAML file in that repository (`data/plugins/zhz8888__dsh-ios-simulator-helper.yml`, with `url`/`name` pointing here, a `description.en` that states only what the code does, and category `dev`); nothing here ships it, and the list's CI rejects repositories younger than 24 hours.

## Do not

- Bump the version without tagging, or move a tag that has been published.
- Add a runtime dependency: the harness provides the peers, and a second copy of a `@deepseek-ai/*` package is a bug.
- Let a settings field exist on one side of the plugin only, or change the namespace without changing all four places.
- Commit screenshots, logs, build output or scratch profiles.
- Describe behaviour the code does not have. The plugin market reads the README and the plugin metadata as claims and checks them against the source, so keep both accurate — the README's "21 tools" and "17 fields" are claims of that kind, and the test count in Commands has to match what `pnpm test` prints.
