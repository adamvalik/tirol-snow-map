import { describe, expect, it } from 'vitest';
import { analyticsEnabled, countUrl } from '../src/app/analytics.ts';
import { feedbackHtml, issueUrl, mailtoUrl, type FeedbackContext } from '../src/app/feedback.ts';

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

  it('offers only GitHub without an address, and escapes the links', () => {
    expect(feedbackHtml('', ctx)).not.toContain('mailto:');
    const html = feedbackHtml('snow@example.org', ctx);
    expect(html).toContain('mailto:snow@example.org');
    expect(html).not.toMatch(/href="[^"]*&(?!amp;)[^"]*"/);
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
});
