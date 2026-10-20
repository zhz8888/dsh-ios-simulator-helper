/**
 * The macOS-only gate.
 *
 * Every capability this plugin exposes is Apple tooling: `xcrun simctl`,
 * `xcodebuild`, `open -a Simulator` and, for UI automation, `idb`. None of them
 * exists off macOS, so the ported providers do not merely fail — they say why.
 * The original ZCode plugin checked `process.platform === 'darwin'` once, in
 * preflight, and left the other tools to fail with a bare `spawn xcrun ENOENT`;
 * the check is centralised here instead, so the model gets one clear sentence
 * and the configuration page can show the same verdict before any tool runs.
 *
 * The platform is a parameter everywhere it is read, which is what makes the
 * non-macOS branch testable on a Mac.
 *
 * @module @zhz8888/dsh-ios-simulator-helper/providers/host
 */

/** The only platform this plugin supports. */
export const REQUIRED_PLATFORM = 'darwin'

/** Human-readable name of {@link REQUIRED_PLATFORM}. */
export const REQUIRED_PLATFORM_LABEL = 'macOS'

/** Platform names as a user would say them, for the settings-page notice. */
const PLATFORM_LABELS = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
  freebsd: 'FreeBSD',
  openbsd: 'OpenBSD',
  sunos: 'SunOS',
  aix: 'AIX',
  android: 'Android',
}

/**
 * Whether a platform can run this plugin.
 *
 * @param {string} [platform] - the platform to test; defaults to the process'.
 * @returns {boolean} true on macOS.
 */
export function isSupportedHost(platform = process.platform) {
  return platform === REQUIRED_PLATFORM
}

/** The user-facing name of a platform string. */
export function platformLabel(platform) {
  return PLATFORM_LABELS[platform] ?? String(platform ?? 'unknown')
}

/**
 * The structured host verdict, shared by preflight, the settings routes and the
 * configuration page's own browser-side check.
 *
 * @param {{platform?: string, arch?: string}} [input] - overrides for tests.
 * @returns {{platform: string, arch: string, label: string, supported: boolean,
 *   requiredPlatform: string, requiredPlatformLabel: string, detail: string}} the verdict.
 */
export function hostInfo(input = {}) {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const supported = isSupportedHost(platform)
  const label = platformLabel(platform)
  return {
    platform,
    arch,
    label,
    supported,
    requiredPlatform: REQUIRED_PLATFORM,
    requiredPlatformLabel: REQUIRED_PLATFORM_LABEL,
    detail: supported
      ? `macOS detected (${platform}/${arch})`
      : `unsupported host "${platform}/${arch}": this plugin only supports ${REQUIRED_PLATFORM_LABEL}`,
  }
}

/**
 * Throw unless the call runtime runs on macOS.
 *
 * Every provider that shells out to Apple tooling calls this first, so a
 * non-macOS deployment reports "only supports macOS" instead of an opaque
 * spawn failure.
 *
 * @param {{platform?: string}} [runtime] - the call runtime.
 * @returns {object} the host verdict when supported.
 * @throws {Error} when the host is not macOS.
 */
export function requireMacOS(runtime) {
  const info = hostInfo({ platform: runtime?.platform ?? process.platform })
  if (!info.supported) {
    throw new Error(
      `ios-simulator-helper only supports ${REQUIRED_PLATFORM_LABEL}: this host reports "${info.platform}" (${info.arch}). `
        + 'Xcode, xcrun simctl and Simulator.app do not exist here, so no simulator tool can run.',
    )
  }
  return info
}
