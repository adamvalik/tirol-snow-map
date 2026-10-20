// Summit and town labels as DOM markers. Symbol layers would need a glyph server,
// which the "browser calls only Mapterhorn and Open-Meteo" rule excludes.

import * as maplibregl from 'maplibre-gl';
import summitsData from './data/summits.json';

interface Label {
  name: string;
  lon: number;
  lat: number;
  ele?: number;
  kind: 'summit' | 'town';
  /** Higher wins when labels overlap. */
  priority: number;
}

const TOWNS: [string, number, number][] = [
  ['Bolzano / Bozen', 11.3548, 46.4983],
  ['Merano / Meran', 11.1594, 46.6713],
  ['Bressanone / Brixen', 11.6567, 46.7157],
  ['Brunico / Bruneck', 11.9387, 46.7962],
  ['Vipiteno / Sterzing', 11.4318, 46.8966],
  ['Silandro / Schlanders', 10.7744, 46.6283],
  ['San Candido / Innichen', 12.2806, 46.7327],
  ['Cortina d’Ampezzo', 12.1357, 46.5405],
  ['Trento', 11.1211, 46.0679],
  ['Innsbruck', 11.4041, 47.2692],
];

const LABELS: Label[] = [
  ...TOWNS.map(([name, lon, lat]) => ({ name, lon, lat, kind: 'town' as const, priority: 10_000 })),
  ...summitsData.summits.map((s) => ({ name: s.name, lon: s.lon, lat: s.lat, ele: s.ele, kind: 'summit' as const, priority: s.ele })),
];

export const LABELS_ATTRIBUTION = summitsData.attribution;

export class MapLabels {
  private markers: { label: Label; marker: maplibregl.Marker; el: HTMLElement }[] = [];
  private visible = true;
  private frame = 0;

  constructor(private map: maplibregl.Map) {
    for (const label of [...LABELS].sort((a, b) => b.priority - a.priority)) {
      const el = document.createElement('div');
      el.className = `map-label ${label.kind}`;
      el.textContent = label.name;
      if (label.ele) {
        const ele = document.createElement('div');
        ele.className = 'ele';
        ele.textContent = `${label.ele.toLocaleString('en-GB')} m`;
        el.append(ele);
      }
      const marker = new maplibregl.Marker({
        element: el,
        anchor: label.kind === 'summit' ? 'bottom' : 'center',
        // Fade labels hidden behind ridges instead of drawing them through the mountain.
        opacityWhenCovered: '0',
      })
        .setLngLat([label.lon, label.lat])
        .addTo(map);
      this.markers.push({ label, marker, el });
    }
    map.on('moveend', () => this.schedule());
    map.on('resize', () => this.schedule());
    map.once('idle', () => this.schedule());
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    for (const m of this.markers) m.el.style.display = visible ? '' : 'none';
    if (visible) this.schedule();
  }

  private schedule() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.declutter());
  }

  /** Greedy screen-space declutter: higher-priority labels claim their box first. */
  private declutter() {
    if (!this.visible) return;
    const zoom = this.map.getZoom();
    const taken: DOMRect[] = [];
    const pad = 4;
    for (const { label, el } of this.markers) {
      const minZoom = label.kind === 'town' ? 8 : label.priority >= 3300 ? 8.5 : 9.5;
      el.classList.remove('hidden');
      if (zoom < minZoom) {
        el.classList.add('hidden');
        continue;
      }
      const r = el.getBoundingClientRect();
      const overlaps = taken.some(
        (t) => r.left < t.right + pad && r.right > t.left - pad && r.top < t.bottom + pad && r.bottom > t.top - pad,
      );
      if (overlaps || r.width === 0) el.classList.add('hidden');
      else taken.push(r);
    }
  }
}
