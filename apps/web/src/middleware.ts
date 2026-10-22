import { defineMiddleware } from 'astro:middleware';
import { loadPublicSiteSettings } from './lib/site';

/** 这些路径不需要站点设置：API 自身、静态资源、RSS。 */
const SKIP = [
  /^\/api\//,
  /^\/_astro\//,
  /^\/css\//,
  /^\/js\//,
  /^\/assets\//,
  /^\/rss\.xml$/,
];

export const onRequest = defineMiddleware(async (context, next) => {
  if (!SKIP.some((pattern) => pattern.test(context.url.pathname))) {
    context.locals.site = await loadPublicSiteSettings();
  }
  return next();
});
