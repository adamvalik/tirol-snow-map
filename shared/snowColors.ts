/**
 * Snow depth classes, shared by the station markers and the estimated depth layer. A single-hue
 * blue ramp ending in purple: lightness falls monotonically, so it stays readable for colour-blind
 * viewers and against hillshade.
 */
export const SNOW_CLASSES: { min: number; label: string; color: string }[] = [
  { min: 0, label: '0 cm', color: '#ffffff' },
  { min: 0.5, label: '1–5 cm', color: '#c6dbef' },
  { min: 5, label: '5–20 cm', color: '#9ecae1' },
  { min: 20, label: '20–50 cm', color: '#6baed6' },
  { min: 50, label: '50–100 cm', color: '#3182bd' },
  { min: 100, label: '100–200 cm', color: '#08519c' },
  { min: 200, label: '200+ cm', color: '#3f007d' },
];

export function snowClassColor(cm: number): string {
  let color = SNOW_CLASSES[0].color;
  for (const c of SNOW_CLASSES) if (cm >= c.min) color = c.color;
  return color;
}
