import { env } from 'cloudflare:workers';
import app from '@myon/back';
import type { AppBindings } from '@myon/back/types';
import type { PostListItem } from '@myon/shared';
import type { APIRoute } from 'astro';

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** RSS 2.0：从进程内 API 取已发布文章，供页脚「RSS 订阅」使用。 */
export const GET: APIRoute = async ({ site }) => {
  const origin = site ?? new URL('https://myon.studio');

  let items: PostListItem[] = [];
  const res = await app.request(
    '/api/v1/posts',
    {},
    env as unknown as AppBindings,
  );
  if (res.ok) {
    const body = (await res.json()) as { items: PostListItem[] };
    items = body.items;
  }

  const entries = items
    .map((post) => {
      const link = new URL(`/articles/${post.slug}`, origin).toString();
      const published = post.publishedAt
        ? new Date(post.publishedAt).toUTCString()
        : new Date().toUTCString();
      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <category>${escapeXml(post.category)}</category>`,
        `      <pubDate>${published}</pubDate>`,
        `      <description>${escapeXml(post.excerpt)}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Myon · 同人志</title>
    <link>${escapeXml(new URL('/', origin).toString())}</link>
    <atom:link href="${escapeXml(new URL('/rss.xml', origin).toString())}" rel="self" type="application/rss+xml" />
    <description>写字、看番、存图、做点小工具。一个人的二次元生活志。</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${entries}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=1800',
    },
  });
};
