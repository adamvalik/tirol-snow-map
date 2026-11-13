/**
 * Snow depth classes, shared by the station markers and the estimated depth layer. No snow is an
 * earth brown, so a white dot never means bare ground; snow is a blue ramp that gets darker with
 * depth and ends in purple. Lightness falls monotonically along the snow classes, so they stay
 * readable for colour-blind viewers and against hillshade. The depth and new snow pictures leave
 * cells under 0.5 cm transparent, so the brown appears only on station dots and the legend.
 */
export const SNOW_CLASSES: { min: number; label: string; color: string }[] = [
  { min: 0, label: '0 cm', color: '#a8865c' },
  { min: 0.5, label: '1–5 cm', color: '#a9d4f5' },
  { min: 5, label: '5–20 cm', color: '#6fb1ea' },
  { min: 20, label: '20–50 cm', color: '#3b86d6' },
  { min: 50, label: '50–100 cm', color: '#1f5cb4' },
  { min: 100, label: '100–200 cm', color: '#183a87' },
  { min: 200, label: '200+ cm', color: '#4b1a83' },
];

export function snowClassColor(cm: number): string {
  let color = SNOW_CLASSES[0].color;
  for (const c of SNOW_CLASSES) if (cm >= c.min) color = c.color;
  return color;
}
