// The terrain's look: hillshade, elevation tint, the cut at the data edge and the height exaggeration.
import { $ } from '../app/dom.ts';
import { isOn } from '../app/switches.ts';
import { type EdgeStyle, setEdgeStyle } from '../island.ts';
import { DEFAULT_EXAGGERATION, DEM_SOURCES, MAPTERHORN_TILES } from '../map.ts';
import type { App, LayerModule } from './types.ts';

let app: App;
let exaggeration = DEFAULT_EXAGGERATION;
let ready = false;
/** The look the map was created with, before the style loaded. */
let createdEdge: EdgeStyle;

/** Outside the data area: cut as an island, or faded under a veil (island.ts). */
export const edgeStyle = (): EdgeStyle => (isOn('island') ? 'island' : 'faded');
export const terrainExaggeration = () => exaggeration;

const setLayer = (id: string, on: boolean) => app.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');

export const terrain: LayerModule = {
  keys: ['hillshade', 'relief', 'island'],

  setup(a) {
    app = a;
    createdEdge = edgeStyle();
    exaggeration = app.initial.exaggeration ?? DEFAULT_EXAGGERATION;
    const input = $<HTMLInputElement>('exaggeration');
    const show = () => {
      input.value = String(exaggeration);
      $('exaggeration-value').textContent = `${exaggeration.toFixed(1)}×`;
    };
    show();
    input.addEventListener('input', () => {
      exaggeration = Number(input.value);
      show();
      app.map.setTerrain({ source: 'terrain', exaggeration });
    });
    input.addEventListener('change', () => app.syncHash());
  },

  init() {
    ready = true;
    // A shared link may switch off layers that the style draws by default.
    if (exaggeration !== DEFAULT_EXAGGERATION) app.map.setTerrain({ source: 'terrain', exaggeration });
    for (const key of ['hillshade', 'relief'] as const) if (!isOn(key)) setLayer(key, false);
    if (edgeStyle() !== createdEdge) setEdgeStyle(app.map, edgeStyle(), DEM_SOURCES, MAPTERHORN_TILES);
  },

  setVisible(key, on) {
    if (!ready) return;
    if (key === 'island') setEdgeStyle(app.map, edgeStyle(), DEM_SOURCES, MAPTERHORN_TILES);
    else setLayer(key, on);
  },

  view: () => ({ exaggeration }),
};
