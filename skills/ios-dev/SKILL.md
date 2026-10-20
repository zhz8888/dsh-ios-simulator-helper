---
name: ios-dev
description: Build, run, inspect, and lightly automate iOS Simulator apps with the ios_* tools.
whenToUse: Use when the user wants to create, modify, build, run, debug, screenshot, or inspect an iOS app in Apple's macOS Simulator, or to manage iOS simulators from DSH.
---

# iOS Dev

Use this skill when the user wants you to create, modify, build, run, debug, screenshot, or inspect an iOS app in the macOS iOS Simulator.

## Platform Requirement

This plugin works only on macOS with full Xcode installed. `xcrun simctl`, `xcodebuild` and the simulator window app (Simulator.app, or Device Hub on Xcode 26 and later) do not exist on any other host.

- If `ios_preflight` reports the `Host OS (macOS)` check as failing, stop immediately and tell the user the plugin only supports macOS. Do not attempt to work around it.
- Command Line Tools alone are not enough: `xcode-select -p` must point at an Xcode.app developer directory.
- The same verdict is shown on this plugin's page in the DSH **Plugins** panel (Plugins → Installed plugins → iOS Simulator Helper), which also edits its parameters.

## Tool Names

The tools are registered directly on the agent, without an MCP server prefix, so the model sees `ios_preflight`, `ios_build_and_run`, and so on. If this plugin is installed, those names are in the tool list; there is no `mcp__` alias to look for.

## Default Workflow

1. Call `ios_preflight` first.
   - If the host is not macOS, or full Xcode or `simctl` is missing, stop the simulator workflow and explain the exact failing check.
2. Discover the project with `ios_discover_project`.
   - If no Xcode project exists and the user wants a new app, call `ios_create_app`.
   - Prefer editing the generated SwiftUI files directly after project creation.
   - `ios_create_app` refuses to overwrite generated files by default; only pass `overwrite: true` after explicit user confirmation.
3. Build and launch with `ios_build_and_run`.
   - Pass `scheme` when multiple schemes exist.
   - Use `openSimulator: true` when the user expects to see the macOS Simulator window (the plugin setting `autoOpenSimulator` covers the default).
   - Read the returned `output` first for compile errors; use the returned `logPath` only when more detail is needed.
4. Verify the app visually with `ios_screenshot`.
5. For simple runtime checks, use `ios_open_url`, `ios_launch_app`, `ios_terminate_app`, and `ios_logs`.
6. For UI automation, call `ios_ui_status` first.
   - `ios_ui_tap`, `ios_ui_swipe`, `ios_ui_type_text`, `ios_ui_button`, and `ios_ui_describe` require the optional `idb` backend.
   - If `idb` is unavailable, continue with build/run/screenshot checks and say UI automation is unavailable.
7. When finished with a simulator the session booted, stop it with `ios_shutdown_simulator` rather than leaving it running.

## Tool Notes

- This plugin intentionally uses Apple's own simulator window app for rendering — Simulator.app on Xcode 25 and earlier, Device Hub on Xcode 26 and later. Do not create or expect a custom simulator window, and do not treat a window that failed to open as a failed run: every `simctl` step still ran.
- The tools accept `udid`, `device`, and `runtime` when a specific simulator is needed. Otherwise they choose the booted simulator, then the configured default device (`defaultDevice`, `iPhone 16` out of the box).
- `ios_list_simulators` returns both devices and installed runtimes; use it before asking the user which device to target.
- `ios_build_app` only builds. `ios_build_and_run` builds, installs, launches, and shows the simulator window.
- `ios_logs` reads `log show` output for the recent window (120 seconds by default); narrow it with `bundleId`, `seconds`, and `limit` instead of dumping everything.
- Screenshots land under the plugin data directory (`$DSH_HOME/ios-simulator-helper/screenshots` by default) unless `path` is passed; the returned `path` is relative to the session workspace.

## Configuration

Everything configurable lives on this plugin's page in the **Plugins** panel (Plugins → Installed plugins → iOS Simulator Helper; profile-scoped, applied on the next tool call):

- **Simulator and device** — default device and runtime fragments, whether a simulator is booted automatically, whether the simulator window app opens automatically, boot timeout.
- **UI automation** — `uiBackend` (`auto` / `idb` / `xcodebuildmcp` / `none`), the `idb` executable, per-command timeout.
- **Build and DerivedData** — default configuration, build timeout, extra `xcodebuild` arguments, DerivedData directory, whether code signing is disabled.
- **Logs** — default log window and character limit.
- **Output directories** — data directory and screenshot directory.

The original plugin's `default_device` / `ui_backend` user config and its `IOS_SIM_*` environment variables still work as fallbacks when the corresponding field is empty, so existing setups need no change.

## Extension Point

The UI backend is deliberately isolated. `auto` probes for `idb`; `xcodebuildmcp` stays a reserved value so a future backend can map the same public operations to XcodeBuildMCP or a native Accessibility bridge without changing the tool names or the skill workflow.
