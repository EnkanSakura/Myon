import { describe, expect, it } from 'vitest';
import {
  mediaAliasesSchema,
  mediaAliasMaxCount,
  mediaCategoryInputSchema,
  mediaCategoryPatchSchema,
  mediaDefaultCategoryIds,
  mediaListQuerySchema,
  mediaPatchSchema,
  mediaUncategorizedId,
} from '../src/index';

describe('media aliases', () => {
  it('trims, drops duplicates / empties and keeps order', () => {
    const aliases = mediaAliasesSchema.parse([' 封面 ', '封面', '扉页', '   ']);
    expect(aliases).toEqual(['封面', '扉页']);
  });

  it('rejects too many aliases and aliases over 30 chars', () => {
    const tooMany = Array.from(
      { length: mediaAliasMaxCount + 1 },
      (_, index) => `别名${index}`,
    );
    expect(mediaAliasesSchema.safeParse(tooMany).success).toBe(false);
    expect(mediaAliasesSchema.safeParse(['x'.repeat(31)]).success).toBe(false);
  });
});

describe('mediaPatchSchema', () => {
  it('accepts categoryId / aliases, including null category', () => {
    expect(
      mediaPatchSchema.safeParse({ categoryId: 'cat_posts' }).success,
    ).toBe(true);
    expect(mediaPatchSchema.safeParse({ categoryId: null }).success).toBe(true);
    expect(mediaPatchSchema.safeParse({ aliases: ['封面'] }).success).toBe(
      true,
    );
  });

  it('requires at least one field', () => {
    expect(mediaPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe('media category schemas', () => {
  it('accepts 1–24 char names and rejects empty / oversized names', () => {
    expect(mediaCategoryInputSchema.parse({ name: ' 封面 ' })).toEqual({
      name: '封面',
    });
    expect(mediaCategoryInputSchema.safeParse({ name: '   ' }).success).toBe(
      false,
    );
    expect(
      mediaCategoryInputSchema.safeParse({ name: 'x'.repeat(25) }).success,
    ).toBe(false);
  });

  it('category patch requires name or position', () => {
    expect(mediaCategoryPatchSchema.safeParse({ name: '新名字' }).success).toBe(
      true,
    );
    expect(mediaCategoryPatchSchema.safeParse({ position: 2 }).success).toBe(
      true,
    );
    expect(mediaCategoryPatchSchema.safeParse({}).success).toBe(false);
  });

  it('exposes default category ids and the uncategorized sentinel', () => {
    expect(mediaDefaultCategoryIds).toEqual({
      posts: 'cat_posts',
      moments: 'cat_moments',
      gallery: 'cat_gallery',
      about: 'cat_about',
    });
    expect(mediaUncategorizedId).toBe('uncategorized');
  });
});

describe('mediaListQuerySchema', () => {
  it('defaults sort / pagination and accepts category / q', () => {
    const parsed = mediaListQuerySchema.parse({
      category: mediaUncategorizedId,
      q: ' 封面 ',
    });
    expect(parsed).toMatchObject({
      category: mediaUncategorizedId,
      q: '封面',
      sort: 'added',
      limit: 20,
      offset: 0,
    });
  });

  it('rejects invalid sort and too-long keyword', () => {
    expect(mediaListQuerySchema.safeParse({ sort: 'hot' }).success).toBe(false);
    expect(mediaListQuerySchema.safeParse({ q: 'x'.repeat(61) }).success).toBe(
      false,
    );
  });
});
