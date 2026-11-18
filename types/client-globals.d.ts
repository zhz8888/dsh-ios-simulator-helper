/**
 * The two things the browser half runs against and the host half never sees.
 *
 * `lib/client.js` is a classic script, not a module: the shell's module table
 * answers its `require` at run time, so the modules it pulls in are declared
 * here rather than imported. TypeScript checks the same file the browser
 * evaluates, which is what keeps the two halves honest about the shape of
 * what they exchange.
 */

/**
 * The shell's module loader.
 *
 * The shell injects a `window.__ModuleLoader__` facade and evaluates the
 * bundle as a classic script; the bundle calls `load` once with its id and
 * its factory.
 */
interface Window {
  __ModuleLoader__: {
    load(entry: { id: string; factory: (require: typeof require) => unknown }): void
  }
}

/**
 * The shell's run-time `require`.
 *
 * It resolves against the shell's frozen seed table rather than the file
 * system, so the two specifiers the bundle uses are the only ones that can
 * be named. The catch-all overload is what the loader's own error message
 * is written against.
 */
declare function require(specifier: 'react'): typeof import('react')
declare function require(
  specifier: '@deepseek-ai/dsh-client-ui-primitives',
): typeof import('@deepseek-ai/dsh-client-ui-primitives')
declare function require(specifier: string): any

declare namespace require {
  /**
   * The URL of a file published by a package's own `assets` export.
   *
   * The argument is the served path with the `plugins/` prefix, not a bare
   * package path.
   *
   * @param reference - the served path of the asset.
   * @returns the URL the page can fetch.
   */
  function asset(reference: string): string
}