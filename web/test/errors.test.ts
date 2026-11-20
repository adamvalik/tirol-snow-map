import { describe, expect, it } from 'vitest';
import { isAppError, isAppRejection } from '../src/app/errors.ts';

describe('error counts', () => {
  const origin = 'https://adamvalik.github.io';

  it("counts the app's own script errors", () => {
    expect(isAppError({ message: "TypeError: x is undefined", filename: `${origin}/tirol-snow-map/assets/index-abc.js` }, origin)).toBe(true);
  });

  it('leaves out extensions, other sites and benign resize notices', () => {
    expect(isAppError({ message: 'Script error.', filename: '' }, origin)).toBe(false);
    expect(isAppError({ message: 'boom', filename: 'chrome-extension://abc/content.js' }, origin)).toBe(false);
    expect(isAppError({ message: 'ResizeObserver loop completed with undelivered notifications.', filename: `${origin}/x.js` }, origin)).toBe(false);
  });

  it('does not count a cancelled request', () => {
    expect(isAppRejection(new DOMException('aborted', 'AbortError'))).toBe(false);
    expect(isAppRejection(new Error('HTTP 500'))).toBe(true);
    expect(isAppRejection(undefined)).toBe(true);
  });
});
