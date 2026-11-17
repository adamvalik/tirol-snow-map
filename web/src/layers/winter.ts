// Winter sports: lifts, slopes, cross-country trails, toboggan runs and ski touring routes. The data
// is fetched the first time the layer is switched on; the legend's chips hide and show each kind.
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
  UNKNOWN_SLOPE_COLOR,
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

const CHIPS: { kind: WinterKind; label: string; swatch: string }[] = [
  { kind: 'lift', label: 'Lifts', swatch: `<i style="background:${LIFT_COLOR}"></i>` },
  { kind: 'downhill', label: 'Slopes', swatch: DIFFICULTY_CLASSES.filter((c) => c.key !== 'expert' && c.key !== 'novice').map((c) => `<i class="dot" style="background:${c.color}"></i>`).join('') },
  { kind: 'nordic', label: 'Cross-country', swatch: `<i style="background:${NORDIC_COLOR}"></i>` },
  { kind: 'sled', label: 'Toboggan', swatch: `<i style="background:${SLED_COLOR}"></i>` },
  { kind: 'skitour', label: 'Ski touring', swatch: `<i class="dotted" style="color:${SKITOUR_COLOR}"></i>` },
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
  legends: { 'winter-legend': ['winter'] },
  clickLayers: WINTER_LAYER_IDS,

  setup(app) {
    const keys = $('winter-keys');
    keys.innerHTML = CHIPS.map(
      (c) =>
        `<button type="button" class="winter-chip" data-kind="${c.kind}" aria-pressed="true"><span class="winter-swatch">${c.swatch}</span>${c.label}</button>`,
    ).join('');
    keys.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>('.winter-chip');
      if (!btn) return;
      const kind = btn.dataset.kind as WinterKind;
      if (shownKinds.has(kind)) shownKinds.delete(kind);
      else shownKinds.add(kind);
      btn.setAttribute('aria-pressed', String(shownKinds.has(kind)));
      layer?.setKinds([...shownKinds]);
    });
    $('winter-slope-keys').innerHTML =
      DIFFICULTY_CLASSES.filter((c) => c.key !== 'expert')
        .map((c) => `<span class="ferrata-key"><i style="background:${c.color}"></i>${c.label}</span>`)
        .join('') + `<span class="ferrata-key"><i style="background:${UNKNOWN_SLOPE_COLOR}"></i>not mapped</span>`;
    app.point.extend({ close: () => layer?.select(null) });
  },

  /** Above roads and buildings, below the via ferratas, place labels, bivouacs and station dots. */
  init(app) {
    layer = addWinterLayer(
      app.map,
      (f: WinterFeature) => {
        const p = f.properties;
        const [lon, lat, ele] = highestPoint(f);
        // Evenly spaced points, so each share is a share of the length.
        const points = winterLines(f).flatMap((l) => resample(l, 25));
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
