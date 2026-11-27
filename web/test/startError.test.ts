import { describe, expect, it } from 'vitest';
import { isPersonInput, webglHelp } from '../src/app/startError.ts';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1 Safari/605.1.15',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  android: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
};

describe('start screen without WebGL 2', () => {
  it('tells iPhones and iPads to update iOS', () => {
    expect(webglHelp(UA.iphone, 5)).toMatch(/iOS 15/);
    expect(webglHelp(UA.ipad, 5)).toMatch(/iOS 15/);
  });

  it('tells Chrome and Edge on a computer to turn on graphics acceleration', () => {
    expect(webglHelp(UA.chrome, 0)).toMatch(/^In Chrome.*graphics acceleration/);
    expect(webglHelp(UA.edge, 0)).toMatch(/^In Edge.*graphics acceleration/);
  });

  it('keeps the general advice elsewhere', () => {
    const general = 'Try a recent Chrome, Firefox or Safari.';
    expect(webglHelp(UA.android, 5)).toBe(general);
    expect(webglHelp(UA.firefox, 0)).toBe(general);
    // A real Mac (no touch screen) is not an iPad.
    expect(webglHelp(UA.ipad, 0)).toBe(general);
  });

  it('counts only input from a person', () => {
    const ev = (type: string, isTrusted: boolean, move = 0) => ({ type, isTrusted, movementX: move, movementY: 0 }) as unknown as Event;
    expect(isPersonInput(ev('pointerdown', true))).toBe(true);
    expect(isPersonInput(ev('keydown', true))).toBe(true);
    expect(isPersonInput(ev('pointermove', true, 3))).toBe(true);
    // A still cursor after a layout change, and events made by a script, are not a person.
    expect(isPersonInput(ev('pointermove', true, 0))).toBe(false);
    expect(isPersonInput(ev('pointerdown', false))).toBe(false);
  });
});
