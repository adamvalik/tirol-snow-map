import { $ } from './dom.ts';

let toastTimer: number | undefined;

export interface ToastOptions {
  /** Trusted markup shown before the text, such as an SVG from icons.ts. */
  icon?: string;
  /** Colours the icon: green for done, orange for a problem. */
  tone?: 'ok' | 'warn';
  /** A button at the end ("Other file"); a tap runs it and closes the toast. */
  action?: { label: string; run: () => void };
  /** How long it stays, in ms; longer by default when it has an action, so there is time to tap it. */
  durationMs?: number;
}

/** A short message over the map (above the timeline; at the top on phones) that goes away on its own. */
export function toast(text: string, options: ToastOptions = {}) {
  const el = $('toast');
  const { icon, action } = options;
  el.replaceChildren();
  el.classList.toggle('has-action', !!action);
  if (icon) {
    const i = document.createElement('span');
    i.className = options.tone === 'warn' ? 'toast-icon warn' : 'toast-icon';
    i.setAttribute('aria-hidden', 'true');
    i.innerHTML = icon;
    el.append(i);
  }
  const t = document.createElement('span');
  t.className = 'toast-text';
  t.textContent = text;
  el.append(t);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      hideToast();
      action.run();
    });
    el.append(b);
  }
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, options.durationMs ?? (action ? 8000 : 4000));
}

export function hideToast() {
  window.clearTimeout(toastTimer);
  $('toast').hidden = true;
}
