import { describe, expect, it } from 'vitest';
import {
  builtinToolKeys,
  toolInputSchema,
  toolPatchSchema,
} from '../src/index';

describe('tool schemas', () => {
  it('applies defaults when creating a tool', () => {
    const parsed = toolInputSchema.parse({
      slug: 'timestamp',
      name: '时间戳转换',
    });
    expect(parsed).toMatchObject({
      slug: 'timestamp',
      name: '时间戳转换',
      description: '',
      kind: '',
      keywords: '',
      enabled: true,
      position: 0,
    });
    expect(parsed.toolKey).toBeUndefined();
    expect(parsed.href).toBeUndefined();
  });

  it('accepts builtin keys and internal/external links', () => {
    for (const key of builtinToolKeys) {
      expect(
        toolInputSchema.safeParse({
          slug: `tool-${key}`,
          name: 'x',
          toolKey: key,
        }).success,
      ).toBe(true);
    }
    const internal = toolInputSchema.parse({
      slug: 'bangumi-tool',
      name: 'x',
      href: '/bangumi',
    });
    expect(internal.href).toBe('/bangumi');
    const external = toolInputSchema.parse({
      slug: 'external-tool',
      name: 'x',
      href: 'https://example.com/tool',
    });
    expect(external.href).toBe('https://example.com/tool');
  });

  it('rejects unknown builtin keys and unsafe links', () => {
    expect(
      toolInputSchema.safeParse({
        slug: 'unknown-panel',
        name: 'x',
        toolKey: 'unknown-panel',
      }).success,
    ).toBe(false);
    for (const href of ['javascript:alert(1)', 'example.com', 'ftp://x']) {
      expect(
        toolInputSchema.safeParse({ slug: 'unsafe-link', name: 'x', href })
          .success,
      ).toBe(false);
    }
  });

  it('requires a url-safe slug', () => {
    expect(toolInputSchema.safeParse({ name: 'x' }).success).toBe(false);
    for (const slug of [
      'Bad Slug',
      'a',
      '-lead',
      'trail-',
      'with_underscore',
    ]) {
      expect(toolInputSchema.safeParse({ slug, name: 'x' }).success).toBe(
        false,
      );
    }
    expect(
      toolInputSchema.safeParse({ slug: 'json-format', name: 'x' }).success,
    ).toBe(true);
  });

  it('does not inject defaults into partial patches', () => {
    expect(toolPatchSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(toolPatchSchema.parse({ position: 3 })).toEqual({ position: 3 });
  });
});
