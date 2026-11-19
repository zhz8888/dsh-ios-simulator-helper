window.__ModuleLoader__.load({
	id: "@zhz8888/dsh-ios-simulator-helper",
	factory: (require) => {
		/** @type {{exports: Record<string, unknown>}} */
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const P = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = React.createElement;

		/**
		 * Browser half of @zhz8888/dsh-ios-simulator-helper: the simulator
		 * parameters, rendered on the Plugins page.
		 *
		 * The form belongs to the plugin, so it lives on the plugin's own page:
		 * the Plugins page renders it inside the plugin detail, between the
		 * package description and the component rows, through its
		 * `plugins.bundle.config` keyed slot. The key is the BUNDLE's package
		 * name — the value the plugin manager's inventory compares against — not
		 * the settings namespace: the namespace is the patch row id this plugin
		 * mounts, and a deployment may mount the same code under another row.
		 *
		 * It registers only while the Host actually serves this plugin's settings
		 * namespace, so a deployment without the host half shows no trace of the
		 * form, and it is disposed again when the namespace stops being served.
		 *
		 * Everything the user edits goes through the shared config form
		 * (`ctx.configForms.get`): staged edits, invalid-draft detection,
		 * optimistic-concurrency revisions and the write itself are the
		 * harness' behaviour, not reimplemented here. The two buttons in the
		 * diagnostics card call the host half's exact Fetch routes.
		 *
		 * The form answers one question before anything else: is this host
		 * macOS? Apple's simulator only exists there, so the answer is read
		 * twice — synchronously from the browser's own platform string, and
		 * authoritatively from the host half's `/host` route — and a non-macOS
		 * host gets a standing notice that this plugin only supports macOS.
		 *
		 * @module @zhz8888/dsh-ios-simulator-helper/client
		 */


		/**
		 * One field of the configuration form, as this half sees it.
		 *
		 * The copy is not here: it lives in the locale files and is looked up by
		 * key. What is here is the shape - which control to draw, what to offer
		 * it, and which bounds the host enforces.
		 *
		 * @typedef {object} FieldDescriptor
		 * @property {string} key - the settings key; also the schema key.
		 * @property {string} kind - the control to render.
		 * @property {string} [suggest] - the discovery list a `discovery` field's options come from.
		 * @property {boolean} [placeholder] - whether the control shows a placeholder.
		 * @property {string[]} [options] - the fixed options of a select.
		 * @property {string[]} [optionLabel] - the options that carry a translated label.
		 * @property {number} [min] - the smallest value the host accepts.
		 * @property {number} [max] - the largest value the host accepts.
		 */

		/**
		 * One option a discovery dropdown offers.
		 *
		 * The value and the label are separate because the two do not always
		 * match. A device is stored under its own name, which is also what it
		 * shows, but a runtime is shown as `iOS 27.1` and stored as the
		 * fragment `iOS-27-1`: the fragment is the part of the runtime
		 * identifier the simulator picker matches a device on, and the display
		 * name is not a substring of it.
		 *
		 * `found` says whether the host still has this value. A value the
		 * inventory did not return is kept in the list - a profile written by
		 * hand, or one that names a device that has since been deleted, must
		 * stay visible so the user can see and fix it - and it is marked as one.
		 *
		 * @typedef {object} DiscoveryOption
		 * @property {string} value - the value the control stores.
		 * @property {string} label - the text the control shows.
		 * @property {boolean} found - whether the host still resolves this value.
		 *   `false` marks a value nothing on this machine answers to; a host
		 *   that has not answered yet marks nothing, because nothing is known yet.
		 */

		/**
		 * One card of the configuration form.
		 *
		 * @typedef {object} GroupDescriptor
		 * @property {string} id - the group's id; also its dictionary namespace.
		 * @property {FieldDescriptor[]} fields - the fields it holds, in page order.
		 */

		/**
		 * The browser's own platform string.
		 *
		 * `navigator.userAgentData` is not in TypeScript's DOM library, so the
		 * narrow shape is declared here instead of using the DOM's `Navigator`.
		 * The DOM's own navigator is still assignable to it.
		 *
		 * @typedef {object} ClientNavigator
		 * @property {{platform?: string}} [userAgentData] - the client hints, when present.
		 * @property {string} [platform] - the platform string.
		 * @property {string} [userAgent] - the user agent string.
		 */

		/**
		 * The host half's `/host` payload.
		 *
		 * @typedef {object} HostPayload
		 * @property {boolean} [supported] - whether the host can run the tools.
		 * @property {string} [platform] - the host's platform.
		 * @property {string} [label] - the platform's display name.
		 * @property {string} [requiredPlatformLabel] - the required platform's display name.
		 * @property {string} [arch] - the host's architecture.
		 */

		/**
		 * The verdict the page renders.
		 *
		 * @typedef {object} Verdict
		 * @property {boolean|null} supported - whether the host can run the tools.
		 * @property {string} platform - the platform the host reports.
		 * @property {string} label - the platform's display name.
		 * @property {string} requiredLabel - the required platform's display name.
		 * @property {string} source - where the verdict came from.
		 */

		/**
		 * The state one control renders.
		 *
		 * @typedef {object} FieldState
		 * @property {string} text - the draft text.
		 * @property {boolean} overridden - whether a save would leave an override.
		 * @property {boolean} invalid - whether the draft is not a value the field accepts.
		 */

		/**
		 * One control's props.
		 *
		 * @typedef {object} FieldProps
		 * @property {FieldDescriptor} field - the field this control edits.
		 * @property {FieldState} state - the control's state.
		 * @property {boolean} disabled - whether the control is read-only.
		 * @property {(text: string) => void} onChange - stage a new draft.
		 * @property {() => void} onReset - stage a reset of the field.
		 * @property {(key: string) => string} t - the dictionary lookup.
		 * @property {DiscoveryOption[] | null | undefined} suggestions - the options the control offers; `null` while the host has not answered.
		 */

		/**
		 * What the action bar shows.
		 *
		 * @typedef {object} ActionBarView
		 * @property {string} tone - the state the bar reports.
		 * @property {string} message - the message the bar names.
		 * @property {boolean} canDiscard - whether the discard button is offered.
		 * @property {boolean} canSave - whether the save button is offered.
		 */

		/**
		 * The action bar's props.
		 *
		 * @typedef {object} ActionBarProps
		 * @property {ActionBarView|null} view - what to show, or nothing.
		 * @property {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormShell} shell - the form's state.
		 * @property {(key: string) => string} t - the dictionary lookup.
		 * @property {() => void} onDiscard - drop the staged edits.
		 * @property {() => void} onSave - write the staged edits.
		 */

		/**
		 * The saved-confirmation toast's props.
		 *
		 * @typedef {object} SavedToastProps
		 * @property {number} tick - the landed-write sequence; zero means none.
		 * @property {(key: string) => string} t - the dictionary lookup.
		 * @property {() => void} onDone - the acknowledgement the toast reports through.
		 */

		/**
		 * The form face the Plugins page injects into the entry.
		 *
		 * @typedef {object} FormFace
		 * @property {(selector: (snapshot: PageState) => PageState) => PageState} useIosSimulatorSettings - the form's snapshot selector.
		 * @property {(key: string, values?: Record<string, string>) => string} t - the dictionary lookup.
		 * @property {() => Promise<HostPayload>} loadHost - the host verdict request.
		 * @property {() => Promise<DiagnosticReport>} loadStatus - the diagnostic request.
		 * @property {() => Promise<InventoryPayload>} loadInventory - the discovery request.
		 * @property {(field: string, text: string) => void} edit - stage a new draft.
		 * @property {(field: string) => void} resetField - stage a reset of one field.
		 * @property {() => void} discard - drop the staged edits.
		 * @property {() => void} save - write the staged edits.
		 * @property {() => void} acknowledgeSaved - report that the toast is done.
		 * @property {() => (() => void)} pageMounted - a handle that fires when the page is left.
		 * @property {string} [view] - the view the page asks for: `page` for the form, `summary` for the one-line stand-in.
		 */
		/**
		 * The form's state, as the page reads it.
		 *
		 * @typedef {object} PageState
		 * @property {boolean} available - whether the namespace is served to this client.
		 * @property {boolean} writable - whether the document accepts writes.
		 * @property {boolean} dirty - whether edits are staged.
		 * @property {boolean} invalid - whether a staged draft is invalid.
		 * @property {boolean} saving - whether a write is crossing the wire.
		 * @property {boolean} failed - whether the last save did not land.
		 * @property {number} toastSeq - the landed-write sequence; 0 when there is none.
		 * @property {string} status - the namespace's status.
		 * @property {Record<string, FieldState>} fields - the per-field state.
		 */

		/**
		 * The state of one fetch-on-demand request.
		 *
		 * @template T
		 * @typedef {object} RemoteState
		 * @property {boolean} loading - whether a request is in flight.
		 * @property {T|undefined} data - the answer, once it landed.
		 * @property {string|undefined} error - the failure, once it happened.
		 */

		/**
		 * One simulator or runtime the discovery route lists.
		 *
		 * @typedef {object} NamedTarget
		 * @property {string} name - the device or runtime name.
		 * @property {string} state - the state it is in.
		 */

		/**
		 * One device the host found.
		 *
		 * @typedef {object} SimulatorTarget
		 * @property {string} name - the device name.
		 * @property {string} state - the state it is in.
		 * @property {boolean} [available] - whether the device can be used at all.
		 */

		/**
		 * One runtime the host found.
		 *
		 * @typedef {object} RuntimeTarget
		 * @property {string} name - the runtime's display name, e.g. `iOS 27.1`.
		 * @property {string} [identifier] - the runtime identifier the fragment is read from.
		 * @property {boolean} [available] - whether the runtime can be used.
		 */

		/**
		 * The discovery route's payload.
		 *
		 * @typedef {object} InventoryPayload
		 * @property {boolean} [supported] - whether this host can run the simulator stack at all.
		 * @property {string} [xcodePath] - the Xcode the host resolved.
		 * @property {string} [xcodeVersion] - that Xcode's version.
		 * @property {string} [macOSVersion] - the host's macOS version.
		 * @property {NamedTarget} [defaultTarget] - the simulator the tools use by default.
		 * @property {string} [defaultTargetError] - why there is no default target.
		 * @property {RuntimeTarget[]} [runtimes] - the installed runtimes.
		 * @property {SimulatorTarget[]} [simulators] - the available simulators.
		 */

		/**
		 * One diagnostic check.
		 *
		 * @typedef {object} DiagnosticCheck
		 * @property {string} name - the check's name.
		 * @property {boolean} ok - whether it passed.
		 * @property {string} detail - what it found.
		 * @property {string} [fix] - what to do about a failure.
		 */

		/**
		 * The diagnostic route's payload.
		 *
		 * @typedef {object} DiagnosticReport
		 * @property {boolean} ok - whether the environment is ready.
		 * @property {boolean} [supported] - whether the host can run the tools.
		 * @property {DiagnosticCheck[]} checks - the checks it ran.
		 */
		/**
		 * The scope's public reads of the form's own state.
		 *
		 * @typedef {object} FormReads
		 * @property {(field: string) => boolean} stored - whether the user layer carries a key.
		 * @property {(field: string) => unknown} sectionValue - the section's value for a key.
		 */
		/**
		 * The control element's props.
		 *
		 * @typedef {Omit<FieldProps, 'onReset'> & {id: string, suggestions: DiscoveryOption[] | null | undefined}} ControlInput
		 */
		/**
		 * The browser plugin context, as this half uses it.
		 *
		 * @typedef {object} ClientContext
		 * @property {(callback: () => unknown, label?: string) => unknown} effect - run an effect and get its disposer.
		 * @property {{get: (namespace: string) => unknown, whileServed: (namespaces: string[], callback: () => unknown) => unknown}} configForms - the shared configuration forms.
		 * @property {{register: (namespace: string, dictionaries: Record<string, Record<string, string>>) => unknown, bind: (namespace: string) => (key: string, values?: Record<string, string>) => string}} locale - the shell's locale service.
		 * @property {{inject: (slot: string, callback: () => unknown) => () => void, register: (entry: object, component: unknown) => unknown}} slots - the slot registry.
		 * @property {{warn?: (message: string) => void, info?: (message: string) => void, error?: (message: string) => void}} [logger] - the browser-side logger.
		 */		/** Settings namespace = the profile entry id, spelled literally. */
		const NS = "ios-simulator-helper";
		/**
		 * The package name the Plugins page keys a bundle's own configuration by.
		 *
		 * `plugins.bundle.config` is a keyed slot and the page renders it with
		 * `entryKey: pkg.name`, so this string must equal `package.json`'s name
		 * exactly; the settings namespace above is a different string and never
		 * a substitute. `scripts/check-bundle.mjs` compares the two.
		 */
		const PACKAGE_NAME = "@zhz8888/dsh-ios-simulator-helper";
		/** Dictionary namespace owned by this page. */
		const LOCALE_NS = "settings.iosSimulatorHelper";

		/**
		 * The page-initialization global the host half publishes the copy under.
		 *
		 * The host reads `locale/en.json` and `locale/zh.json` and pushes them
		 * onto the web server's `webserver/index-inject` table, which renders the
		 * row as a script in the document head ahead of this bundle. The bundle
		 * therefore reads the copy synchronously at module scope, and its first
		 * render is already in the right language.
		 */
		const LOCALE_GLOBAL = "__DSH_IOS_SIMULATOR_HELPER_LOCALE__";

		/**
		 * The Settings rail's icon, published as a package asset.
		 *
		 * A client bundle cannot read its own package, so the artwork is published
		 * through the package's `assets` export and fetched by the served path with
		 * the `plugins/` prefix - not a bare package path.
		 */
		const SIMULATOR_ICON_ASSET = `plugins/${PACKAGE_NAME}/assets/ios-simulator.svg`;
		const simulatorIconUrl =
			typeof require.asset === "function" ? require.asset(SIMULATOR_ICON_ASSET) : "";

		/**
		 * The slot and key this half registers into.
		 *
		 * The Plugins page keys a ROW's own configuration by the package name and
		 * the row id, so the key must be `<package name>#<namespace>`. The row's
		 * Configure control opens the page this entry renders on.
		 */
		const PLUGIN_SURFACE = Object.freeze({
			slot: "plugins.row.config",
			key: `${PACKAGE_NAME}#${NS}`,
		});

		/**
		 * The Settings dialog's section, and the icon it draws.
		 *
		 * A page one edits repeatedly belongs in the navigation rail rather than
		 * behind a detail view, so the same form also appears there - behind a
		 * `showInSettings` switch that ships off. The switch is a live setting,
		 * not a boot decision: the section and its icon are registered while the
		 * saved value is true and disposed when it goes false, so a profile that
		 * never touches the switch keeps exactly one configuration page.
		 */
		const SETTINGS_SURFACE = Object.freeze({
			section: "settings.section",
			icon: "settings.section.icon",
			id: NS,
			order: 100,
			field: "showInSettings",
		});
		/** Exact Fetch routes registered by the host half. */
		const HOST_ROUTE = "/api/ios-simulator-helper/host";
		const STATUS_ROUTE = "/api/ios-simulator-helper/status";
		const INVENTORY_ROUTE = "/api/ios-simulator-helper/inventory";

		/** The one platform this plugin works on. */
		const REQUIRED_PLATFORM = "darwin";
		const REQUIRED_PLATFORM_LABEL = "macOS";

		/** CSS ownership tag; the framework reclaims this on unload. */
		const CSS_TAG = "@zhz8888/dsh-ios-simulator-helper/PluginPage.module.css";

		const CSS = [
			// Page frame. The Plugins page draws the title, the icon, the crumb and
			// the package description itself, so this half contributes the form
			// only: one line saying when the edits take effect, then one card per
			// category — the card outline is what separates the categories, so no
			// rule is needed between them and each group reads as one block. The
			// metrics are read from the platform's own field kit —
			// `@deepseek-ai/dsh-client-ui-primitives/lib/settings-form/fields.module.css`
			// (MIT), which every built-in settings page uses — so the form sits
			// beside them: a 13/1.5 label, a 12px hint, a 34px control on a 0.5px
			// border-l4 edge. The composition above those pieces is this page's own.
			".ismh_page{flex-direction:column;display:flex;max-width:100%;color:var(--dsw-alias-label-primary)}",
			".ismh_intro{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}",
			".ismh_alert{margin-top:14px;border:.5px solid var(--dsw-alias-state-error-primary);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);flex-direction:column;gap:4px;padding:10px 14px;display:flex}",
			".ismh_alertTitle{margin:0;font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-state-error-primary)}",
			".ismh_alertBody{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0;font-size:12px;line-height:1.6}",
			".ismh_readOnly{margin:12px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}",
			".ismh_group{margin-top:16px;padding:12px 16px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);flex-direction:column;display:flex}",
			".ismh_groupHead{align-items:baseline;gap:8px;display:flex}",
			".ismh_groupTitle{margin:0;font-size:14px;font-weight:600;line-height:1.5}",
			".ismh_groupHint{color:var(--dsw-alias-label-tertiary);margin:2px 0;font-size:12px;line-height:1.6}",
			// One rhythm per card: 7px above and below every field (14px between
			// two of them), and nothing below the last one — the card's own 8px is
			// what separates it from the edge, so a card does not end in a pocket
			// of empty space when its last field is a hint rather than a control.
			".ismh_field{flex-direction:column;gap:6px;display:flex;padding:7px 0;min-width:0}",
			".ismh_group>.ismh_field:last-child{padding-bottom:0}",
			".ismh_head{align-items:center;gap:8px;display:flex;min-width:0}",
			".ismh_label{font-size:13px;font-weight:500;line-height:1.5}",
			".ismh_reset{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);text-decoration:underline;cursor:pointer;background:none;border:0;padding:0}",
			".ismh_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
			".ismh_reset:disabled{cursor:default;opacity:.5}",
			".ismh_control{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);outline:none;padding:0 12px;font-size:13px;line-height:1.5;width:100%}",
			".ismh_control:focus-visible{border-color:var(--dsw-alias-state-business-primary)}",
			".ismh_control[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}",
			".ismh_control:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
			".ismh_short{max-width:200px}",
			".ismh_area{height:auto;min-height:96px;padding:10px 12px;line-height:1.6;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}",
			".ismh_selectWrap{position:relative;display:block}",
			// One chevron for every control that offers a list: the fixed selects and
			// the discovery dropdowns. A stroked SVG path replaces the old CSS-border
			// triangle, whose 5px solid wedge read as a coarse arrow next to the
			// theme's 1px-line icons.
			".ismh_chevron{position:absolute;right:12px;top:50%;width:14px;height:14px;transform:translateY(-50%);fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}",
			".ismh_selectWrap:hover .ismh_chevron{stroke:var(--dsw-alias-label-secondary)}",
			".ismh_selectWrap:focus-within .ismh_chevron{stroke:var(--dsw-alias-state-business-primary)}",
			".ismh_selectWrap:has(:disabled) .ismh_chevron{opacity:.5}",
			".ismh_select{appearance:none;cursor:pointer;padding-right:28px}",
			".ismh_hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}",
			".ismh_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.6}",
			".ismh_toolRow{flex-wrap:wrap;align-items:center;gap:10px;display:flex;margin-top:10px}",
			".ismh_checks{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}",
			".ismh_check{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:flex-start;gap:10px;padding:8px 0;display:flex}",
			".ismh_check:last-child{border-bottom:0;padding-bottom:0}",
			".ismh_checkBody{flex-direction:column;gap:2px;min-width:0;flex:1;display:flex}",
			".ismh_checkName{font-size:13px;line-height:1.5}",
			".ismh_checkDetail{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;white-space:pre-wrap;margin:0;font-size:12px;line-height:1.6}",
			".ismh_checkFix{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));overflow-wrap:anywhere;margin:0;font-size:12px;line-height:1.6}",
			".ismh_verdict{align-items:center;gap:8px;font-size:13px;line-height:1.5;display:flex}",
			".ismh_note{color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:12px;line-height:1.6}",
			".ismh_group>.ismh_error{margin-top:8px}",
			".ismh_mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);overflow-wrap:anywhere}",
			// A small pill, not a full-width panel: it hugs its message and buttons and
			// centres itself in the page column with auto margins, so it reads as a
			// floating notice. It is still one in-flow child held at the bottom by
			// `position: sticky`, so it never covers a field and nothing has to
			// reserve room for it.
			".ismh_actions{position:sticky;bottom:16px;z-index:1;box-sizing:border-box;margin:20px auto 0;padding:6px 8px 6px 14px;width:max-content;max-width:min(560px,100%);border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft,0 4px 14px -6px rgba(0,0,0,.2));align-items:center;gap:8px;display:flex}",
			".ismh_actionsText{flex:0 1 auto;min-width:0;margin:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:1.5}",
			".ismh_actionsError .ismh_actionsText{color:var(--dsw-alias-state-error-primary)}",
		].join("");

		/**
		 * Field metadata, mirrored from `lib/settings.js`.
		 *
		 * The browser bundle cannot import a Host module (the client purity gate
		 * forbids cross-plugin value imports), so the descriptors are spelled
		 * here as well. `key`, `kind` and `options` must match the host schema:
		 * the host is what validates and persists, and the client only renders.
		 */
		/** @type {GroupDescriptor[]} */
		const GROUPS = [
			{
				id: "target",
				fields: [
					{
						key: "defaultDevice",
						kind: "discovery",
						suggest: "devices",
					},
					{
						key: "defaultRuntime",
						kind: "discovery",
						suggest: "runtimes",
					},
					{
						key: "autoBootSimulator",
						kind: "boolean",
					},
					{
						key: "autoOpenSimulator",
						kind: "boolean",
					},
					{
						key: "bootTimeoutSeconds",
						kind: "number",
					},
				],
			},
			{
				id: "ui",
				fields: [
					{
						key: "uiBackend",
						kind: "select",
						options: ["auto", "idb", "xcodebuildmcp", "none"],
						// Only the option text is translated; the stored value stays the
						// raw backend id, so switching the UI language never rewrites the
						// saved configuration.
						optionLabel: ["auto", "idb", "xcodebuildmcp", "none"],
					},
					{
						key: "idbBinary",
						kind: "text",
						placeholder: true,
					},
					{
						key: "uiTimeoutSeconds",
						kind: "number",
					},
				],
			},
			{
				id: "build",
				fields: [
					{
						key: "defaultConfiguration",
						kind: "select",
						options: ["Debug", "Release", "Profile"],
					},
					{
						key: "buildTimeoutSeconds",
						kind: "number",
					},
					{
						key: "extraBuildArgs",
						kind: "multiline",
						placeholder: true,
					},
					{
						key: "derivedDataDir",
						kind: "text",
						placeholder: true,
					},
					{
						key: "disableCodeSigning",
						kind: "boolean",
					},
				],
			},
			{
				id: "logs",
				fields: [
					{
						key: "logSeconds",
						kind: "number",
						max: 3600,
					},
					{
						key: "logLimit",
						kind: "number",
						min: 1000,
						max: 20000,
					},
				],
			},
			{
				id: "output",
				fields: [
					{
						key: "dataDir",
						kind: "text",
						placeholder: true,
					},
					{
						key: "screenshotDir",
						kind: "text",
						placeholder: true,
					},
				],
			},
			{
				id: "interface",
				fields: [
					{ key: "showInSettings", kind: "boolean" },
				],
			},		];

		/** Flat field list, in declaration order. */
		/** @type {FieldDescriptor[]} */
		const FIELDS = GROUPS.flatMap((group) => group.fields);

		/**
		 * Detect the host platform from the browser's own signals.
		 *
		 * This is the configuration page's *synchronous* answer to "is this macOS?",
		 * available before any request: the simulator workflow needs Apple's
		 * tooling, so a Windows or Linux browser must be told immediately rather
		 * than after a failed fetch. The host half's `/host` route then confirms
		 * or contradicts it, and that verdict wins.
		 *
		 * @param {ClientNavigator|undefined} nav - `navigator`, or undefined when absent.
		 * @returns {{platform: string, label: string, supported: boolean|null}} the verdict;
		 *   `null` means "could not tell", which must not raise a warning.
		 */
		function detectClientPlatform(nav) {
			const raw =
				nav === undefined || nav === null
					? ""
					: String(nav.userAgentData?.platform || nav.platform || nav.userAgent || "");
			if (raw === "") return { platform: "unknown", label: "unknown", supported: null };
			if (/mac/i.test(raw)) return { platform: "darwin", label: "macOS", supported: true };
			if (/iphone|ipad|ipod|ios/i.test(raw)) return { platform: "ios", label: "iOS", supported: false };
			if (/win/i.test(raw)) return { platform: "win32", label: "Windows", supported: false };
			if (/android/i.test(raw)) return { platform: "android", label: "Android", supported: false };
			if (/cros/i.test(raw)) return { platform: "chromeos", label: "ChromeOS", supported: false };
			if (/linux|x11|bsd|sunos/i.test(raw)) return { platform: "linux", label: "Linux", supported: false };
			return { platform: raw, label: raw, supported: null };
		}

		/**
		 * Combine the browser verdict with the host half's authoritative one.
		 *
		 * @param {{platform: string, label: string, supported: boolean|null}} client - the browser verdict.
		 * @param {HostPayload|undefined} host - the `/host` payload, when it arrived.
		 * @returns {Verdict} the verdict the page renders.
		 */
		function hostVerdict(client, host) {
			if (host !== undefined && host !== null && typeof host.supported === "boolean") {
				return {
					supported: host.supported,
					platform: host.platform ?? client.platform,
					label: host.label ?? host.platform ?? client.label,
					requiredLabel: host.requiredPlatformLabel ?? REQUIRED_PLATFORM_LABEL,
					source: "host",
				};
			}
			return {
				supported: client.supported,
				platform: client.platform,
				label: client.label,
				requiredLabel: REQUIRED_PLATFORM_LABEL,
				source: client.supported === null ? "unknown" : "browser",
			};
		}

		/**
		 * A whole-value field whose draft is the exact text the user typed.
		 *
		 * Used for selects: the control can only produce one of its options, so
		 * every non-empty draft is a valid value and an empty draft clears the
		 * override.
		 *
		 * @param {FieldDescriptor} field - the field the spec belongs to.
		 * @returns {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldSpec} the spec.
		 */
		function wholeValueField(field) {
			return {
				field: field.key,
				format: (value) =>
					typeof value === "string" ? value : value === undefined || value === null ? "" : String(value),
				parse: (text) => {
					const trimmed = text.trim();
					return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
				},
			};
		}

		/**
		 * A positive whole-number field.
		 *
		 * Stricter than `settingsNumberField`, which accepts any finite number:
		 * the host schema stores a natural number of at least one, so a
		 * negative, fractional or zero draft would be staged happily and then
		 * rejected by the write. Rejecting it here turns that into an inline
		 * message instead of a failed save.
		 *
		 * @param {FieldDescriptor} field - the field the spec belongs to.
		 * @returns {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldSpec} the spec.
		 */
		function naturalField(field) {
			const min = field.min ?? 1;
			const max = field.max;
			return {
				field: field.key,
				format: (value) => (typeof value === "number" ? String(value) : ""),
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					if (!/^\d+$/.test(trimmed)) return undefined;
					const value = Number(trimmed);
					if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) return undefined;
					return { kind: "set", value };
				},
			};
		}

		/**
		 * A boolean field, staged as the literal `true`/`false` the switch renders.
		 *
		 * @param {FieldDescriptor} field - the field the spec belongs to.
		 * @returns {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldSpec} the spec.
		 */
		function booleanField(field) {
			return {
				field: field.key,
				format: (value) => (value === true ? "true" : "false"),
				parse: (text) => {
					const trimmed = text.trim().toLowerCase();
					if (trimmed === "") return { kind: "clear" };
					if (trimmed === "true" || trimmed === "1") return { kind: "set", value: true };
					if (trimmed === "false" || trimmed === "0") return { kind: "set", value: false };
					return undefined;
				},
			};
		}

		/**
		 * The conversion spec for one field descriptor.
		 *
		 * @param {FieldDescriptor} field - the field the spec belongs to.
		 * @returns {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFieldSpec} the spec.
		 */
		function specFor(field) {
			switch (field.kind) {
				case "number":
					return naturalField(field);
				case "boolean":
					return booleanField(field);
				case "select":
					return wholeValueField(field);
				case "discovery":
					// A dropdown can only produce one of the values it offers, so
					// every non-empty draft is a valid value and an empty draft
					// clears the override.
					return wholeValueField(field);
				case "multiline":
					return P.settingsTextField(field.key);
				default:
					return P.settingsTextField(field.key);
			}
		}

		/**
		 * The page's copy, read from the global the host injects.
		 *
		 * Every user-visible string this page renders lives in the plugin's
		 * `locale/en.json` and `locale/zh.json`, and the host half publishes those
		 * two dictionaries as a page-initialization global before this bundle
		 * runs. The bundle therefore carries no copy of its own: the two
		 * languages cannot drift apart, and the first render is already in the
		 * right language instead of showing raw keys until a fetch lands.
		 *
		 * A deployment that renders no index through the harness' web server
		 * injects nothing; the page then renders its keys, which is visibly
		 * wrong rather than silently wrong, and the tools keep working.
		 *
		 * @returns {{zh: Record<string, string>, en: Record<string, string>}} the dictionaries.
		 */
		function readInjectedDictionaries() {
			/** @type {{en: Record<string, string>, zh: Record<string, string>}} */
			const dictionaries = { en: {}, zh: {} };
			/** @type {Record<string, unknown> | undefined} */
			let injected;
			try {
				// The global is optional and its shape is the host's business, so it is
				// read as unknown and checked below rather than declared here.
				const globals = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));
				injected = /** @type {Record<string, unknown> | undefined} */ (globals[LOCALE_GLOBAL]);
			} catch {
				return dictionaries;
			}
			if (typeof injected !== "object" || injected === null) return dictionaries;
			for (const language of /** @type {const} */ (["en", "zh"])) {
				const dictionary = injected[language];
				if (typeof dictionary !== "object" || dictionary === null) continue;
				for (const [key, value] of Object.entries(dictionary)) {
					if (typeof value === "string") dictionaries[language][key] = value;
				}
			}
			return dictionaries;
		}

		/** The dictionaries the host injected, read once at module scope. */
		const DICTIONARIES = readInjectedDictionaries();

		/**
		 * The dictionary keys the page's own chrome owns.
		 *
		 * The field and group keys are derived from the metadata above and the
		 * option keys from the option lists, so they are not listed here. This
		 * set is the chrome: the strings that are not attached to a field.
		 *
		 * @type {readonly string[]}
		 */
		const FIXED_KEYS = Object.freeze([
			"intro", "invalid", "overridden", "reset", "save", "saving", "discard",
			"pendingWrite", "writeBlocked", "writeFailed", "written", "readOnly",
			"unavailable", "loading", "hostChecking", "hostSupported",
			"hostUnsupportedTitle", "hostUnsupportedBody", "hostUnknown",
			"hostCheckFailed", "toolsTitle", "toolsHint", "runCheck", "checking",
			"refresh", "refreshing", "ready", "notReady", "unsupported",
			"statusFailed", "inventoryFailed", "xcode", "macOSVersion",
			"defaultTarget", "runtimes", "simulators", "none",
			// The marker for a value this machine no longer has, and the two
			// discovery dropdowns' own entry for an unset value. They are listed
			// here rather than derived from the field table because their values
			// are not a fixed option list: a discovery dropdown's options are
			// whatever this machine has.
			"notFound", "option.defaultDevice.any", "option.defaultRuntime.any",
			// The Settings rail's own label, and the row page's one-line stand-in.
			"sectionNav", "rowSummary",
		]);

		/**
		 * The option list a select renders.
		 *
		 * A value persisted by an older version, or typed into the profile patch
		 * by hand, is kept visible rather than silently rendering as an empty
		 * selection: the user must be able to see what is stored in order to fix
		 * it.
		 *
		 * @param {FieldDescriptor} field - the field the options belong to.
		 * @param {string|undefined} current - the value in effect.
		 * @returns {string[]} the options to render.
		 */
		function selectOptions(field, current) {
			const options = field.options ?? [];
			if (current === undefined || current === "" || options.includes(current)) return options;
			return [...options, current];
		}

		/**
		 * The display text of one select option.
		 *
		 * Only the label is translated, never the stored value, so a Chinese page
		 * still writes `auto` into the profile. A value kept visible from an older
		 * version has no label and is shown exactly as it is stored.
		 *
		 * @param {FieldDescriptor} field - the field the option belongs to.
		 * @param {string} value - the option's value.
		 * @param {(key: string) => string} t - the dictionary lookup.
		 * @returns {string} the text to show.
		 */
		function optionLabel(field, value, t) {
			// Only the values the descriptor lists carry a label; every other value
			// is shown exactly as it is stored.
			if (field.optionLabel === undefined || !field.optionLabel.includes(value)) return value;
			return t(`option.${field.key}.${value}`);
		}

		/**
		 * The placeholder one field's control shows, or nothing.
		 *
		 * The descriptor carries only a flag - whether this field has a placeholder
		 * - because the text itself lives in the locale files. A field without a
		 * placeholder must pass `undefined` rather than an empty string, because
		 * React renders `placeholder=""` as an attribute and the control would
		 * show an empty hint where there is none.
		 *
		 * @param {FieldDescriptor} field - the field descriptor.
		 * @param {(key: string) => string} t - the dictionary lookup.
		 * @returns {string | undefined} the placeholder text.
		 */
		function placeholderFor(field, t) {
			if (field.placeholder !== true) return undefined;
			return t(`field.${field.key}.placeholder`);
		}

		/**
		 * The standing notice a non-macOS host produces.
		 *
		 * @param {Verdict} verdict - {@link hostVerdict} output.
		 * @returns {{titleKey: string, bodyKey: string, platform: string}|null} the notice, or nothing.
		 */
		function unsupportedNotice(verdict) {
			if (verdict.supported !== false) return null;
			return {
				titleKey: "hostUnsupportedTitle",
				bodyKey: "hostUnsupportedBody",
				platform: verdict.label || verdict.platform,
			};
		}

		/**
		 * One labelled control.
		 *
		 * The chrome (label, hint, invalid message, override badge, reset) is
		 * rebuilt here rather than borrowed from `SettingsValueField`, because that
		 * control only renders a single-line text input and this page needs selects,
		 * switches and textareas to share one frame. The frame is the primitives'
		 * own field shape: the label row, then the control, then the hint.
		 *
		 * @param {FieldProps} props - the control's props.
		 * @returns {import("react").ReactNode} the control.
		 */
		function Field(props) {
			const { field, state, disabled, onChange, onReset, t } = props;
			const id = React.useId();
			// An unknown list stays unknown: an empty list is a finding - the host
			// looked and found nothing - while an unknown list is the absence of one,
			// and only the second may leave a stored value unmarked.
			const suggestions = props.suggestions;
			const control = renderControl({ field, state, disabled, id, suggestions, onChange, t });
			return h(
				"div",
				{ className: "ismh_field" },
				h(
					"div",
					{ className: "ismh_head" },
					h(
						"label",
						{ className: "ismh_label", htmlFor: field.kind === "boolean" ? undefined : id },
						t(`field.${field.key}`),
					),
					state.overridden ? h(P.Tag, { tone: "outline" }, t("overridden")) : null,
					state.overridden
						? h("button", { type: "button", className: "ismh_reset", onClick: onReset, disabled }, t("reset"))
						: null,
				),
				control,
				state.invalid
					? h("p", { className: "ismh_error", role: "status" }, t("invalid"))
					: h("span", { className: "ismh_hint" }, t(`field.${field.key}.hint`)),
			);
		}

		/**
		 * The shared frame for every control that offers a list of values.
		 *
		 * The fixed selects and the discovery dropdowns all render through here,
		 * so the chevron is one stroked SVG path in one place rather than a CSS
		 * triangle per renderer. The browser half is a classic script with no
		 * filesystem of its own, so the icon has to be inline rather than an
		 * imported asset.
		 *
		 * @param {import("react").ReactNode} control - the select itself.
		 * @returns {import("react").ReactNode} the framed control.
		 */
		function renderSelectWrap(control) {
			return h(
				"span",
				{ className: "ismh_selectWrap" },
				control,
				h(
					"svg",
					{
						className: "ismh_chevron",
						viewBox: "0 0 16 16",
						"aria-hidden": "true",
						focusable: "false",
					},
					h("path", { d: "M4 6l4 4 4-4" }),
				),
			);
		}

		/**
		 * The native select for a `select` field.
		 *
		 * The chevron is drawn by the wrapper: a native select cannot carry a
		 * pseudo-element of its own, and an icon child would end up in the
		 * accessibility tree.
		 *
		 * @param {ControlInput} input - the field, its staged state and the control's wiring.
		 * @returns {import("react").ReactNode} the control.
		 */
		function renderSelect(input) {
			const { field, state, disabled, id, onChange, t } = input;
			return renderSelectWrap(
				h(
					"select",
					{
						id,
						className: "ismh_control ismh_select",
						value: state.text,
						disabled,
						"aria-invalid": state.invalid ? "true" : undefined,
						onChange: (/** @type {import("react").ChangeEvent<{ value: string }>} */ event) =>
							onChange(event.target.value),
					},
					selectOptions(field, state.text).map((value) =>
						h("option", { key: value === "" ? "__auto__" : value, value }, optionLabel(field, value, t)),
					),
				),
			);
		}

		/**
		 * The dropdown for a `discovery` field.
		 *
		 * It shares the `select` frame and differs only in where the options
		 * come from: the descriptor carries no list, so the values are the ones
		 * the host's inventory route answered for the field's `suggest` source.
		 * The user picks one of them and cannot type a value of their own, which
		 * is what keeps the setting a name this machine actually has.
		 *
		 * @param {ControlInput} input - the field, its staged state and the control's wiring.
		 * @returns {import("react").ReactNode} the control.
		 */
		function renderDiscoverySelect(input) {
			const { field, state, disabled, id, suggestions, onChange, t } = input;
			// The host reads a whitespace-only value as unset, so the control does
			// too: a stored value of spaces would otherwise select no option at
			// all and read as a control that failed to render.
			const value = state.text.trim();
			return renderSelectWrap(
				h(
					"select",
					{
						id,
						className: "ismh_control ismh_select",
						value,
						disabled,
						"aria-invalid": state.invalid ? "true" : undefined,
						onChange: (/** @type {import("react").ChangeEvent<{ value: string }>} */ event) =>
							onChange(event.target.value),
					},
					discoveryOptions(value, suggestions).map((option) =>
						h(
							"option",
							{ key: option.value === "" ? "__auto__" : option.value, value: option.value },
							discoveryOptionLabel(field, option, t),
						),
					),
				),
			);
		}

		/**
		 * The options a discovery dropdown offers, given what the host found.
		 *
		 * The discovered values keep the order the host served, so the devices
		 * and the runtimes do not reshuffle on every render. The current value is
		 * appended when the discovery did not return it: a saved value that has
		 * since been deleted, or one named before the runtime was installed,
		 * must still appear in the control that holds it - a `<select>` whose
		 * value matches no option otherwise renders as nothing selected, which
		 * would also make the next save commit an empty value.
		 *
		 * A value the discovery did not return is marked only when nothing on
		 * this machine answers to it. The host matches a fragment - a device
		 * whose name contains the value, a runtime whose identifier contains it -
		 * so a value that is still a prefix of one of the listed names keeps
		 * working, and marking it missing would tell the user to re-pick a
		 * setting that is in effect.
		 *
		 * A list that is `null` means the host has not answered yet, or answered
		 * from a host that cannot enumerate the simulator stack. Nothing is known
		 * then, so nothing is marked: a dropdown that called a device missing
		 * while the request was still in flight would be contradicting the host it
		 * is about to render, and a failed request would leave it contradicting
		 * the host for good.
		 *
		 * An empty stored value needs an entry of its own for the same reason:
		 * without one the control would show nothing selected, and the reader
		 * could not tell "no runtime was chosen" from a control that failed to
		 * render.
		 *
		 * Exported for the tests: this is the one part of the control that can be
		 * exercised without a browser, and the renderer calls this same function.
		 *
		 * @param {string|undefined} current - the value the field currently holds.
		 * @param {DiscoveryOption[] | null | undefined} options - the options discovery returned, or nothing while nothing is known.
		 * @returns {DiscoveryOption[]} the options to render.
		 */
		function discoveryOptions(current, options) {
			const list = [...(options ?? [])];
			if (current === undefined || current === "") {
				if (!list.some((option) => option.value === "")) {
					list.unshift({ value: "", label: "", found: true });
				}
				return list;
			}
			if (!list.some((option) => option.value === current)) {
				// Nothing is known while the host has not answered, so nothing is
				// marked; once it has answered, a value the listed names still
				// answer to is a working setting, not a missing one.
				list.push({
					value: current,
					label: current,
					found: options == null || resolvesTo(list, current),
				});
			}
			return list;
		}

		/**
		 * Whether the host's own matching rule answers to a value.
		 *
		 * The simulator picker matches a device whose name contains the stored
		 * fragment, and a runtime whose identifier contains the stored one. The
		 * listed runtimes are the tail of that identifier, so the same rule holds
		 * for them: an option whose value contains the stored value is one the
		 * picker would have resolved.
		 *
		 * @param {DiscoveryOption[]} options - the options the host returned.
		 * @param {string} value - the stored value.
		 * @returns {boolean} whether the host still answers to it.
		 */
		function resolvesTo(options, value) {
			const want = value.toLowerCase();
			return options.some((option) => option.value.toLowerCase().includes(want));
		}

		/**
		 * The display text of one discovery option.
		 *
		 * The value the control stores is never translated - a Chinese page
		 * still writes `iOS-27-1` into the profile - but the two entries that
		 * are not a discovered name carry their own text: the empty one says
		 * what an unset value means, and a value the host no longer has says so
		 * rather than passing for one it does.
		 *
		 * @param {FieldDescriptor} field - the field the option belongs to.
		 * @param {DiscoveryOption} option - the option to label.
		 * @param {(key: string, values?: Record<string, string>) => string} t - the dictionary lookup.
		 * @returns {string} the text to show.
		 */
		function discoveryOptionLabel(field, option, t) {
			if (option.value === "") return t(`option.${field.key}.any`);
			if (!option.found) return t("notFound", { name: option.label });
			return option.label;
		}

		/**
		 * The control element for one field descriptor.
		 *
		 * @param {ControlInput} input - the control's props.
		 * @returns {import("react").ReactNode} the control element.
		 */
		function renderControl(input) {
			const { field, state, disabled, id, onChange, t } = input;
			switch (field.kind) {
				case "boolean":
					// The switch is its own state indicator: a neighbouring "on"/"off"
					// label would only repeat what the track already shows.
					return h(P.Switch, {
						checked: state.text === "true",
						disabled,
						label: t(`field.${field.key}`),
						onChange: (next) => onChange(next ? "true" : "false"),
					});
				case "select":
					return renderSelect(input);
				case "discovery":
					return renderDiscoverySelect(input);
				case "multiline":
					return h("textarea", {
						id,
						className: "ismh_control ismh_area",
						value: state.text,
						rows: 5,
						spellCheck: false,
						placeholder: placeholderFor(field, t),
						disabled,
						"aria-invalid": state.invalid ? "true" : undefined,
						onChange: (/** @type {import("react").ChangeEvent<{ value: string }>} */ event) =>
									onChange(event.target.value),
					});
				default:
					// A timeout is three digits wide and does not need the whole column;
					// a path or a device name does.
					return h("input", {
						id,
						className: field.kind === "number" ? "ismh_control ismh_short" : "ismh_control",
						type: field.kind === "number" ? "number" : "text",
						inputMode: field.kind === "number" ? "numeric" : undefined,
						value: state.text,
						placeholder: placeholderFor(field, t),
						disabled,
						spellCheck: false,
						"aria-invalid": state.invalid ? "true" : undefined,
						onChange: (/** @type {import("react").ChangeEvent<{ value: string }>} */ event) =>
							onChange(event.target.value),
					});
			}
		}

		/**
		 * The action bar's state for one projection of the form.
		 *
		 * The bar is the only place a save starts, and it exists only while there is
		 * something to act on: a staged edit waiting to be written, a write in
		 * flight, or a failure worth retrying. A clean form answers `null`, which is
		 * what removes the bar from the page — nothing lingers in a hidden state.
		 *
		 * The shape is flat on purpose: the component below only maps it to
		 * elements, so every rule about what may be pressed lives here, in one place.
		 *
		 * @param {{dirty: boolean, invalid: boolean, saving: boolean, failed: boolean}} shell -
		 *   the form-level state the shared model publishes.
		 * @param {Function} t - the page's dictionary lookup.
		 * @returns {{tone: string, message: string, canSave: boolean, canDiscard: boolean}|null}
		 *   the bar state, or `null` when the bar has nothing to say.
		 */
		function actionBarState(shell, t) {
			if (shell.failed) {
				return { tone: "error", message: t("writeFailed"), canDiscard: true, canSave: shell.dirty && !shell.invalid };
			}
			if (shell.saving) return { tone: "pending", message: t("saving"), canDiscard: false, canSave: false };
			if (!shell.dirty) return null;
			if (shell.invalid) return { tone: "error", message: t("writeBlocked"), canDiscard: true, canSave: false };
			return { tone: "pending", message: t("pendingWrite"), canDiscard: true, canSave: true };
		}

		/**
		 * The action bar: the staged form's status plus the two ways out of it.
		 *
		 * A plain element at the end of the page column, kept on screen by the
		 * stylesheet while the page scrolls. Both buttons are the shared `Button`
		 * primitive and the leading mark is the shared `StateDot`, so what it looks
		 * like comes from the platform rather than from this page.
		 *
		 * @param {ActionBarProps} props - the bar state, the form shell and the two actions.
		 * @returns {import("react").ReactNode} the bar, or nothing while the form is clean.
		 */
		function ActionBar(props) {
			const { view, shell, t, onDiscard, onSave } = props;
			if (view === null) return null;
			const failed = view.tone === "error";
			return h(
				"div",
				{ className: failed ? "ismh_actions ismh_actionsError" : "ismh_actions" },
				h(P.StateDot, { state: failed ? "error" : "warning", size: 8 }),
				// The pill is as wide as its content, so a long failure message is
				// truncated; the title attribute keeps the whole sentence reachable.
				h(
					"p",
					{ className: "ismh_actionsText", role: "status", "aria-live": "polite", title: view.message },
					view.message,
				),
				h(
					P.Button,
					{ variant: "ghost", size: "sm", disabled: !view.canDiscard || shell.saving, onClick: onDiscard },
					t("discard"),
				),
				h(
					P.Button,
					{ variant: "primary", size: "sm", disabled: !view.canSave || shell.saving, onClick: onSave },
					shell.saving ? t("saving") : t("save"),
				),
			);
		}

		/**
		 * The transient "written" confirmation.
		 *
		 * The shared `Toast` owns the hold, the fade and the teardown: it reports
		 * completion through `onDone`, which acknowledges the sequence and unmounts
		 * it. The sequence is the number of the write that landed, and it is the
		 * toast's key: a later landing restarts the cycle, an acknowledged sequence
		 * shows nothing.
		 *
		 * The sequence is owned by the controller rather than by this component, so
		 * the confirmation is part of the form's projection. That is what keeps a
		 * page that mounts after an earlier visit's save from replaying it — the
		 * controller announces a landing only while the page is on screen — and it
		 * is what lets the render test observe the toast, because a server render
		 * gives no effect the chance to show one.
		 *
		 * @param {SavedToastProps} props - the landed-write sequence, the dictionary lookup
		 *   and the acknowledgement the toast reports completion through.
		 * @returns {import("react").ReactNode} the toast, or nothing.
		 */
		function SavedToast(props) {
			const { tick, t, onDone } = props;
			if (tick === 0) return null;
			return h(P.Toast, { key: tick, tone: "success", text: t("written"), onDone });
		}

		/**
		 * The plugin's parameter form, as the Plugins page asks for it.
		 *
		 * The page asks for `view: 'page'` only — `plugins.bundle.config` has no
		 * summary view, because the page already draws the plugin's title and
		 * description above this section. The form therefore contributes its
		 * groups, the diagnostics card and the save bar, and nothing that repeats
		 * the page's own chrome.
		 *
		 * @param {FormFace} props - the injected form face, the dictionary lookup and the view.
		 * @returns {import("react").ReactNode} the form.
		 */
		function PluginConfig(props) {
			const state = props.useIosSimulatorSettings((snapshot) => snapshot);
			const { t } = props;
			const host = useRemote(props.loadHost);
			const diagnostics = useRemote(props.loadStatus);
			const inventory = useRemote(props.loadInventory);

			// The summary view is a sentence, not a form: the row's page draws the
			// title and the crumb, and a summary that rendered the whole form would
			// put it in the description slot of the page that already holds it.
			if (props.view === "summary") return h("span", null, t("rowSummary"));

			// The authoritative host check runs once on mount; the synchronous
			// browser verdict below already covers the first paint.
			React.useEffect(() => {
				void host.run();
			}, [host.run]);

			// The device and runtime dropdowns are only as good as the inventory
			// behind them: an option list that stays empty until the user finds
			// the refresh button is not "the devices on this machine". Read the
			// inventory once when the page opens; the button re-runs the same read
			// afterwards.
			React.useEffect(() => {
				void inventory.run();
			}, [inventory.run]);

			const clientPlatform = React.useMemo(
				() => detectClientPlatform(typeof navigator === "undefined" ? undefined : navigator),
				[],
			);
			const verdict = hostVerdict(clientPlatform, host.data);
			const notice = unsupportedNotice(verdict);

			const suggestions = buildSuggestions(inventory.data);

			// Leaving the page abandons staged edits, exactly as the harness's own
			// settings forms do: the controller outlives the page, so without this a
			// half-finished edit would still be staged on the next visit. The same
			// teardown reports the page gone, so a write that lands afterwards is
			// counted but never announced to a visit that has already ended.
			const discard = React.useRef(props.discard);
			discard.current = props.discard;
			const pageMounted = React.useRef(props.pageMounted);
			pageMounted.current = props.pageMounted;
			// The same form can be mounted twice - on the row's own page and in the
			// Settings dialog - and closing one must not throw away what the other
			// has staged. The staged edits are therefore dropped only when the LAST
			// placement goes away.
			const mountedPlacements = React.useRef(0);
			React.useEffect(() => {
				mountedPlacements.current += 1;
				const left = pageMounted.current?.();
				return () => {
					mountedPlacements.current -= 1;
					if (mountedPlacements.current > 0) return;
					if (typeof left === "function") left();
					discard.current();
				};
			}, []);

			const bar = actionBarState(state, t);

			if (!state.available) {
				return h(
					"div",
					{ className: "ismh_page" },
					h("p", { className: "ismh_intro", role: "status" }, t(state.status === "loading" ? "loading" : "unavailable")),
				);
			}

			return h(
				"div",
				{ className: "ismh_page" },
				h("p", { className: "ismh_intro" }, t("intro")),
				notice === null
					? null
					: h(
							"div",
							{ className: "ismh_alert", role: "alert" },
							h("p", { className: "ismh_alertTitle" }, t(notice.titleKey)),
							h(
								"p",
								{ className: "ismh_alertBody" },
								t(notice.bodyKey, { platform: notice.platform }),
								" ",
								h("code", { className: "ismh_mono" }, `${verdict.platform}`),
							),
						),
				state.writable ? null : h("p", { className: "ismh_readOnly", role: "status" }, t("readOnly")),
				// One card per category: the outline is what separates them, so the
				// categories stay legible without a rule between every block.
				GROUPS.map((group) =>
					h(
						"section",
						{ className: "ismh_group", key: group.id },
						h(
							"div",
							{ className: "ismh_groupHead" },
							h("h3", { className: "ismh_groupTitle" }, t(`group.${group.id}`)),
						),
						h("p", { className: "ismh_groupHint" }, t(`group.${group.id}.hint`)),
						group.fields.map((field) =>
							h(Field, {
								key: field.key,
								field,
								state: state.fields[field.key] ?? { text: "", overridden: false, invalid: false },
								disabled: !state.writable || state.saving,
								suggestions: field.suggest ? suggestions[field.suggest] : undefined,
								onChange: (text) => props.edit(field.key, text),
								onReset: () => props.resetField(field.key),
								t,
							}),
						),
					),
				),
				h(
					"section",
					{ className: "ismh_group" },
					h("div", { className: "ismh_groupHead" }, h("h3", { className: "ismh_groupTitle" }, t("toolsTitle"))),
					h("p", { className: "ismh_groupHint" }, t("toolsHint")),
					renderHostLine(verdict, host, t),
					h(
						"div",
						{ className: "ismh_toolRow" },
						h(
							P.Button,
							{
								variant: "outline",
								size: "sm",
								disabled: diagnostics.loading,
								onClick: () => void diagnostics.run(),
							},
							diagnostics.loading ? t("checking") : t("runCheck"),
						),
						h(
							P.Button,
							{
								variant: "outline",
								size: "sm",
								disabled: inventory.loading,
								onClick: () => void inventory.run(),
							},
							inventory.loading ? t("refreshing") : t("refresh"),
						),
					),
					renderDiagnostics(diagnostics, t),
					renderInventory(inventory, t),
				),
				h(ActionBar, { view: bar, shell: state, t, onDiscard: props.discard, onSave: props.save }),
				h(SavedToast, { tick: state.toastSeq, t, onDone: props.acknowledgeSaved }),
			);
		}

		/**
		 * The one-line host verdict inside the diagnostics section.
		 *
		 * @param {Verdict} verdict - the merged verdict.
		 * @param {RemoteState<HostPayload> & {run: () => Promise<void>}} host - the host request's state.
		 * @param {(key: string, values?: Record<string, string>) => string} t - the dictionary lookup.
		 * @returns {import("react").ReactNode} the line.
		 */
		function renderHostLine(verdict, host, t) {
			if (host.loading && verdict.source === "unknown") {
				return h("p", { className: "ismh_note", role: "status" }, t("hostChecking"));
			}
			if (host.error !== undefined) {
				return h("p", { className: "ismh_error", role: "status" }, `${t("hostCheckFailed")}: ${host.error}`);
			}
			const text =
				verdict.supported === true
					? `${t("hostSupported")} (${verdict.platform}/${host.data?.arch ?? "?"})`
					: verdict.supported === false
						? `${t("unsupported")} (${verdict.label})`
						: t("hostUnknown");
			return h("p", { className: "ismh_note", "data-host-check": verdict.source }, text);
		}

		/**
		 * The diagnostic result list, or nothing before the first run.
		 *
		 * @param {RemoteState<DiagnosticReport> & {run: () => Promise<void>}} diagnostics - the diagnostic request's state.
		 * @param {(key: string, values?: Record<string, string>) => string} t - the dictionary lookup.
		 * @returns {import("react").ReactNode} the list.
		 */
		function renderDiagnostics(diagnostics, t) {
			if (diagnostics.error !== undefined) {
				return h(
					"p",
					{ className: "ismh_error", role: "status" },
					`${t("statusFailed")}: ${diagnostics.error}`,
				);
			}
			const report = diagnostics.data;
			if (report === undefined) return null;
			return h(
				"div",
				{ className: "ismh_group" },
				h(
					"div",
					{ className: "ismh_verdict" },
					h(P.StateDot, { state: report.ok ? "done" : "error" }),
					h("span", null, report.ok ? t("ready") : report.supported === false ? t("unsupported") : t("notReady")),
				),
				h(
					"ul",
					{ className: "ismh_checks" },
					report.checks.map((check) =>
						h(
							"li",
							{ className: "ismh_check", key: check.name },
							h(P.StateDot, { state: check.ok ? "done" : "error", size: 8 }),
							h(
								"div",
								{ className: "ismh_checkBody" },
								h("span", { className: "ismh_checkName" }, check.name),
								h("p", { className: "ismh_checkDetail" }, check.detail),
								check.ok || !check.fix ? null : h("p", { className: "ismh_checkFix" }, check.fix),
							),
						),
					),
				),
			);
		}

		/**
		 * The discovery summary, or nothing before the first run.
		 *
		 * @param {RemoteState<InventoryPayload> & {run: () => Promise<void>}} inventory - the discovery request's state.
		 * @param {(key: string, values?: Record<string, string>) => string} t - the dictionary lookup.
		 * @returns {import("react").ReactNode} the summary.
		 */
		function renderInventory(inventory, t) {
			if (inventory.error !== undefined) {
				return h("p", { className: "ismh_error", role: "status" }, `${t("inventoryFailed")}: ${inventory.error}`);
			}
			const data = inventory.data;
			if (data === undefined) return null;
			const runtimes = data.runtimes ?? [];
			const simulators = data.simulators ?? [];
			return h(
				"div",
				{ className: "ismh_group" },
				h(
					"p",
					{ className: "ismh_checkDetail" },
					`${t("xcode")}: ${data.xcodePath ?? t("none")}${data.xcodeVersion ? ` (${data.xcodeVersion})` : ""}`,
				),
				h("p", { className: "ismh_checkDetail" }, `${t("macOSVersion")}: ${data.macOSVersion ?? t("none")}`),
				h(
					"p",
					{ className: "ismh_checkDetail" },
					`${t("defaultTarget")}: ${data.defaultTarget ? `${data.defaultTarget.name} (${data.defaultTarget.state})` : data.defaultTargetError ?? t("none")}`,
				),
				h(
					"p",
					{ className: "ismh_checkDetail" },
					`${t("runtimes")} (${runtimes.length}): ${runtimes.length === 0 ? t("none") : runtimes.map((item) => item.name).join(", ")}`,
				),
				h(
					"p",
					{ className: "ismh_checkDetail" },
					`${t("simulators")} (${simulators.length}): ${simulators.length === 0 ? t("none") : simulators.map((item) => `${item.name}:${item.state}`).join(", ")}`,
				),
			);
		}

		/**
		 * Fetch-on-demand state for one host route.
		 *
		 * The loader is read through a ref so the returned `run` identity stays
		 * stable across renders: the injected face is rebuilt on every render,
		 * and a `run` that changed identity each time would defeat memoization
		 * deeper in the tree for no benefit.
		 *
		 * @template T
		 * @param {() => Promise<T>} get - the request to run.
		 * @returns {RemoteState<T> & {run: () => Promise<void>}} the request's state and the way to start it.
		 */
		function useRemote(get) {
			const [state, setState] = React.useState(
				/** @type {RemoteState<T>} */ ({ loading: false, data: undefined, error: undefined }),
			);
			const latest = React.useRef(get);
			latest.current = get;
			const run = React.useCallback(async () => {
				setState({ loading: true, data: undefined, error: undefined });
				try {
					const data = await latest.current();
					setState({ loading: false, data, error: undefined });
				} catch (error) {
					const message = /** @type {{message?: unknown}} */ (error)?.message;
					setState({ loading: false, data: undefined, error: String(message ?? error) });
				}
			}, []);
			return { ...state, run };
		}

		/**
		 * Order-preserving de-duplication for suggestion lists.
		 *
		 * @param {string[]} items - the values to de-duplicate.
		 * @returns {string[]} the distinct values, in order.
		 */
		function unique(items) {
			return [...new Set(items)];
		}

		/**
		 * The option lists the discovery dropdowns offer, built from one
		 * inventory answer.
		 *
		 * The names are the contract: a field's `suggest` names one of them, and
		 * the consistency gate refuses a name this half does not provide. A
		 * mistyped name would otherwise yield `undefined`, which becomes an
		 * empty list and silently empties the dropdown.
		 *
		 * A list is `null` while nothing is known: the request has not answered
		 * yet, or the host answered from a host that cannot enumerate the
		 * simulator stack at all. That is not the same as an empty list - an
		 * empty list is a finding, the host looked and found nothing - and only
		 * the second may leave a stored value marked as missing.
		 *
		 * @param {InventoryPayload | undefined} data - the inventory the host served.
		 * @returns {Record<string, DiscoveryOption[] | null>} one list per discovery source, `null` while nothing is known.
		 */
		function buildSuggestions(data) {
			if (data === undefined || data.supported === false) {
				return { devices: null, runtimes: null };
			}
			return {
				devices: deviceOptions(data.simulators),
				runtimes: runtimeOptions(data.runtimes),
			};
		}

		/**
		 * The device options a discovery dropdown offers.
		 *
		 * Only the devices that can be used are listed: `simctl` marks a device
		 * whose runtime is missing as unavailable, and offering one of those
		 * would store a name no call could ever resolve. The name is both the
		 * label and the value, because the setting stores a device-name fragment
		 * and the name is what the simulator picker matches on.
		 *
		 * @param {SimulatorTarget[] | undefined} simulators - the devices the host found.
		 * @returns {DiscoveryOption[]} the options, in name order.
		 */
		function deviceOptions(simulators) {
			return unique(
				(simulators ?? [])
					.filter((item) => item.available !== false)
					.map((item) => item.name),
			)
				.sort()
				.map((name) => ({ value: name, label: name, found: true }));
		}

		/**
		 * The runtime options a discovery dropdown offers.
		 *
		 * The value is the fragment the simulator picker matches a device on —
		 * the tail of the runtime identifier, `iOS-27-1` — and the label is the
		 * runtime's display name, `iOS 27.1`. The display name is not a
		 * substring of the identifier, so storing it would leave the setting
		 * pointing at no runtime at all, which is why the two are not the same
		 * string.
		 *
		 * Two runtimes that share a tail would offer the same value twice, and a
		 * `<select>` cannot hold two options under one value, so the first name
		 * wins and the second is dropped.
		 *
		 * @param {RuntimeTarget[] | undefined} runtimes - the runtimes the host found.
		 * @returns {DiscoveryOption[]} the options.
		 */
		function runtimeOptions(runtimes) {
			/** @type {Map<string, string>} */
			const byFragment = new Map();
			for (const item of runtimes ?? []) {
				if (item.available === false) continue;
				const fragment = runtimeFragment(item.identifier);
				if (fragment === "") continue;
				if (!byFragment.has(fragment)) byFragment.set(fragment, item.name);
			}
			return [...byFragment].map(([value, label]) => ({ value, label, found: true }));
		}

		/**
		 * The fragment a runtime is stored under.
		 *
		 * `simctl` keys a device list by the runtime's full identifier,
		 * `com.apple.CoreSimulator.SimRuntime.iOS-27-1`, and the simulator
		 * picker matches a device on that key. Its tail is the short form the
		 * setting stores, and the one the plugin's own hint names.
		 *
		 * @param {string | undefined} identifier - the runtime identifier.
		 * @returns {string} the fragment, or nothing when the identifier is unusable.
		 */
		function runtimeFragment(identifier) {
			const parts = String(identifier ?? "").split(".");
			return parts[parts.length - 1] ?? "";
		}

		/**
		 * Fetch one JSON host route, failing loudly on a non-2xx answer.
		 *
		 * @param {string} url - the route to fetch.
		 * @returns {Promise<unknown>} the parsed body.
		 */
		async function fetchJson(url) {
			const response = await fetch(url, { headers: { accept: "application/json" } });
			const body = await response.json().catch(() => undefined);
			if (!response.ok) {
				throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
			}
			return body;
		}

		/**
		 * How far one control's draft is from the value the Host already serves.
		 *
		 * The shared model stages every keystroke and treats any staged draft as an
		 * edit: its `overridden` means "a save would leave a value in the user
		 * layer", which is right when reviewing a write but wrong for the page's
		 * badge and bar. Flipping a switch back, or retyping the value already in
		 * effect, otherwise left the form dirty and the control flagged as overridden
		 * while a save would write nothing. This classifies the draft by comparing
		 * the value it would write with the one in effect, so the page can present a
		 * control that has not actually changed as unchanged.
		 *
		 * A pending reset is the one draft the text alone cannot express. The model
		 * stages a reset as the base value's text plus a clear flag, so the text
		 * parses back as a plain `set` of the base value — and a base value that
		 * already equals the value in effect reads as no change at all, while the
		 * model's own plan still holds the `unset` the reset means. Left that way
		 * the bar closed on a reset the user could no longer save, and the next
		 * unrelated save applied it unseen. The model's field state is what says a
		 * clear is staged: a stored key whose control is no longer overridden. That
		 * is a real change, so a reset stays a pending change like any other.
		 *
		 * It asks the scope rather than the raw snapshot, so a draft staged against
		 * an older baseline is judged by the same value the model's own `stored`
		 * check uses.
		 *
		 * @param {FormReads} reads - the scope's public reads.
		 * @param {FieldDescriptor} field - the field descriptor.
		 * @param {FieldState} state - the model's state for this field: the draft's
		 *   text and whether a save would leave an override.
		 * @returns {"noop"|"real"|"invalid"} `noop` when a save would change nothing,
		 *   `invalid` when the draft is not a value the field accepts.
		 */
		function draftDelta(reads, field, state) {
			const write = specFor(field).parse(state.text);
			if (write === undefined) return "invalid";
			// A staged clear on a key the user layer carries is a pending reset: the
			// model reports the control as no longer overridden, and the write is the
			// `unset` the reset means.
			if (state.overridden === false && reads.stored(field.key)) return "real";
			// Every clear is a pending change. Even when the user layer carries no
			// key, the model plans the `unset` and the field is visibly empty; hiding
			// the action bar would leave that state impossible to save or discard.
			if (write.kind === "clear") return "real";
			return Object.is(write.value, reads.sectionValue(field.key)) ? "noop" : "real";
		}

		/**
		 * The scope's public reads of what the user layer carries.
		 *
		 * The model keeps its own view of that, but those members are private to it.
		 * The scope's snapshot says the same thing, so the page reads that instead:
		 * reaching into a private member is a dependency the type gate cannot see,
		 * and a primitives release is free to change it.
		 *
		 * @param {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormScope<Record<string, unknown>>} scope - the shared form.
		 * @returns {FormReads} the reads.
		 */
		function formReads(scope) {
			return {
				stored: (field) => {
					const user = scope.getSnapshot().user;
					return typeof user === "object" && user !== null && Object.hasOwn(user, field);
				},
				sectionValue: (field) => scope.getSnapshot().value?.[field],
			};
		}

		/**
		 * Own the page's staged form and the face its slot entry injects.
		 *
		 * Mirrors the pattern the shipped settings pages use: the model is built
		 * once per mount over the shared config form, the projection is published
		 * through a snapshot store so the component reads it with a selector, and
		 * disposal releases the subscription.
		 */
		/**
		 * @param {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormScope<Record<string, unknown>>} scope - the shared form.
		 */
		function Controller(scope) {
			this.scope = scope;
			/** @type {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormModel<Record<string, unknown>>} */
			this.model = new P.SettingsFormModel(
				scope,
				FIELDS.map((field) => specFor(field)),
			);
			/** @type {FormReads} */
			this.reads = formReads(scope);
			/** Saves that landed; the page flashes its confirmation when this grows. */
			this.savedCount = 0;
			/** Whether the page is on screen; only a page that is there announces a landing. */
			this.pageOpen = false;
			/** The landed write the page still has to confirm, or 0 when there is none. */
			this.toastSeq = 0;
			/** Whether a write was in flight at the last projection. */
			this.saveInFlight = false;
			/** @type {import("@deepseek-ai/dsh-client-store").SnapshotStore<PageState>} */
			this.store = this.model.bind(() => this.projection());
		}

		/**
		 * The page's state, as the store publishes it.
		 *
		 * @returns {PageState} the state.
		 */
		Controller.prototype.projection = function projection() {
			const shell = this.model.shell();
			// The primitive reports its state, not its outcome, so a save that landed
			// is observed as the transition out of "saving" with no failure and no
			// edits left staged. Counting it here keeps the page's confirmation free
			// of timers of its own.
			if (shell.saving) this.saveInFlight = true;
			else if (this.saveInFlight) {
				this.saveInFlight = false;
				if (!shell.failed && !shell.dirty) {
					this.savedCount += 1;
					// A landing is announced only to a page that is on screen. A write
					// that settles after the page was left is still counted, so the next
					// visit knows it landed, but its confirmation is not replayed there.
					if (this.pageOpen) this.toastSeq = this.savedCount;
				}
			}
			const snapshot = this.scope.getSnapshot();
			/** @type {Record<string, FieldState>} */
			const fields = {};
			let changes = 0;
			for (const field of FIELDS) {
				const state = this.model.field(field.key);
				const delta = draftDelta(this.reads, field, state);
				if (delta !== "noop") changes += 1;
				fields[field.key] =
					delta === "noop" && state.overridden
						? { ...state, overridden: this.reads.stored(field.key) }
						: state;
			}
			return {
				...shell,
				// The bar follows this count and not the model's own dirty flag alone:
				// the count is what judges a staged reset as the change it is, and what
				// keeps a control whose draft would write nothing out of the count.
				dirty: shell.dirty && changes > 0,
				// The landed write this page still has to confirm, keyed by its
				// sequence; 0 when the toast has nothing to say.
				toastSeq: this.toastSeq,
				status: snapshot.status,
				fields,
			};
		};

		/**
		 * Mark the page on screen and hand back the teardown that reports it gone.
		 *
		 * The confirmation belongs to the visit that saw the write: a landing is
		 * announced only while the page is on screen, and leaving clears both the
		 * toast that was showing and any landing the visit had not acknowledged.
		 * The page's mount effect calls this; the render test calls it through the
		 * same injected face, because a server render never runs an effect.
		 *
		 * @returns {() => void} the teardown to run when the page unmounts.
		 */
		Controller.prototype.pageMounted = function pageMounted() {
			this.pageOpen = true;
			this.toastSeq = 0;
			this.publish();
			return () => {
				this.pageOpen = false;
				this.toastSeq = 0;
				this.publish();
			};
		};

		/**
		 * Acknowledge the landed-write confirmation.
		 *
		 * The shared `Toast` reports completion through its `onDone`; clearing the
		 * sequence removes the toast, and publishing is what re-renders the page
		 * without a local state of its own.
		 */
		Controller.prototype.acknowledgeSaved = function acknowledgeSaved() {
			if (this.toastSeq === 0) return;
			this.toastSeq = 0;
			this.publish();
		};

		/**
		 * Re-publish the projection after a change the controller made itself.
		 *
		 * The form model re-projects whenever its own state changes; the page's
		 * lifecycle and the toast acknowledgement are the controller's own state,
		 * so they go through the store the component reads.
		 *
		 * The model's own `publish()` is private, and what it does is exactly this:
		 * push the projection into the store it handed out. Writing the store
		 * directly is the public way to say the same thing.
		 */
		Controller.prototype.publish = function publish() {
			this.store.set(this.projection());
		};

		Controller.prototype.inject = function inject() {
			return {
				hooks: { iosSimulatorSettings: this.store },
				...this.model.actions(),
				pageMounted: () => this.pageMounted(),
				acknowledgeSaved: () => this.acknowledgeSaved(),
				loadHost: () => fetchJson(HOST_ROUTE),
				loadStatus: () => fetchJson(STATUS_ROUTE),
				loadInventory: () => fetchJson(INVENTORY_ROUTE),
			};
		};

		Controller.prototype.dispose = function dispose() {
			this.model.dispose();
		};


		/**
		 * Whether the Settings dialog's section should be there.
		 *
		 * @param {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormScope<Record<string, unknown>>} scope - the shared form.
		 * @returns {boolean} whether the section belongs on screen.
		 */
		function settingsSectionVisible(scope) {
			return scope.getSnapshot().value?.[SETTINGS_SURFACE.field] === true;
		}

		/**
		 * The Settings rail's own icon.
		 *
		 * The artwork is published as a package asset and drawn as a mask over
		 * `currentColor`, so it follows the navigation item's own colour instead
		 * of freezing the file's ink.
		 *
		 * @param {{size?: number}} [props] - the icon's size in pixels.
		 * @returns {import("react").ReactNode} the icon.
		 */
		function SimulatorIcon(props) {
			const size = props?.size ?? 16;
			const mask = `url("${simulatorIconUrl}") center / contain no-repeat`;
			return h("span", {
				"aria-hidden": "true",
				style: {
					display: "inline-block",
					width: size,
					height: size,
					backgroundColor: "currentColor",
					mask,
					WebkitMask: mask,
				},
			});
		}

		/** Required services: the slot registry, the dictionary, and the shared config forms. */
		const inject = ["slots", "locale", "configForms"];

		/**
		 * Mount the plugin's parameter form on the Plugins page.
		 *
		 * The slot is the page's own: it renders the entry inside the plugin
		 * detail, keyed by the bundle's package name, and only while the Host
		 * serves the settings namespace this form binds to. The page draws the
		 * title, icon and crumb, so the entry registers neither a label nor an
		 * order of its own.
		 *
		 * @param {ClientContext} ctx - the browser plugin context.
		 */
		function apply(ctx) {
			const NS_T = LOCALE_NS;
			const dictionaries = DICTIONARIES;
			const t = ctx.locale.bind(NS_T);
			ctx.effect(
				() => ctx.locale.register(NS_T, { zh: dictionaries.zh, en: dictionaries.en }),
				"ios-simulator-helper: dictionaries",
			);

			const scope = /** @type {import("@deepseek-ai/dsh-client-ui-primitives").SettingsFormScope<Record<string, unknown>>} */ (
				/** @type {unknown} */ (ctx.configForms.get(NS))
			);
			const controller = new Controller(scope);
			ctx.effect(() => () => controller.dispose(), "ios-simulator-helper: settings form");

			ctx.effect(() => {
				if (typeof document === "undefined") return () => {};
				if (document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG)}]`) !== null) return () => {};
				const tag = document.createElement("style");
				tag.dataset.plugin = "@zhz8888/dsh-ios-simulator-helper";
				tag.dataset.pluginCss = CSS_TAG;
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, "ios-simulator-helper: form styles");

			ctx.effect(
				() =>
					ctx.configForms.whileServed([NS], () => {
						/** @type {Array<() => void>} */
						const disposers = [
							// The row's own page: the Plugins page renders this entry
							// through its keyed slot, and the row's Configure control
							// opens it. The bundle's page keeps its description, its rows
							// and its source.
							ctx.slots.inject(PLUGIN_SURFACE.slot, () =>
								ctx.slots.register(
									{
										name: PLUGIN_SURFACE.slot,
										key: PLUGIN_SURFACE.key,
										locale: NS_T,
										inject: () => controller.inject(),
									},
									PluginConfig,
								),
							),
						];
						// The Settings entry is opt-in and live: the page's own
						// switch decides whether the plugin has a second place to be
						// configured, and a save republishes the namespace snapshot, so
						// the entry appears and disappears with the value instead of at
						// the next reload.
						/** @type {(() => void)|undefined} */
						let disposeSettings;
						const sync = () => {
							const wanted = settingsSectionVisible(scope);
							if (wanted === (disposeSettings !== undefined)) return;
							if (!wanted) {
								disposeSettings?.();
								disposeSettings = undefined;
								return;
							}
							const entries = [
								ctx.slots.inject(SETTINGS_SURFACE.icon, () =>
									ctx.slots.register({ name: SETTINGS_SURFACE.icon, id: SETTINGS_SURFACE.id }, SimulatorIcon),
								),
								ctx.slots.inject(SETTINGS_SURFACE.section, () =>
									ctx.slots.register(
										{
											name: SETTINGS_SURFACE.section,
											id: SETTINGS_SURFACE.id,
											order: SETTINGS_SURFACE.order,
											label: () => t("sectionNav"),
											locale: NS_T,
											inject: () => controller.inject(),
										},
										PluginConfig,
									),
								),
							];
							disposeSettings = () => {
								for (const dispose of entries.reverse()) dispose();
							};
						};
						disposers.push(scope.subscribe(sync));
						disposers.push(() => {
							disposeSettings?.();
							disposeSettings = undefined;
						});
						sync();
						return () => {
							for (const dispose of disposers.reverse()) dispose();
						};
					}),
				"ios-simulator-helper: plugin page",
			);
		}

		exports.NS = NS;
		/**
		 * The slot and key this half registers into.
		 *
		 * The Plugins page keys a ROW's own configuration by the package name and
		 * the row id, so the key must be `<package name>#<namespace>`. The row's
		 * Configure control opens the page this entry renders on. Exported for the
		 * drift check in `scripts/check-bundle.mjs`; nothing at runtime reads this.
		 */
		exports.PLUGIN_SURFACE = PLUGIN_SURFACE;
		/**
		 * The Settings dialog's section, and the icon it draws.
		 *
		 * A page one edits repeatedly belongs in the navigation rail rather than
		 * behind a detail view, so the same form also appears there - behind a
		 * `showInSettings` switch that ships off. The switch is a live setting,
		 * not a boot decision: the section and its icon are registered while the
		 * saved value is true and disposed when it goes false, so a profile that
		 * never touches the switch keeps exactly one configuration page.
		 *
		 * Exported for the drift check in `scripts/check-bundle.mjs`; nothing at
		 * runtime reads this.
		 */
		exports.SETTINGS_SURFACE = SETTINGS_SURFACE;
		/**
		 * Field descriptors as this half sees them.
		 *
		 * Exported for the drift check in `scripts/check-bundle.mjs` only: the
		 * browser cannot import the host's `lib/settings.js`, so the two field
		 * tables are written twice and must be kept identical by construction.
		 * Nothing at runtime reads this.
		 */
		exports.FIELD_META = FIELDS.map((field) => ({
			key: field.key,
			kind: field.kind,
			options: field.options,
			min: field.min,
			max: field.max,
			placeholder: field.placeholder,
			optionLabel: field.optionLabel,
			suggest: field.suggest,
		}));
		/**
		 * The group metadata, exported for the consistency gate.
		 *
		 * The group titles and hints are the other half of the duplicated
		 * table, and the gate compares them the same way it compares the
		 * fields. Each group also publishes the keys of its own fields, in
		 * page order, so the gate can check that a group holds the fields it
		 * claims — the field table alone would not say which group a field
		 * belongs to. Nothing at runtime reads this.
		 */
		exports.GROUP_META = GROUPS.map((group) => ({
			id: group.id,
			fields: group.fields.map((field) => field.key),
		}));
		/**
		 * The macOS host-check logic, exported for the render test.
		 *
		 * `detectClientPlatform` reads `navigator` synchronously and
		 * `hostVerdict` merges it with the host route's answer, so the
		 * "only supports macOS" decision is a pure function of two inputs and
		 * can be asserted without a browser.
		 */
		exports.HOST_API = { detectClientPlatform, hostVerdict, requiredPlatform: REQUIRED_PLATFORM };
		/**
		 * The discovery dropdown's option builders, exported for the render test.
		 *
		 * The option lists are built from the inventory the host route answers,
		 * and a server render never fetches it, so the builders are the one
		 * part of the control that can be asserted without a browser.
		 */
		exports.DISCOVERY_API = {
			buildSuggestions,
			deviceOptions,
			runtimeOptions,
			runtimeFragment,
			discoveryOptions,
			discoveryOptionLabel,
		};
		/**
		 * The discovery lists the page builds, exported for the consistency gate.
		 *
		 * A field's `suggest` names one of these, and a name the page does not
		 * build yields an empty dropdown without anything failing. The gate
		 * compares the two sets. Nothing at runtime reads this.
		 */
		exports.DISCOVERY_SOURCES = Object.keys(buildSuggestions(undefined));
		/**
		 * The action bar's state machine, exported for the render test.
		 *
		 * The bar is the page's only save control, and its states depend on a staged
		 * form the server render cannot drive; asserting the pure function directly
		 * is what keeps every message and button rule pinned.
		 */
		exports.ACTION_BAR_API = { actionBarState };
		/**
		 * The dictionary keys the page's own chrome owns.
		 *
		 * Exported for the drift check in `scripts/check-bundle.mjs`: the gate
		 * requires every one of them to exist in both locale files, because a key
		 * the page can look up but the files do not declare renders as itself.
		 * Nothing at runtime reads this.
		 */
		exports.FIXED_KEYS = FIXED_KEYS;
		/**
		 * The page-initialization global the copy is read from.
		 *
		 * Exported so the gate can compare it with the host's own declaration: the
		 * two halves must agree on the name, or the page renders its keys.
		 */
		exports.LOCALE_GLOBAL = LOCALE_GLOBAL;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
