// Winter sports: lifts, slopes, cross-country trails, toboggan runs and ski touring routes. The data
// is fetched the first time the layer is switched on; the switches in its group hide and show each
// kind, and the Slopes row carries the slope colours.
import * as maplibregl from 'maplibre-gl';
import { $ } from '../app/dom.ts';
import { isOn } from '../app/switches.ts';
import { setWarning } from '../app/warnings.ts';
import {
  addWinterLayer,
  DIFFICULTY_CLASSES,
  highestPoint,
  LIFT_COLOR,
  NORDIC_COLOR,
  SKITOUR_COLOR,
  SLED_COLOR,
  WINTER_KINDS,
  WINTER_LAYER_IDS,
  winterFootHtml,
  winterHtml,
  winterIcon,
  winterLines,
  type WinterFeature,
  type WinterKind,
  type WinterLayer,
  winterSub,
  winterTitle,
} from '../winter.ts';
import { resample } from '../../../shared/geo.ts';
import { routeSnowSummary } from './snow.ts';
import type { LayerModule } from './types.ts';

let layer: WinterLayer | null = null;
let counts: Record<WinterKind, number> | null = null;
const shownKinds = new Set<WinterKind>(WINTER_KINDS);

/** How many of each kind are drawn, once loaded (for "About the data"). */
export const winterCounts = () => counts;

const line = (color: string, cls = '') => `<i${cls ? ` class="${cls}"` : ''} style="${cls === 'dotted' ? 'color' : 'background'}:${color}"></i>`;

/** Slope colours under the Slopes row: Nursery, Blue, Red, Black, Freeride (expert is drawn as black). */
const slopeKeys = () =>
  DIFFICULTY_CLASSES.filter((c) => c.key !== 'expert')
    .map((c) => `<span class="ferrata-key"><i style="background:${c.color}"></i>${c.label}</span>`)
    .join('');

const KINDS: { kind: WinterKind; label: string; swatch: string; keys?: string }[] = [
  { kind: 'lift', label: 'Lifts', swatch: line(LIFT_COLOR) },
  { kind: 'downhill', label: 'Slopes', swatch: `<i style="background:linear-gradient(90deg, ${DIFFICULTY_CLASSES[1].color} 0 33%, ${DIFFICULTY_CLASSES[2].color} 33% 67%, ${DIFFICULTY_CLASSES[3].color} 67%)"></i>`, keys: slopeKeys() },
  { kind: 'nordic', label: 'Cross-country', swatch: line(NORDIC_COLOR) },
  { kind: 'sled', label: 'Toboggan', swatch: line(SLED_COLOR) },
  { kind: 'skitour', label: 'Ski touring', swatch: line(SKITOUR_COLOR, 'dotted') },
];

/** What a feature's snow card calls it: "About 40 % of the slope in snow". */
const SNOW_WHAT: Record<WinterKind, string> = { lift: 'lift line', downhill: 'slope', nordic: 'trail', sled: 'run', skitour: 'route' };

function show(on: boolean) {
  layer!.setVisible(on).then(
    (features) => {
      if (features) {
        counts = Object.fromEntries(WINTER_KINDS.map((k) => [k, features.filter((f) => f.properties.kind === k).length])) as Record<WinterKind, number>;
      }
      setWarning('winter', null);
    },
    (e: unknown) => {
      console.warn('Winter sports:', e);
      setWarning('winter', 'Winter sports could not be loaded.');
    },
  );
}

export const winter: LayerModule = {
  keys: ['winter'],
  clickLayers: WINTER_LAYER_IDS,

  setup(app) {
    const box = $('winter-kinds');
    box.innerHTML = KINDS.map(
      (k) =>
        `<label class="row"><span class="winter-swatch" aria-hidden="true">${k.swatch}</span><span class="row-label">${k.label}${
          k.keys ? `<span class="winter-slope-keys">${k.keys}</span>` : ''
        }</span><input type="checkbox" class="switch" data-kind="${k.kind}" checked /></label>`,
    ).join('');
    box.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const kind = input.dataset.kind as WinterKind | undefined;
      if (!kind) return;
      if (input.checked) shownKinds.add(kind);
      else shownKinds.delete(kind);
      layer?.setKinds([...shownKinds]);
    });
    app.point.extend({ close: () => layer?.select(null) });
  },

  /** Above roads and buildings, below the via ferratas, place labels, bivouacs and station dots. */
  init(app) {
    layer = addWinterLayer(
      app.map,
      (f: WinterFeature) => {
        const p = f.properties;
        const [lon, lat, ele] = highestPoint(f);
        // Evenly spaced points, so each share is a share of the length. The file has no elevations
        // along the lines, so the snow card's lowest snow comes from the terrain the map has loaded
        // (left out where it has none, such as a part far out of view).
        const exaggeration = app.map.getTerrain()?.exaggeration ?? 1;
        const points = winterLines(f)
          .flatMap((l) => resample(l, 25))
          .map(([lon, lat]) => {
            const ground = app.map.queryTerrainElevation([lon, lat]);
            return ground === null ? [lon, lat] : [lon, lat, ground / exaggeration];
          });
        app.point.show(new maplibregl.LngLat(lon, lat), {
          head: { title: winterTitle(p), sub: winterSub(p), icon: winterIcon(p), tone: 'blue' },
          html: winterHtml(p),
          elevation: ele,
          snowHtml: routeSnowSummary(points, SNOW_WHAT[p.kind]),
          forecastLabel: p.kind === 'lift' ? 'Forecast at the top station' : 'Forecast at the highest point',
          footHtml: winterFootHtml(p),
        });
        layer!.select(p.id);
      },
      app.basemap.labels[0]?.id,
    );
    if (isOn('winter')) show(true);
  },

  setVisible(_key, on) {
    if (layer) show(on);
  },
};
