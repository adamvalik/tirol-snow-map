// The GPX track's controls, on top of layers/gpx.ts: "Add a GPX track" in the Layers tab (a file
// picked or dropped on the map), the reading state, the track's row, and its Place panel with the
// numbers, the elevation profile with the snow along it, and the forecast at its highest point.
import { GpxError } from '../gpx.ts';
import { escapeHtml, lengthText, metres } from '../format.ts';
import { flyToGpx, gpxSnow, gpxTrack, loadGpxFile, onGpxChange, onGpxSelect, onGpxSnow, removeGpx, type ShownTrack } from '../layers/gpx.ts';
import { shownSnow } from '../layers/snow.ts';
import { actionsHtml, closePanel, openPanel, panelOpen } from '../panel.ts';
import { routeSnowHtml, type PointSnow } from '../snow.ts';
import { track as count } from './analytics.ts';
import { $ } from './dom.ts';
import { icon } from './icons.ts';
import { isPhone } from './layout.ts';
import { toast } from './toast.ts';

const ACCEPT = '.gpx,application/gpx+xml';
/** Set while the track's panel is the one in the Place tab. */
let panelShown = false;
let reading: string | null = null;

const picker = Object.assign(document.createElement('input'), { type: 'file', accept: ACCEPT, hidden: true });
document.body.append(picker);

/** "5.2 km, 652 m up". */
const summary = (t: ShownTrack) => [lengthText(t.stats.distanceM), t.stats.ascentM === null ? '' : `${metres(t.stats.ascentM)} up`].filter(Boolean).join(', ');

/** Where the heights came from, under the track's name. */
function heightSource(t: ShownTrack): string {
  const what = t.track.kind === 'route' ? 'Planned route' : 'Recorded track';
  const parts = t.track.lines.length > 1 ? `, ${t.track.lines.length} segments, gaps not counted` : '';
  if (t.source === 'file') return `${what}${parts}, elevation from the file`;
  if (t.source === 'terrain') return `${what}${parts}, heights from the terrain model`;
  return `${what}${parts}, no heights available`;
}

// --- Layers tab ----------------------------------------------------------------------

function showControl() {
  const t = gpxTrack();
  const el = $('track');
  const quick = $<HTMLButtonElement>('quick-track');
  if (reading !== null) {
    el.innerHTML = `<div class="track-reading" role="status"><span class="track-icon" aria-hidden="true">${icon('spinner', 20)}</span>
      <span class="track-text"><strong>Reading ${escapeHtml(reading)}</strong><span>Measuring the track and the snow along it</span></span></div>`;
  } else if (t) {
    el.innerHTML = `<div class="track-row"><span class="track-icon" aria-hidden="true">${icon('route', 20)}</span>
      <button type="button" class="track-open" data-track-open><span class="track-text"><strong>${escapeHtml(t.title)}</strong><span>${summary(t)}</span></span></button>
      <button type="button" class="track-remove" data-track-remove aria-label="Remove track" title="Remove track">${icon('trash', 18)}</button></div>`;
  } else {
    const where = isPhone() ? 'Read on this phone, never uploaded' : 'Drop it on the map or choose a file';
    el.innerHTML = `<label class="track-add"><span class="track-icon" aria-hidden="true">${icon('route', 20)}</span>
      <span class="track-text"><strong>Add a GPX track</strong><span>${where}</span></span>
      <span class="track-choose">${isPhone() ? icon('upload', 18) : 'Choose'}</span>
      <input type="file" accept="${ACCEPT}" aria-label="Add a GPX track" data-track-input /></label>
      ${isPhone() ? '' : '<p class="track-note">Read in this browser. Not uploaded, not in links.</p>'}`;
  }
  quick.hidden = !t;
  if (t) {
    quick.innerHTML = `<span class="track-icon" aria-hidden="true">${icon('route', 20)}</span>
      <span class="track-text"><strong>${escapeHtml(t.title)}</strong><span>${summary(t)}</span></span>${icon('caret-down', 18)}`;
    quick.setAttribute('aria-label', `${t.title}: ${summary(t)}. Open the track`);
  }
}

async function load(file: File) {
  reading = file.name.replace(/\.gpx$/i, '');
  showControl();
  try {
    await loadGpxFile(file, (p) => {
      if (p.stage === 'parsed') {
        reading = p.title;
        showControl();
      }
    });
    count('gpx/add');
  } catch (e) {
    reading = null;
    showControl();
    const text = e instanceof GpxError ? e.message : 'This file could not be read.';
    if (!(e instanceof GpxError)) console.warn('GPX:', e);
    toast(text, { icon: icon('warning-fill', 18), tone: 'warn', action: { label: 'Other file', run: () => picker.click() } });
  }
}

// --- Place tab ---------------------------------------------------------------------------

/** The profile's line and the snow under it, drawn from the profile points. */
function profileHtml(t: ShownTrack, states: PointSnow[]): string {
  const pts = t.profile.points;
  const eles = pts.map((p) => p.ele).filter((e): e is number => e !== null);
  if (!eles.length || t.profile.distanceM <= 0) return '';
  const lo = Math.min(...eles);
  const hi = Math.max(...eles);
  const W = 320;
  const H = 74;
  const span = Math.max(hi - lo, 50);
  const x = (d: number) => ((d / t.profile.distanceM) * W).toFixed(1);
  const y = (e: number) => (6 + (1 - (e - lo) / span) * (H - 10)).toFixed(1);
  let line = '';
  let area = '';
  let seg = -1;
  let first = '';
  let last = '';
  for (const p of pts) {
    if (p.ele === null) continue;
    const xy = `${x(p.distM)} ${y(p.ele)}`;
    if (p.segment !== seg) {
      if (first) area += ` L${last.split(' ')[0]} ${H} L${first.split(' ')[0]} ${H} Z`;
      line += `M${xy}`;
      area += `M${xy}`;
      first = xy;
      seg = p.segment;
    } else {
      line += ` L${xy}`;
      area += ` L${xy}`;
    }
    last = xy;
  }
  area += ` L${last.split(' ')[0]} ${H} L${first.split(' ')[0]} ${H} Z`;
  // Runs of profile points in snow-covered cells, as bars under the line.
  const bars: string[] = [];
  let start: number | null = null;
  states.forEach((s, i) => {
    const d = pts[i]?.distM ?? 0;
    if (s === 'snow' && start === null) start = d;
    const end = s !== 'snow' || i === states.length - 1;
    if (start !== null && end) {
      const stop = s === 'snow' ? d : (pts[i - 1]?.distM ?? d);
      bars.push(`<rect x="${x(start)}" y="77" width="${Math.max(2, Number(x(stop)) - Number(x(start))).toFixed(1)}" height="5" rx="2.5" fill="#3182bd"/>`);
      start = null;
    }
  });
  const top = t.profile.highestAtM;
  const marker = top === null ? '' : `<line x1="${x(top)}" x2="${x(top)}" y1="${y(hi)}" y2="${H}" stroke="#7048e8" stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>`;
  const topText = top === null ? '' : `<span>highest ${metres(hi)} at ${lengthText(top)}</span>`;
  const snowKey = bars.length ? '<span class="profile-key"><i></i>Snow</span>' : '';
  return `<figure class="profile">
    <figcaption><span>Elevation, ${metres(lo)} to ${metres(hi)}</span>${snowKey}</figcaption>
    <svg viewBox="0 0 ${W} 84" preserveAspectRatio="none" role="img" aria-label="Elevation profile from ${metres(lo)} to ${metres(hi)} over ${lengthText(t.profile.distanceM)}${bars.length ? ', snow-covered stretches marked in blue' : ''}">
      <path d="${area}" fill="#f1edfd"/>
      <path d="${line}" fill="none" stroke="#7048e8" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      ${marker}${bars.join('')}
    </svg>
    <div class="profile-axis"><span>0 km</span>${topText}<span>${lengthText(t.profile.distanceM)}</span></div>
  </figure>`;
}

/** The parts of the panel that follow the day on the map: the profile's snow and the summary. */
function snowPartHtml(t: ShownTrack): string {
  const s = gpxSnow();
  const file = shownSnow();
  return profileHtml(t, s?.points ?? []) + (file && s ? routeSnowHtml(file, s.route, 'track') : '');
}

function panelHtml(t: ShownTrack): string {
  const { stats } = t;
  const climb =
    stats.ascentM === null
      ? '–'
      : `<span class="up">${icon('arrow-up', 13)}${metres(stats.ascentM)}</span>${stats.descentM === null ? '' : `<small><span class="down">${icon('arrow-down', 12)}${metres(stats.descentM)}</span></small>`}`;
  const elevation = stats.highest ? `${metres(stats.highest[2])}${stats.lowestM === null ? '' : `<small>from ${metres(stats.lowestM)}</small>`}` : '–';
  const top = stats.highest;
  const rows = top
    ? actionsHtml(
        { lon: top[0], lat: top[1], ele: top[2] },
        { forecastLabel: 'Forecast at the highest point', sunLabel: 'Sun and shade at the highest point', bulletin: false },
      )
    : '';
  return `
    <dl class="facts">
      <div><dt>Distance</dt><dd>${lengthText(stats.distanceM)}</dd></div>
      <div><dt>Climb</dt><dd>${climb}</dd></div>
      <div><dt>Highest</dt><dd>${elevation}</dd></div>
    </dl>
    <div id="track-snow">${snowPartHtml(t)}</div>
    ${rows}
    <div class="track-buttons">
      <label class="btn">${icon('arrows-clockwise', 16)}Other file<input type="file" accept="${ACCEPT}" aria-label="Show another GPX file" data-track-input /></label>
      <button type="button" class="btn danger" data-track-remove>${icon('trash', 16)}Remove track</button>
    </div>
    <p class="track-note">Kept in this browser only. Not uploaded, not in links.</p>`;
}

function openTrackPanel(t: ShownTrack) {
  openPanel({ title: t.title, sub: heightSource(t), icon: 'route', tone: 'track' }, panelHtml(t), () => (panelShown = false));
  panelShown = true;
}

// --- Wiring ------------------------------------------------------------------------------

/** Drag a file over the app: the map shows where to drop it. */
function setupDrop() {
  let depth = 0;
  const hasFile = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const show = (on: boolean) => {
    $('drop-zone').hidden = !on;
    document.body.classList.toggle('dragging', on);
  };
  document.addEventListener('dragenter', (e) => {
    if (!hasFile(e)) return;
    e.preventDefault();
    depth++;
    show(true);
  });
  document.addEventListener('dragover', (e) => {
    if (hasFile(e)) e.preventDefault();
  });
  document.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) show(false);
  });
  document.addEventListener('drop', (e) => {
    if (!hasFile(e)) return;
    e.preventDefault();
    depth = 0;
    show(false);
    const file = e.dataTransfer?.files[0];
    if (file) void load(file);
  });
}

export function setupTrack() {
  showControl();
  setupDrop();
  picker.addEventListener('change', () => {
    const f = picker.files?.[0];
    picker.value = '';
    if (f) void load(f);
  });
  const onClick = (e: Event) => {
    const el = e.target as Element;
    const t = gpxTrack();
    if (el.closest('[data-track-remove]')) {
      removeGpx();
      return;
    }
    if (t && el.closest('[data-track-open]')) {
      openTrackPanel(t);
      flyToGpx();
    }
  };
  const onChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (!input.matches('[data-track-input]')) return;
    const f = input.files?.[0];
    input.value = '';
    if (f) void load(f);
  };
  for (const id of ['track', 'details-body']) {
    $(id).addEventListener('click', onClick);
    $(id).addEventListener('change', onChange);
  }
  $('quick-track').addEventListener('click', () => {
    const t = gpxTrack();
    if (t) openTrackPanel(t);
  });

  onGpxChange((t, why) => {
    reading = null;
    showControl();
    if (why === 'loaded' && t) {
      openTrackPanel(t);
      toast(isPhone() ? 'Track added. It stays on this phone.' : 'Track added. It stays on this device.', { icon: icon('check-circle', 18), tone: 'ok' });
    }
    if (why === 'removed' && panelShown && panelOpen()) closePanel();
  });
  onGpxSelect((t) => openTrackPanel(t));
  onGpxSnow(() => {
    const t = gpxTrack();
    const el = document.getElementById('track-snow');
    if (t && panelShown && el) el.innerHTML = snowPartHtml(t);
  });
}
