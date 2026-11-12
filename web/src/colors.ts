import type { ExpressionSpecification } from 'maplibre-gl';
import { SNOW_CLASSES, snowClassColor } from '../../shared/snowColors.ts';

export { SNOW_CLASSES };

/** Stations without a snow sensor: small, grey and a little transparent on the map. */
export const NO_SNOW_SENSOR_COLOR = '#707b87';

export function snowColorExpression(): ExpressionSpecification {
  const steps: (string | number)[] = [];
  for (const c of SNOW_CLASSES.slice(1)) steps.push(c.min, c.color);
  return [
    'case',
    ['==', ['get', 'snowDepthCm'], null],
    NO_SNOW_SENSOR_COLOR,
    ['step', ['get', 'snowDepthCm'], SNOW_CLASSES[0].color, ...steps],
  ] as ExpressionSpecification;
}

export function snowColor(cm: number | null): string {
  return cm === null ? NO_SNOW_SENSOR_COLOR : snowClassColor(cm);
}
