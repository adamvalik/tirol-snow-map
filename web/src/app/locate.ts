// "Where am I": MapLibre's GeolocateControl (blue dot and accuracy circle; MapLibre has no heading arrow), driven by
// the round #locate-btn under the map buttons; the control's own button is hidden (style.css).
//
// The browser asks for permission only when the button is tapped. The position stays on the
// device: it is not in share links, analytics or any request this app makes.
//
// Button states follow the control: off; waiting (asked, no fix yet); on (the map follows); and
// background (the dot still moves, the map was panned away; a tap brings it back).
import * as maplibregl from 'maplibre-gl';
import { inArea } from '../island.ts';
import { $ } from './dom.ts';
import { icon } from './icons.ts';
import { toast } from './toast.ts';

type State = 'off' | 'waiting' | 'on' | 'background';

export function setupLocate(map: maplibregl.Map) {
  const btn = $('locate-btn') as HTMLButtonElement;
  if (!('geolocation' in navigator)) {
    btn.hidden = true;
    return;
  }
  const geo = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true, timeout: 20_000 },
    trackUserLocation: true,
    // Close enough to see the slope, not so close that the 3D terrain loses its context.
    fitBoundsOptions: { maxZoom: 14 },
  });
  map.addControl(geo, 'top-right');

  let state: State = 'off';
  let warnedOutside = false;
  const set = (s: State) => {
    state = s;
    btn.dataset.state = s;
    btn.setAttribute('aria-pressed', String(s !== 'off'));
    const label = s === 'off' ? 'Show where I am' : s === 'background' ? 'Back to where I am' : 'Stop showing where I am';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = icon(s === 'off' ? 'gps' : 'gps-fix', 20);
  };

  const outside = 'You are outside the map area. The snow data covers South Tyrol and around it.';
  btn.addEventListener('click', () => {
    if (state === 'off') warnedOutside = false;
    geo.trigger();
  });
  geo.on('trackuserlocationstart', () => set(state === 'background' ? 'on' : 'waiting'));
  // "end" comes both when it is switched off and when the map is panned away; "lost focus" follows in the second case.
  geo.on('trackuserlocationend', () => set('off'));
  geo.on('userlocationlostfocus', () => set('background'));
  geo.on('geolocate', (e) => {
    if (state === 'waiting') set('on');
    if (!warnedOutside && !inArea(e.coords.longitude, e.coords.latitude)) {
      warnedOutside = true;
      toast(outside, { icon: icon('warning', 18), tone: 'warn' });
    }
  });
  // Farther than the map can pan: the control cannot show the dot, so say why and switch it off.
  geo.on('outofmaxbounds', () => {
    toast(`${outside} The map cannot go that far.`, { icon: icon('warning', 18), tone: 'warn' });
    if (state !== 'off') geo.trigger();
    set('off');
  });
  geo.on('error', (e) => {
    set('off');
    const text =
      e.code === 1 // PERMISSION_DENIED
        ? 'Location is blocked for this site. Allow it in the browser settings to see where you are.'
        : 'Your location could not be found. Try again outside or with GPS on.';
    toast(text, { icon: icon('warning', 18), tone: 'warn' });
  });
  set('off');
}
