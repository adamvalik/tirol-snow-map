// "Something is wrong" and "Idea" links. A problem goes to an anonymous form (FEEDBACK_FORM_URL) with
// the version, the current view link and the device as hidden fields; an idea goes to a public board
// where people vote (IDEAS_URL). Without them, each falls back to an e-mail (FEEDBACK_EMAIL) and then
// to the GitHub issue forms (.github/ISSUE_TEMPLATE), which stay offered to testers with an account.
import { VERSION_LABEL } from '../version.ts';
import { FEEDBACK_EMAIL, FEEDBACK_FORM_URL, IDEAS_URL } from './env.ts';
import { icon } from './icons.ts';

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

/** The problem form with the app's details as URL parameters, for the form's hidden fields. */
export function formUrl(form: string, c: FeedbackContext): string {
  const url = new URL(form);
  for (const [k, v] of Object.entries(c)) url.searchParams.set(k, v);
  return url.toString();
}

/** A GitHub issue form with the fields the app knows filled in (field ids in the templates). */
export function issueUrl(kind: FeedbackKind, c: FeedbackContext): string {
  const q = new URLSearchParams({ template: kind === 'bug' ? 'bug.yml' : 'idea.yml', version: c.version, view: c.view });
  if (kind === 'bug') q.set('device', `${c.device}; ${c.screen}`);
  return `${REPO}/issues/new?${q}`;
}

export interface FeedbackTargets {
  email: string;
  form: string;
  ideas: string;
}

const CONFIGURED: FeedbackTargets = { email: FEEDBACK_EMAIL, form: FEEDBACK_FORM_URL, ideas: IDEAS_URL };

type Via = 'form' | 'board' | 'mail' | 'github';

/** The Feedback section of the About tab, built each time the tab opens so the view link is current. */
export function feedbackHtml(t: FeedbackTargets = CONFIGURED, c = currentContext()): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const attrs = (href: string, kind: FeedbackKind, via: Via) =>
    `href="${esc(href)}"${via === 'mail' ? '' : ' target="_blank" rel="noopener"'} data-feedback="${kind}-${via}"`;
  const link = (href: string, label: string, kind: FeedbackKind, via: Via) => `<a ${attrs(href, kind, via)}>${label}</a>`;
  const button = (href: string, label: string, kind: FeedbackKind, via: Via, iconHtml: string, tone: string) =>
    `<a class="fb" ${attrs(href, kind, via)}><span class="fb-icon ${tone}" aria-hidden="true">${iconHtml}</span><span>${label}</span></a>`;
  const bugIssue = issueUrl('bug', c);
  const ideaIssue = issueUrl('idea', c);

  if (!t.email && !t.form && !t.ideas) {
    return section(`<div class="fb-buttons">
        ${button(bugIssue, 'Report a problem', 'bug', 'github', icon('github', 18), '')}
        ${button(ideaIssue, 'Suggest an idea', 'idea', 'github', icon('lightbulb', 18), '')}
      </div>
      <p class="small">Opens a GitHub form with the version and this view filled in. Needs a GitHub account.</p>`);
  }

  // Each kind goes to the best place that is set; GitHub is last and then also a plain link below.
  const bug = bugTarget(t, c);
  const idea: [string, Via] = t.ideas ? [t.ideas, 'board'] : t.email ? [mailtoUrl(t.email, 'idea', c), 'mail'] : [ideaIssue, 'github'];
  const notes = [
    bug[1] === 'form'
      ? 'Problems go to a short form, no name needed. It gets the app version, this view\'s link and your device.'
      : bug[1] === 'mail'
        ? 'Problems open an e-mail with the app version, this view\'s link and your device filled in.'
        : '',
    idea[1] === 'board'
      ? 'Ideas go to a board where you can vote for the ones you want most.'
      : idea[1] === 'mail'
        ? 'Ideas open an e-mail.'
        : '',
  ].filter(Boolean);
  return section(`<div class="fb-buttons">
        ${button(bug[0], 'Something is wrong', 'bug', bug[1], icon('bug', 18), 'bug')}
        ${button(idea[0], 'Idea', 'idea', idea[1], icon('lightbulb', 18), 'idea')}
      </div>
      ${notes.map((n) => `<p class="small">${n}</p>`).join('')}
      <p class="small fb-github">${icon('github', 16)}<span>On GitHub: ${link(bugIssue, 'report a problem', 'bug', 'github')} or ${link(ideaIssue, 'suggest an idea', 'idea', 'github')}</span></p>`);
}

/** Where "Something is wrong" goes: the form, else an e-mail, else the GitHub issue form. */
export function bugTarget(t: FeedbackTargets = CONFIGURED, c = currentContext()): [href: string, via: Via] {
  return t.form ? [formUrl(t.form, c), 'form'] : t.email ? [mailtoUrl(t.email, 'bug', c), 'mail'] : [issueUrl('bug', c), 'github'];
}

const section = (body: string) =>
  `<section class="about-section" aria-labelledby="fb-h"><h2 id="fb-h">Feedback</h2>${body}</section>`;
