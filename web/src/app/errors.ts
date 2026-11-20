// Counts JavaScript errors on people's devices (#74), since testers rarely report a crash. One
// GoatCounter event per page load and kind (app/analytics.ts): `error/js-start` before the map has
// drawn for the first time, `error/js` after. No message, stack, file or address leaves the device;
// they are only read here to leave out errors that are not the app's.
import { track } from './analytics.ts';

/** Whether a window `error` event is one of the app's own (not a browser extension's or a known benign one). */
export function isAppError(e: { message?: string; filename?: string }, origin: string): boolean {
  // Cross-origin scripts (extensions, injected code) show up as "Script error." without a file.
  if (!e.filename || !e.filename.startsWith(origin)) return false;
  // Chromium reports layout that settles over two frames this way; nothing is broken.
  if (e.message?.includes('ResizeObserver loop')) return false;
  return true;
}

/** Whether an unhandled rejection is worth counting: a cancelled request is not an error. */
export const isAppRejection = (reason: unknown): boolean => !(reason instanceof DOMException && reason.name === 'AbortError');

/** Starts counting. Call the returned function once the map has drawn. */
export function setupErrorCounts(): () => void {
  let started = false;
  const count = () => track(started ? 'error/js' : 'error/js-start');
  window.addEventListener('error', (e) => {
    if (isAppError(e, location.origin)) count();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isAppRejection(e.reason)) count();
  });
  return () => {
    started = true;
  };
}
