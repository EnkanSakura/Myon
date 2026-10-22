import { describe, expect, it } from 'vitest';
import { sanitizeFooterHtml } from '../../src/site';

describe('sanitizeFooterHtml', () => {
  it('keeps multiple links with their hrefs', () => {
    const html = sanitizeFooterHtml(
      'Built with <a href="https://astro.build">Astro</a> · <a href="https://workers.cloudflare.com">Workers</a>',
    );
    expect(html.match(/<a /g)?.length).toBe(2);
    expect(html).toContain('href="https://astro.build"');
    expect(html).toContain('href="https://workers.cloudflare.com"');
  });

  it('strips scripts, event handlers and unknown tags', () => {
    const html = sanitizeFooterHtml(
      '<script>alert(1)</script><a href="javascript:alert(2)" onclick="x()">x</a><iframe src="x"></iframe>',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<iframe');
  });

  it('passes plain text through unchanged', () => {
    expect(sanitizeFooterHtml('Astro · Workers')).toBe('Astro · Workers');
  });
});
