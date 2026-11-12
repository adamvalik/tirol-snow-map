// The C2 layout: the panel's tabs (Layers, Place, About), the bottom sheet on phones (lowered or
// raised), the round layer buttons of the lowered sheet, and the map buttons (zoom, north).
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
  if (raise) setSheet(true);
  for (const l of tabListeners.get(tab) ?? []) l();
}

/** Called each time a tab is shown (About renders itself then, so its view link is current). */
export function onTab(tab: Tab, listener: () => void) {
  tabListeners.set(tab, [...(tabListeners.get(tab) ?? []), listener]);
}

export const sheetOpen = () => panel().dataset.sheet === 'open';

/** Raises (true) or lowers the phone sheet. No effect on the desktop sidebar beyond the attribute. */
export function setSheet(open: boolean) {
  panel().dataset.sheet = open ? 'open' : 'peek';
  const handle = $('sheet-handle');
  handle.setAttribute('aria-label', open ? 'Lower the panel' : 'Open the panel');
  handle.setAttribute('aria-expanded', String(open));
  document.querySelector('[data-open-layers]')?.setAttribute('aria-expanded', String(open));
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
 * scroll with the Layers tab on phones and stay above the footer on wider screens.
 */
function placeTimeline() {
  const timeline = $('timeline');
  const target = isPhone() ? $('sheet-time') : document.body;
  if (timeline.parentElement !== target) target.append(timeline);
  const legends = document.querySelector<HTMLElement>('.legends')!;
  if (isPhone()) $('tab-layers').append(legends);
  else document.querySelector('.footer')!.before(legends);
}

/** A drag on the sheet's handle raises or lowers it; a tap toggles it. */
function setupHandle() {
  const handle = $('sheet-handle');
  let startY: number | null = null;
  let moved = false;
  handle.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    moved = false;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) < 24) return;
    moved = true;
    setSheet(dy < 0);
    startY = null;
  });
  const end = () => {
    if (startY !== null && !moved) setSheet(!sheetOpen());
    startY = null;
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', () => (startY = null));
  // Keyboard: Enter and Space arrive as a click with no pointer events before it.
  handle.addEventListener('click', (e) => {
    if (e.detail === 0) setSheet(!sheetOpen());
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
  setSheet(false);
  setupHandle();

  for (const b of document.querySelectorAll<HTMLElement>('[data-open-about]')) b.addEventListener('click', () => showTab('about'));
  document.querySelector('[data-open-layers]')?.addEventListener('click', () => {
    if (sheetOpen() && currentTab() === 'layers') setSheet(false);
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

  // The map chip, the toast and the scale sit above the timeline, whose height changes with its rows.
  const timeline = $('timeline');
  new ResizeObserver(() => document.body.style.setProperty('--timeline-h', `${timeline.offsetHeight}px`)).observe(timeline);
}
