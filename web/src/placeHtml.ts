// HTML parts of the Place tab shared by the layers (snow cards, rows of numbers). No DOM access, so
// modules that the unit tests load can use them.
import { icon, type IconName } from './app/icons.ts';
import { SNOW_CLASSES } from './colors.ts';

/** Where a depth falls on the legend's bar, 0–100 %: each class takes one seventh. */
function rampPosition(cm: number): number {
  const bounds = [...SNOW_CLASSES.map((c) => c.min), 400];
  let i = SNOW_CLASSES.length - 1;
  while (i > 0 && cm < bounds[i]) i--;
  const frac = Math.min(1, Math.max(0, (cm - bounds[i]) / (bounds[i + 1] - bounds[i])));
  return ((i + frac) / SNOW_CLASSES.length) * 100;
}

export const rampHtml = (cm: number | null) =>
  `<div class="depth-ramp" aria-hidden="true"><div class="legend-bar">${SNOW_CLASSES.map((c) => `<span style="background:${c.color}"></span>`).join('')}</div>${
    cm === null ? '' : `<span class="depth-marker" style="left:${rampPosition(cm).toFixed(1)}%"></span>`
  }</div>`;

/** The grey card with a snow depth: label, the big number, its place on the colour bar, lines under it. */
export function depthCardHtml(label: string, cm: number | null, valueHtml: string, lines: string[] = [], extra = ''): string {
  return `<div class="depth-card">
    <div class="depth-head"><span class="depth-label">${label}</span>${valueHtml}</div>
    ${cm === null ? '' : rampHtml(cm)}
    ${lines.length ? `<div class="depth-lines">${lines.join('')}</div>` : ''}
    ${extra}
  </div>`;
}

export const depthValue = (cm: number, approx = false) =>
  `<span class="depth-value">${approx ? '~' : ''}${Math.round(cm)}<small>cm</small></span>`;

/** A row of numbers in a bordered strip: [label, value html, label icon?]. */
export function factsHtml(items: [string, string, IconName?][]): string {
  return `<dl class="facts">${items
    .map(([dt, dd, ic]) => `<div><dt>${ic ? icon(ic, 14) : ''}${dt}</dt><dd${dd === '–' ? ' class="none"' : ''}>${dd}</dd></div>`)
    .join('')}</dl>`;
}

export const metaHtml = (items: [IconName, string][]) =>
  `<div class="place-meta">${items.map(([ic, text]) => `<span>${icon(ic, 16)}${text}</span>`).join('')}</div>`;


/** A grey card with an icon, a bold line and a smaller one (snow along a route). */
export const noteCardHtml = (ic: IconName, strong: string, small = '') =>
  `<div class="note-card">${icon(ic, 18)}<div><strong>${strong}</strong>${small ? `<span>${small}</span>` : ''}</div></div>`;

/** An amber line for something to know before trusting a place (closed, outdated). */
export const bannerHtml = (html: string) => `<p class="banner">${icon('warning-fill', 18)}<span>${html}</span></p>`;
