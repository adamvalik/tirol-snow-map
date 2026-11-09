// "Something is wrong" and "Idea" links: an e-mail with the version, the current view link and the
// device filled in, when a feedback address is set (app/env.ts), and GitHub issue forms
// (.github/ISSUE_TEMPLATE) for testers with an account.
import { VERSION_LABEL } from '../version.ts';
import { FEEDBACK_EMAIL } from './env.ts';

export type FeedbackKind = 'bug' | 'idea';

export interface FeedbackContext {
  version: string;
  view: string;
  device: string;
  screen: string;
}

const REPO = 'https://github.com/adamvalik/tirol-snow-map';

export function currentContext(): FeedbackContext {
  return {
    version: VERSION_LABEL,
    view: location.href,
    device: navigator.userAgent,
    screen: `${innerWidth} × ${innerHeight} px at ${devicePixelRatio}×`,
  };
}

const details = (c: FeedbackContext) =>
  `App: ${c.version}\nView: ${c.view}\nDevice: ${c.device}\nScreen: ${c.screen}`;

export function mailtoUrl(email: string, kind: FeedbackKind, c: FeedbackContext): string {
  const subject = kind === 'bug' ? 'Snow map: something is wrong' : 'Snow map: idea';
  const prompt =
    kind === 'bug'
      ? 'What happened, and what did you expect?\n\n\n'
      : 'What would you like the map to do?\n\n\n';
  const body = `${prompt}A screenshot helps if you have one.\n\n--- filled in by the app, please keep ---\n${details(c)}\n`;
  // encodeURIComponent, not URLSearchParams: mail apps expect %20 for spaces, not "+".
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** A GitHub issue form with the fields the app knows filled in (field ids in the templates). */
export function issueUrl(kind: FeedbackKind, c: FeedbackContext): string {
  const q = new URLSearchParams({ template: kind === 'bug' ? 'bug.yml' : 'idea.yml', version: c.version, view: c.view });
  if (kind === 'bug') q.set('device', `${c.device}; ${c.screen}`);
  return `${REPO}/issues/new?${q}`;
}

/** The feedback section of "About the data", built when the dialog opens so the view link is current. */
export function feedbackHtml(email = FEEDBACK_EMAIL, c = currentContext()): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const link = (href: string, label: string, kind: FeedbackKind, via: string) =>
    `<a href="${esc(href)}"${via === 'github' ? ' target="_blank" rel="noopener"' : ''} data-feedback="${kind}-${via}">${label}</a>`;
  const github = `${link(issueUrl('bug', c), 'report a problem', 'bug', 'github')} or ${link(issueUrl('idea', c), 'suggest an idea', 'idea', 'github')} on GitHub`;
  return email
    ? `<p>${link(mailtoUrl(email, 'bug', c), 'Something is wrong', 'bug', 'mail')} · ${link(mailtoUrl(email, 'idea', c), 'Idea', 'idea', 'mail')}</p>
       <p class="muted">Opens an e-mail with the app version, this view's link and your device filled in. With a GitHub account you can also ${github}.</p>`
    : `<p>With a GitHub account you can ${github}. The app version and this view's link are filled in.</p>`;
}
