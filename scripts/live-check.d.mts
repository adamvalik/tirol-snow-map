export const MAX_DATA_AGE_H: number;
export function checkSite(
  target: { base: string; commit: string; picture: boolean; indexed: boolean },
  fetchFn?: (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text' | 'json'>>,
  now?: number,
): Promise<{ problems: string[]; notes: string[] }>;
