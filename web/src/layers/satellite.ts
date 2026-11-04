// The Sentinel-2 true colour picture.
import type { SatelliteFile } from '../../../shared/types.ts';
import { $ } from '../app/dom.ts';
import { isOn, setAvailable, toggle } from '../app/switches.ts';
import { addSatelliteLayer, loadSatellite, SATELLITE_LAYER, shortDate } from '../satellite.ts';
import { applyLight } from './sun.ts';
import type { App, LayerModule } from './types.ts';

let app: App;
let file: SatelliteFile | null = null;
let loading: Promise<SatelliteFile | null>;
let added = false;

/** The satellite metadata, once loaded (for "About the data"). */
export const satelliteFile = () => file;

export const satellite: LayerModule = {
  keys: ['satellite'],

  setup(a) {
    app = a;
    loading = loadSatellite().then(
      (f) => {
        file = f;
        if (f.available && f.date) $('satellite-date').textContent = shortDate(f.date);
        return f;
      },
      () => null,
    );
  },

  async init() {
    // The picture replaces the drawn land colours but keeps hillshade, roads and labels on top.
    const sat = await loading;
    if (sat && addSatelliteLayer(app.map, sat, 'hillshade', isOn('satellite'))) {
      added = true;
      // The photo already has real light and shade, so the drawn hillshade is toned down over it.
      applyLight();
    } else {
      toggle('satellite').checked = false;
      setAvailable('satellite', false, 'No satellite picture in the current data');
    }
  },

  setVisible(_key, on) {
    if (!added) return;
    app.map.setLayoutProperty(SATELLITE_LAYER, 'visibility', on ? 'visible' : 'none');
    applyLight();
  },
};
