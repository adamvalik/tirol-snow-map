// Old-style ("legacy") map filters to expressions, as MapLibre's style spec converts them. A port of
// `isExpressionFilter` and `convertFilter` from @maplibre/maplibre-gl-style-spec: importing that
// package put a second copy of the style spec, about 20 KB gzipped, into the app's first download,
// next to the one inside MapLibre (#112). web/test/legacyFilter.test.ts checks the port against the
// package for every basemap layer.
import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl';

type Filter = FilterSpecification | boolean | unknown[];
type Classification = 'legacy' | 'expression' | 'neutral';

function classifyChildren(children: unknown[]): Classification {
  let sawLegacy = false;
  for (const child of children) {
    const c = classify(child);
    if (c === 'expression') return 'expression';
    if (c === 'legacy') sawLegacy = true;
  }
  return sawLegacy ? 'legacy' : 'neutral';
}

function classify(filter: unknown): Classification {
  if (typeof filter === 'boolean') return 'neutral';
  if (!Array.isArray(filter) || filter.length === 0) return 'legacy';
  switch (filter[0]) {
    case 'has':
      if (filter.length < 2 || filter[1] === '$id' || filter[1] === '$type') return 'legacy';
      return filter.length === 2 ? 'neutral' : 'expression';
    case 'in':
      return filter.length >= 3 && (typeof filter[1] !== 'string' || Array.isArray(filter[2])) ? 'expression' : 'legacy';
    case '!in':
    case '!has':
    case 'none':
      return 'legacy';
    case '==':
    case '!=':
    case '>':
    case '>=':
    case '<':
    case '<=':
      return filter.length !== 3 || Array.isArray(filter[1]) || Array.isArray(filter[2]) ? 'expression' : 'legacy';
    case 'any':
    case 'all':
      return classifyChildren(filter.slice(1));
    default:
      return 'expression';
  }
}

/** Whether a filter is already an expression (or works as one). */
export const isExpressionFilter = (filter: unknown): boolean => classify(filter) !== 'legacy';

type Value = string | number | boolean | null;
type Types = Record<string, string>;

const getter = (property: string): unknown[] => (property === '$type' ? ['geometry-type'] : property === '$id' ? ['id'] : ['get', property]);

function typeChecks(types: Types): unknown {
  const conditions = Object.entries(types).map(([property, type]) => ['==', ['typeof', property === '$id' ? ['id'] : ['get', property]], type]);
  if (conditions.length === 0) return true;
  return conditions.length === 1 ? conditions[0] : ['all', ...conditions];
}

function comparison(property: string, value: Value, op: string, types: Types): unknown {
  if (property === '$type') return [op, ['geometry-type'], value];
  const get = property === '$id' ? ['id'] : ['get', property];
  if (value !== null) types[property] = typeof value;
  if (op === '==' && property !== '$id' && value === null) return ['all', ['has', property], ['==', get, null]];
  if (op === '!=' && property !== '$id' && value === null) return ['any', ['!', ['has', property]], ['!=', get, null]];
  return [op, get, value];
}

function inOp(property: string, values: Value[], negate = false): unknown {
  if (values.length === 0) return negate;
  const get = getter(property);
  const type = typeof values[0];
  if (values.every((v) => typeof v === type) && (type === 'string' || type === 'number')) {
    const sorted = [...values].sort() as (string | number)[];
    const unique = sorted.filter((v, i) => i === 0 || sorted[i - 1] !== v);
    return ['match', get, unique, !negate, negate];
  }
  return negate ? ['all', ...values.map((v) => ['!=', get, v])] : ['any', ...values.map((v) => ['==', get, v])];
}

function hasOp(property: string): unknown {
  if (property === '$type') return true;
  return property === '$id' ? ['!=', ['id'], null] : ['has', property];
}

function convert(filter: Filter | undefined, types: Types): unknown {
  if (isExpressionFilter(filter)) return filter;
  if (!filter) return true;
  const f = filter as unknown[];
  const op = f[0] as string;
  if (f.length <= 1) return op !== 'any';
  switch (op) {
    case '==':
    case '!=':
    case '<':
    case '>':
    case '<=':
    case '>=':
      return comparison(f[1] as string, f[2] as Value, op, types);
    case 'any':
      return [
        'any',
        ...f.slice(1).map((child) => {
          const own: Types = {};
          const converted = convert(child as Filter, own);
          const checks = typeChecks(own);
          return checks === true ? converted : ['case', checks, converted, false];
        }),
      ];
    case 'all': {
      const children = f.slice(1).map((child) => convert(child as Filter, types));
      return children.length > 1 ? ['all', ...children] : children[0];
    }
    case 'none':
      return ['!', convert(['any', ...f.slice(1)], {})];
    case 'in':
      return inOp(f[1] as string, f.slice(2) as Value[]);
    case '!in':
      return inOp(f[1] as string, f.slice(2) as Value[], true);
    case 'has':
      return hasOp(f[1] as string);
    case '!has':
      return ['!', hasOp(f[1] as string)];
    default:
      return true;
  }
}

/** A filter as an expression; an expression filter comes back unchanged. */
export const convertFilter = (filter: FilterSpecification | undefined): ExpressionSpecification | boolean =>
  convert(filter, {}) as ExpressionSpecification | boolean;
