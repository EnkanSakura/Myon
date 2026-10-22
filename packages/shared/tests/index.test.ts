import { describe, expect, it } from 'vitest';
import {
  API_VERSION,
  aboutKey,
  apiBasePath,
  postStatusSchema,
} from '../src/index';

describe('shared contracts', () => {
  it('validates the post status enum', () => {
    expect(postStatusSchema.parse('published')).toBe('published');
    expect(() => postStatusSchema.parse('deleted')).toThrow();
  });

  it('keeps the about key stable', () => {
    expect(aboutKey).toBe('about');
  });

  it('exposes a versioned API base path', () => {
    expect(API_VERSION).toBe('v1');
    expect(apiBasePath).toBe('/api/v1');
  });
});
