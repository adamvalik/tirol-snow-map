// Roads, rivers, towns, buildings and labels from the OSM basemap, switched as two groups.
import { isOn } from '../app/switches.ts';
import type { App, LayerModule } from './types.ts';

let app: App;
let ready = false;

function setGroup(key: 'basemap' | 'labels', on: boolean) {
  const b = app.basemap;
  const ids = (key === 'labels' ? b.labels : [...b.fills, ...b.lines, b.buildings]).map((l) => l.id);
  for (const id of ids) if (app.map.getLayer(id)) app.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

export const osm: LayerModule = {
  keys: ['basemap', 'labels'],

  setup(a) {
    app = a;
  },

  init() {
    ready = true;
    // A shared link may switch off layers that the style draws by default.
    for (const key of ['basemap', 'labels'] as const) if (!isOn(key)) setGroup(key, false);
  },

  setVisible(key, on) {
    if (ready) setGroup(key as 'basemap' | 'labels', on);
  },
};
