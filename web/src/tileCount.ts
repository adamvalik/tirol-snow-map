// How many map tiles were asked for and how many are in, for the loading note over the map (#112).
// The elevation tiles (island.ts) and the basemap (map.ts) load through protocols of this app, which
// pass each load through `counted`. An aborted or failed tile counts as in: it is not awaited.

type Listener = (done: number, asked: number) => void;

let asked = 0;
let done = 0;
const listeners: Listener[] = [];

const tell = () => {
  for (const l of listeners) l(done, asked);
};

/** Counts one tile load. */
export function counted<T>(load: Promise<T>): Promise<T> {
  asked++;
  tell();
  return load.finally(() => {
    done++;
    tell();
  });
}

/** Calls `listener` with the count each time it changes. */
export function onTileCount(listener: Listener): () => void {
  listeners.push(listener);
  return () => listeners.splice(listeners.indexOf(listener), 1);
}
