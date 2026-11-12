// Via ferratas, drawn by grade; the data is fetched the first time the layer is switched on.
import * as maplibregl from 'maplibre-gl';
import { $ } from '../app/dom.ts';
import { isOn } from '../app/switches.ts';
import { setWarning } from '../app/warnings.ts';
import {
  addFerrataLayer,
  FERRATA_LAYER_IDS,
  ferrataFootHtml,
  ferrataHtml,
  ferrataLines,
  type FerrataLayer,
  ferrataSub,
  GRADE_CLASSES,
  highestPoint,
} from '../ferratas.ts';
import { resample } from '../../../shared/geo.ts';
import { routeSnowSummary } from './snow.ts';
import type { LayerModule } from './types.ts';

let layer: FerrataLayer | null = null;
let count: number | null = null;

/** The number of routes, once loaded (for "About the data"). */
export const ferrataCount = () => count;

function show(on: boolean) {
  layer!.setVisible(on).then(
    (n) => {
      if (n !== null) {
        count = n;
        $('ferrata-count').textContent = String(n);
      }
      setWarning('ferratas', null);
    },
    (e: unknown) => {
      console.warn('Via ferratas:', e);
      setWarning('ferratas', 'Via ferratas could not be loaded.');
    },
  );
}

export const ferratas: LayerModule = {
  keys: ['ferratas'],
  legends: { 'ferrata-legend': ['ferratas'] },
  clickLayers: FERRATA_LAYER_IDS,

  setup(app) {
    $('ferrata-keys').innerHTML =
      GRADE_CLASSES.map((c) => `<span class="ferrata-key"><i style="background:${c.color}"></i>${c.label}</span>`).join('') +
      '<span class="ferrata-key"><i class="ungraded"></i>ungraded</span>';
    app.point.extend({ close: () => layer?.select(null) });
  },

  /** Above roads and buildings, below the place labels, bivouacs and station dots. */
  init(app) {
    layer = addFerrataLayer(
      app.map,
      (f) => {
        const [lon, lat, ele] = highestPoint(f);
        // Evenly spaced points, so each share is a share of the route's length.
        const points = ferrataLines(f).flatMap((l) => resample(l, 25));
        app.point.show(new maplibregl.LngLat(lon, lat), {
          head: { title: f.properties.name ?? 'Via ferrata', sub: ferrataSub(f.properties), icon: 'ladder-simple', tone: 'orange' },
          html: ferrataHtml(f.properties),
          elevation: ele,
          snowHtml: routeSnowSummary(points),
          forecastLabel: 'Forecast at the highest point',
          footHtml: ferrataFootHtml(f.properties),
        });
        layer!.select(f.properties.id);
      },
      app.basemap.labels[0]?.id,
    );
    if (isOn('ferratas')) show(true);
  },

  setVisible(_key, on) {
    if (layer) show(on);
  },
};
