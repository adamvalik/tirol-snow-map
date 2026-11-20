import { describe, expect, it } from 'vitest';
import { analyticsEnabled, countUrl, sourceFrom, withoutSource } from '../src/app/analytics.ts';
import { feedbackHtml, formUrl, issueUrl, mailtoUrl, type FeedbackContext } from '../src/app/feedback.ts';

const ctx: FeedbackContext = {
  version: 'v0.1.0 (444afeb)',
  view: 'https://adamvalik.github.io/tirol-snow-map/#map=10.40/46.4700/11.3540/20/60&layers=snow,stations',
  device: 'Mozilla/5.0 (iPhone)',
  screen: '390 × 844 px at 3×',
};

describe('feedback links', () => {
  it('fills the e-mail with version, view and device, encoded for mail apps', () => {
    const url = mailtoUrl('snow@example.org', 'bug', ctx);
    expect(url.startsWith('mailto:snow@example.org?subject=Snow%20map%3A%20something%20is%20wrong&body=')).toBe(true);
    expect(url).not.toContain('+');
    const body = decodeURIComponent(url.split('&body=')[1]);
    expect(body).toContain('App: v0.1.0 (444afeb)');
    expect(body).toContain(`View: ${ctx.view}`); // the hash with & and = survives
    expect(body).toContain('Screen: 390 × 844 px at 3×');
    expect(url.length).toBeLessThan(1800); // some mail apps cut longer links
  });

  it('prefills the GitHub issue forms by field id', () => {
    const q = new URL(issueUrl('bug', ctx)).searchParams;
    expect(q.get('template')).toBe('bug.yml');
    expect(q.get('view')).toBe(ctx.view);
    expect(q.get('version')).toBe(ctx.version);
    expect(q.get('device')).toContain('iPhone');
    expect(new URL(issueUrl('idea', ctx)).searchParams.get('device')).toBeNull();
  });

  it('puts the details on the problem form as URL parameters for its hidden fields', () => {
    const q = new URL(formUrl('https://tally.so/r/abc123?lang=en', ctx)).searchParams;
    expect(q.get('lang')).toBe('en');
    expect(q.get('version')).toBe(ctx.version);
    expect(q.get('view')).toBe(ctx.view); // the hash with & and = survives
    expect(q.get('device')).toBe(ctx.device);
    expect(q.get('screen')).toBe(ctx.screen);
  });

  it('offers only GitHub without an address, and escapes the links', () => {
    const none = { email: '', form: '', ideas: '' };
    expect(feedbackHtml(none, ctx)).not.toContain('mailto:');
    const html = feedbackHtml({ ...none, email: 'snow@example.org' }, ctx);
    expect(html).toContain('mailto:snow@example.org');
    expect(html).not.toMatch(/href="[^"]*&(?!amp;)[^"]*"/);
  });

  it('sends problems to the form and ideas to the board, before the e-mail', () => {
    const t = { email: 'snow@example.org', form: 'https://tally.so/r/abc123', ideas: 'https://ideas.example.org/' };
    const html = feedbackHtml(t, ctx);
    expect(html).not.toContain('mailto:');
    expect(html).toContain('href="https://tally.so/r/abc123?version=');
    expect(html).toContain('data-feedback="bug-form"');
    expect(html).toContain('href="https://ideas.example.org/" target="_blank" rel="noopener" data-feedback="idea-board"');
    expect(html).toContain('data-feedback="bug-github"'); // GitHub stays as a plain link
    expect(html).not.toMatch(/href="[^"]*&(?!amp;)[^"]*"/);
    // Only the form set: ideas still go by e-mail.
    expect(feedbackHtml({ ...t, ideas: '' }, ctx)).toContain('data-feedback="idea-mail"');
  });
});

describe('visit counting', () => {
  it('is off without a code, on localhost and in automated browsers', () => {
    expect(analyticsEnabled('', 'adamvalik.github.io', false)).toBe(false);
    expect(analyticsEnabled('snowmap', 'localhost', false)).toBe(false);
    expect(analyticsEnabled('snowmap', '127.0.0.1', false)).toBe(false);
    expect(analyticsEnabled('snowmap', 'adamvalik.github.io', true)).toBe(false);
    expect(analyticsEnabled('snowmap', 'adamvalik.github.io', false)).toBe(true);
  });

  it('counts the page as "/" with the version, events with e=true', () => {
    const visit = new URL(countUrl('snowmap', '/', false, 390, 'https://chat.example/'));
    expect(visit.host).toBe('snowmap.goatcounter.com');
    expect(visit.searchParams.get('p')).toBe('/');
    expect(visit.searchParams.get('t')).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(visit.searchParams.get('r')).toBe('https://chat.example/');
    const event = new URL(countUrl('snowmap', 'layer/sun', true, 390));
    expect(event.searchParams.get('e')).toBe('true');
    expect(event.searchParams.get('p')).toBe('layer/sun');
    expect(event.searchParams.has('r')).toBe(false);
  });

  it('takes the source from ref or utm_source, only as a short plain name', () => {
    expect(sourceFrom('')).toBe('');
    expect(sourceFrom('?ref=wa-erasmus')).toBe('wa-erasmus');
    expect(sourceFrom('?utm_source=IG-Bio&utm_medium=social')).toBe('ig-bio');
    expect(sourceFrom('?ref=wa-erasmus&utm_source=other')).toBe('wa-erasmus');
    expect(sourceFrom('?ref=someone@example.com')).toBe('');
    expect(sourceFrom(`?ref=${'a'.repeat(33)}`)).toBe('');
    expect(new URL(countUrl('snowmap', '/', false, 390, sourceFrom('?ref=wa-erasmus'))).searchParams.get('r')).toBe('wa-erasmus');
  });

  it('removes the source from the address and keeps the rest', () => {
    const base = 'https://adamvalik.github.io/tirol-snow-map/';
    expect(withoutSource(`${base}?ref=wa-erasmus#11.3/46.5/10`)).toBe('/tirol-snow-map/#11.3/46.5/10');
    expect(withoutSource(`${base}?utm_source=ig&utm_campaign=x&keep=1`)).toBe('/tirol-snow-map/?keep=1');
    expect(withoutSource(base)).toBe('/tirol-snow-map/');
  });
});
