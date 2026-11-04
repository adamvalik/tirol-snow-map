import { isLowPowerDevice } from '../map.ts';
import { $ } from './dom.ts';

/** The layer card's fold button and the dock's height, which the map's corner controls sit above. */
export function setupLayout() {
  const layersPanel = $('layers');
  const layersToggle = $('layers-toggle');
  const setLayersCollapsed = (collapsed: boolean) => {
    layersPanel.classList.toggle('collapsed', collapsed);
    layersToggle.setAttribute('aria-expanded', String(!collapsed));
  };
  // On phones the layer sheet starts collapsed so the map gets the screen.
  setLayersCollapsed(isLowPowerDevice() && window.innerWidth <= 700);
  layersToggle.addEventListener('click', () => setLayersCollapsed(!layersPanel.classList.contains('collapsed')));

  // The map's corner controls sit above the timeline dock, whose height changes with its rows.
  const dock = $('dock');
  new ResizeObserver(() => document.body.style.setProperty('--dock-h', `${dock.offsetHeight}px`)).observe(dock);
}
