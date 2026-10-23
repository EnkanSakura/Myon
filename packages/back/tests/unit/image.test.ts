import { describe, expect, it } from 'vitest';
import {
  isBangumiCoverContentType,
  isBangumiCoverHost,
  normalizeBangumiCoverUrl,
} from '../../src/image';

describe('Bangumi cover URL validation', () => {
  it('accepts Bangumi image hosts over http(s)', () => {
    expect(
      normalizeBangumiCoverUrl('https://lain.bgm.tv/pic/cover/l/aa/bb/123.jpg'),
    ).toBe('https://lain.bgm.tv/pic/cover/l/aa/bb/123.jpg');
    expect(normalizeBangumiCoverUrl('http://bgm.tv/a.jpg')).toContain(
      'http://bgm.tv/a.jpg',
    );
    expect(normalizeBangumiCoverUrl('https://bangumi.tv/a.jpg')).toContain(
      'https://bangumi.tv/a.jpg',
    );
  });

  it('rejects non-Bangumi hosts and unsafe protocols', () => {
    expect(normalizeBangumiCoverUrl('https://evil.example/a.jpg')).toBeNull();
    expect(
      normalizeBangumiCoverUrl('https://bgm.tv.evil.example/a.jpg'),
    ).toBeNull();
    expect(normalizeBangumiCoverUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeBangumiCoverUrl('')).toBeNull();
  });

  it('matches only exact/subdomain hosts', () => {
    expect(isBangumiCoverHost('bgm.tv')).toBe(true);
    expect(isBangumiCoverHost('lain.bgm.tv')).toBe(true);
    expect(isBangumiCoverHost('bangumi.tv')).toBe(true);
    expect(isBangumiCoverHost('notbgm.tv')).toBe(false);
  });
});

describe('Bangumi cover content type', () => {
  it('accepts image responses and missing content-type', () => {
    expect(isBangumiCoverContentType('image/jpeg')).toBe(true);
    expect(isBangumiCoverContentType('image/webp; charset=binary')).toBe(true);
    expect(isBangumiCoverContentType(null)).toBe(true);
  });

  it('rejects non-image responses', () => {
    expect(isBangumiCoverContentType('text/html')).toBe(false);
    expect(isBangumiCoverContentType('application/json')).toBe(false);
  });
});
