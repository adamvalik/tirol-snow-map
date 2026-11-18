// Set at build time in vite.config.ts.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __BUILD_ID__: string;
declare const __RELEASE_NOTES__: string[];

export const APP_VERSION = __APP_VERSION__;
export const APP_COMMIT = __APP_COMMIT__;
/** What's new in this version, from the Releases table of docs/release-plan.md; empty between releases. */
export const RELEASE_NOTES: readonly string[] = __RELEASE_NOTES__;
/** Different for every build (vite.config.ts). */
export const BUILD_ID = __BUILD_ID__;
/** For display and feedback, e.g. "v0.1.0 (444afeb)". */
export const VERSION_LABEL = `v${APP_VERSION} (${APP_COMMIT})`;
