import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveIconSvg,
  resolveIconSvgs,
  sanitizeIconSvg,
} from '../../src/icons';

const SAMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16v16H4z"/></svg>';

function mockSvgResponse(body = SAMPLE_SVG, ok = true, type = 'image/svg+xml') {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    headers: new Headers({ 'content-type': type }),
    text: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizeIconSvg', () => {
  it('keeps svg geometry and restores case-sensitive attribute names', () => {
    const cleaned = sanitizeIconSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path fill="url(#g)" fill-rule="evenodd" d="M0 0h24v24H0z"/></svg>',
    );
    expect(cleaned).not.toBeNull();
    expect(cleaned).toContain('<path');
    expect(cleaned).toContain('viewBox="0 0 24 24"');
    expect(cleaned).toContain('gradientUnits="userSpaceOnUse"');
  });

  it('strips scripts, event handlers and external references', () => {
    const cleaned = sanitizeIconSvg(
      '<svg viewBox="0 0 24 24" onload="evil()"><path d="M0 0"/><script>alert(1)</script><use href="#local"/><use href="https://evil.example/x"/></svg>',
    );
    expect(cleaned).not.toBeNull();
    expect(cleaned).not.toContain('<script');
    expect(cleaned).not.toContain('onload');
    expect(cleaned).not.toContain('evil.example');
    expect(cleaned).toContain('href="#local"');
  });

  it('drops protocol-relative references as well', () => {
    const cleaned = sanitizeIconSvg(
      '<svg viewBox="0 0 24 24"><use href="//evil.example/x"/><use href="#ok"/></svg>',
    );
    expect(cleaned).not.toBeNull();
    expect(cleaned).not.toContain('evil.example');
    expect(cleaned).toContain('href="#ok"');
  });

  it('rejects content that is not an svg', () => {
    expect(sanitizeIconSvg('<div>nope</div>')).toBeNull();
    expect(sanitizeIconSvg('<svg><path d="M0 0"/></svg>')).toBeNull();
    expect(sanitizeIconSvg('')).toBeNull();
  });
});

describe('resolveIconSvg', () => {
  it('fetches the Iconify SVG once and then serves it from cache', async () => {
    const fetchMock = mockSvgResponse();
    const first = await resolveIconSvg('ri:rss-fill');
    expect(first).toContain('<svg');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.iconify.design/ri/rss-fill.svg',
    );

    const second = await resolveIconSvg('ri:rss-fill');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid names without touching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolveIconSvg('mail')).toBeNull();
    expect(await resolveIconSvg('<i class="x"></i>')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when the upstream icon does not exist', async () => {
    mockSvgResponse('not found', false, 'text/plain');
    expect(await resolveIconSvg('mdi:this-icon-does-not-exist')).toBeNull();
  });
});

describe('resolveIconSvgs', () => {
  it('dedupes names, skips invalid ones and returns only resolved icons', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'image/svg+xml' }),
      text: async () => SAMPLE_SVG,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const icons = await resolveIconSvgs([
      'ri:home-4-fill',
      'ri:home-4-fill',
      'fa7-brands:github',
      'not-an-icon',
    ]);
    expect(icons.map((icon) => icon.name)).toEqual([
      'ri:home-4-fill',
      'fa7-brands:github',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
