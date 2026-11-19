// The C2 layout: the panel's tabs (Layers, Place, About), the bottom sheet on phones (hidden, lowered
// or raised), the round layer buttons of the lowered sheet, and the map buttons (zoom, north).
import type * as maplibregl from 'maplibre-gl';
import { LAYER_KEYS, type LayerKey } from '../viewState.ts';
import { $ } from './dom.ts';

export type Tab = 'layers' | 'place' | 'about';
const TABS: Tab[] = ['layers', 'place', 'about'];

const panel = () => $('panel');
const tabListeners = new Map<Tab, (() => void)[]>();

/** Phones: below this width the panel is a bottom sheet and the timeline sits in it. */
export const phoneQuery = matchMedia('(max-width: 700px)');
export const isPhone = () => phoneQuery.matches;

export const currentTab = (): Tab => (panel().dataset.tab as Tab | undefined) ?? 'layers';

/** Shows a tab; on a phone it also raises the sheet so the tab can be seen. */
export function showTab(tab: Tab, raise = true) {
  panel().dataset.tab = tab;
  for (const t of TABS) {
    $(`tab-btn-${t}`).setAttribute('aria-selected', String(t === tab));
    $(`tab-${t}`).hidden = t !== tab;
  }
  if (raise) setSheet('open');
  for (const l of tabListeners.get(tab) ?? []) l();
}

/** Called each time a tab is shown (About renders itself then, so its view link is current). */
export function onTab(tab: Tab, listener: () => void) {
  tabListeners.set(tab, [...(tabListeners.get(tab) ?? []), listener]);
}

/** The phone sheet: only the timeline (hidden), the timeline and main layers (peek), or the tabs (open). */
export type SheetState = 'hidden' | 'peek' | 'open';
const SHEET_STATES: SheetState[] = ['hidden', 'peek', 'open'];
const HANDLE_LABEL: Record<SheetState, string> = { hidden: 'Show the panel', peek: 'Open the panel', open: 'Lower the panel' };

export const sheetState = (): SheetState => (panel().dataset.sheet as SheetState | undefined) ?? 'peek';
export const sheetOpen = () => sheetState() === 'open';

/** Sets the phone sheet's position. No effect on the desktop sidebar beyond the attribute. */
export function setSheet(state: SheetState) {
  stopSheetAnimation();
  panel().dataset.sheet = state;
  const handle = $('sheet-handle');
  handle.setAttribute('aria-label', HANDLE_LABEL[state]);
  handle.setAttribute('aria-expanded', String(state === 'open'));
  document.querySelector('[data-open-layers]')?.setAttribute('aria-expanded', String(state === 'open'));
}

/** The round buttons of the lowered sheet show the state of the layer switches they stand for. */
export function syncQuick() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.quick-btn[data-key]')) {
    const input = $<HTMLInputElement>(`toggle-${b.dataset.key}`);
    b.setAttribute('aria-pressed', String(input.checked));
    b.disabled = input.disabled;
  }
}

/**
 * Keeps the timeline in the sheet on phones and floating over the map on wider screens; the legends
 * scroll with the Layers tab on phones and float over the map's top-left corner on wider screens.
 */
function placeTimeline() {
  const timeline = $('timeline');
  const target = isPhone() ? $('sheet-time') : document.body;
  if (timeline.parentElement !== target) target.append(timeline);
  const legends = document.querySelector<HTMLElement>('.legends')!;
  if (isPhone()) $('tab-layers').append(legends);
  else if (legends.parentElement !== document.body) document.body.append(legends);
}

/** Whether two boxes on the screen overlap. */
export const overlaps = (a: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, b: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * On wider screens the legend card floats over the map, and the map is a layer of its own on the
 * page, so a popup (a lift's or a station's tooltip) cannot be drawn above the card. The card fades
 * out while a popup would lie under it. Checked once a frame after the layers have moved their popups.
 */
function keepPopupsClear(map: maplibregl.Map) {
  const legends = document.querySelector<HTMLElement>('.legends')!;
  let frame = 0;
  const check = () => {
    frame = 0;
    const card = legends.getBoundingClientRect();
    const covered =
      !isPhone() && [...map.getContainer().querySelectorAll('.maplibregl-popup')].some((p) => overlaps(p.getBoundingClientRect(), card));
    legends.classList.toggle('behind-popup', covered);
  };
  const soon = () => (frame ||= requestAnimationFrame(check));
  for (const type of ['mousemove', 'mouseout', 'move', 'click'] as const) map.on(type, soon);
}

// --- Dragging the sheet ------------------------------------------------------------------
// While the finger moves, the sheet takes the height under it: above the lowered height it shows the
// tabs, below it the lowered sheet is cut off at the bottom. On release it settles to the nearest of the
// three positions, or after a flick to the next one in the flick's direction.

let animation = 0;
function stopSheetAnimation() {
  cancelAnimationFrame(animation);
  animation = 0;
  clearDragStyle();
}

function clearDragStyle() {
  const s = panel().style;
  s.height = s.minHeight = s.overflow = s.transition = '';
}

/** The sheet's height in each position, measured by showing each in turn (inside one frame, not painted). */
function sheetHeights(): Record<SheetState, number> {
  const p = panel();
  const was = p.dataset.sheet;
  clearDragStyle();
  const h = {} as Record<SheetState, number>;
  for (const st of SHEET_STATES) {
    p.dataset.sheet = st;
    h[st] = p.getBoundingClientRect().height;
  }
  p.dataset.sheet = was;
  return h;
}

/** Shows the sheet at a height between the hidden and the open one. */
function drawSheet(h: number, heights: Record<SheetState, number>) {
  const p = panel();
  p.dataset.sheet = h > heights.peek + 0.5 ? 'open' : 'peek';
  p.style.height = `${h}px`;
  p.style.minHeight = '0';
  p.style.overflow = 'hidden';
  p.style.transition = 'none';
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Moves the sheet from the height it has now to a position, then leaves it to the stylesheet. */
function settleSheet(to: SheetState, from?: number) {
  const heights = sheetHeights();
  const start = from ?? heights[sheetState()];
  const end = heights[to];
  const ms = reducedMotion.matches ? 0 : Math.min(320, 140 + Math.abs(end - start) * 0.4);
  const t0 = performance.now();
  cancelAnimationFrame(animation);
  const step = (now: number) => {
    const k = ms ? Math.min(1, (now - t0) / ms) : 1;
    if (k >= 1) return setSheet(to);
    const ease = 1 - (1 - k) ** 3;
    drawSheet(start + (end - start) * ease, heights);
    animation = requestAnimationFrame(step);
  };
  animation = requestAnimationFrame(step);
}

/** Speed in px/ms above which a release counts as a flick. */
const FLICK = 0.4;

/** A tap on the handle: lowered and open switch, hidden comes back lowered. */
const toggled = (): SheetState => (sheetState() === 'peek' ? 'open' : 'peek');

/** A drag on the sheet's handle moves the sheet with the finger; a tap toggles it. */
function setupHandle() {
  const handle = $('sheet-handle');
  let drag: { id: number; y0: number; h0: number; heights: Record<SheetState, number>; moved: boolean; samples: { y: number; t: number }[] } | null = null;
  let h = 0;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const wasMoving = animation !== 0;
    cancelAnimationFrame(animation);
    animation = 0;
    // Caught mid-way: it stays where it is under the finger.
    const h0 = panel().getBoundingClientRect().height;
    drag = { id: e.pointerId, y0: e.clientY, h0, heights: sheetHeights(), moved: false, samples: [{ y: e.clientY, t: e.timeStamp }] };
    if (wasMoving) drawSheet(h0, drag.heights);
    h = h0;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true;
    const { hidden, open } = drag.heights;
    h = Math.min(open, Math.max(hidden, drag.h0 - dy));
    drawSheet(h, drag.heights);
    drag.samples.push({ y: e.clientY, t: e.timeStamp });
    if (drag.samples.length > 20) drag.samples.shift();
  });
  handle.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return settleSheet(toggled());
    // Upward speed in px/ms over the last 100 ms of moves (a finger that stopped before lifting has none).
    // A flick goes to the next position its way; a slow drag to the nearest one.
    const last = d.samples[d.samples.length - 1];
    const first = d.samples.find((m) => m.t >= last.t - 100) ?? last;
    const v = e.timeStamp - last.t < 80 && last.t > first.t ? (first.y - last.y) / (last.t - first.t) : 0;
    const by = (st: SheetState) => d.heights[st];
    let to: SheetState;
    if (v > FLICK) to = SHEET_STATES.find((st) => by(st) > h + 1) ?? 'open';
    else if (v < -FLICK) to = [...SHEET_STATES].reverse().find((st) => by(st) < h - 1) ?? 'hidden';
    else to = SHEET_STATES.reduce((a, st) => (Math.abs(by(st) - h) < Math.abs(by(a) - h) ? st : a));
    settleSheet(to, h);
  });
  handle.addEventListener('pointercancel', () => {
    if (drag?.moved) settleSheet(sheetState() === 'open' ? 'open' : 'peek', h);
    drag = null;
  });
  // Keyboard: Enter and Space arrive as a click with no pointer events before it.
  handle.addEventListener('click', (e) => {
    if (e.detail === 0) settleSheet(toggled());
  });
  // Arrow keys move the sheet one position up or down.
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const i = SHEET_STATES.indexOf(sheetState()) + (e.key === 'ArrowUp' ? 1 : -1);
    if (i >= 0 && i < SHEET_STATES.length) settleSheet(SHEET_STATES[i]);
  });
}

/** Zoom and north buttons; the needle turns with the map. */
function setupMapButtons(map: maplibregl.Map) {
  $('zoom-in').addEventListener('click', () => map.zoomIn());
  $('zoom-out').addEventListener('click', () => map.zoomOut());
  $('north-btn').addEventListener('click', () => map.easeTo({ bearing: 0, pitch: Math.min(map.getPitch(), 60), duration: 600 }));
  const needle = () => document.body.style.setProperty('--bearing', `${map.getBearing()}deg`);
  map.on('rotate', needle);
  needle();
}

export function setupLayout(map: maplibregl.Map) {
  for (const t of TABS) $(`tab-btn-${t}`).addEventListener('click', () => showTab(t));
  // Arrow keys move between tabs, as for any tab list.
  document.querySelector('.tabs')!.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight') return;
    const i = TABS.indexOf(currentTab()) + (k === 'ArrowRight' ? 1 : -1);
    const t = TABS[(i + TABS.length) % TABS.length];
    showTab(t);
    $(`tab-btn-${t}`).focus();
  });
  showTab('layers', false);
  setSheet('peek');
  setupHandle();

  for (const b of document.querySelectorAll<HTMLElement>('[data-open-about]')) b.addEventListener('click', () => showTab('about'));
  document.querySelector('[data-open-layers]')?.addEventListener('click', () => {
    if (sheetOpen() && currentTab() === 'layers') setSheet('peek');
    else showTab('layers');
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('.quick-btn[data-key]')) {
    b.addEventListener('click', () => {
      const key = b.dataset.key as LayerKey;
      if (LAYER_KEYS.includes(key)) $<HTMLInputElement>(`toggle-${key}`).click();
    });
  }
  $('panel').addEventListener('change', syncQuick);
  syncQuick();

  placeTimeline();
  phoneQuery.addEventListener('change', placeTimeline);
  setupMapButtons(map);
  keepPopupsClear(map);

  // The map chip, the toast and the scale sit above the timeline, whose height changes with its rows.
  const timeline = $('timeline');
  new ResizeObserver(() => document.body.style.setProperty('--timeline-h', `${timeline.offsetHeight}px`)).observe(timeline);
}
