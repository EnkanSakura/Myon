import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from './types';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const decoder = new TextDecoder();

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonPart(part: string): Record<string, unknown> {
  return JSON.parse(decoder.decode(base64UrlToBytes(part))) as Record<
    string,
    unknown
  >;
}

interface JwksCacheEntry {
  keys: Array<JsonWebKey & { kid?: string }>;
  at: number;
}

const JWKS_TTL = 60 * 60 * 1000;
const jwksCache = new Map<string, JwksCacheEntry>();

async function loadJwks(domain: string) {
  const cached = jwksCache.get(domain);
  if (cached && Date.now() - cached.at < JWKS_TTL) return cached.keys;

  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`jwks_${res.status}`);
  const body = (await res.json()) as {
    keys?: Array<JsonWebKey & { kid?: string }>;
  };
  const keys = body.keys ?? [];
  jwksCache.set(domain, { keys, at: Date.now() });
  return keys;
}

/** 校验 Cloudflare Access 注入的 JWT：签名、受众、有效期、签发方。 */
export async function verifyAccessJwt(
  token: string,
  options: { domain: string; aud: string },
): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJsonPart(parts[0] as string);
    payload = decodeJsonPart(parts[1] as string);
  } catch {
    return false;
  }

  const audience = payload.aud;
  const audOk = Array.isArray(audience)
    ? audience.includes(options.aud)
    : audience === options.aud;
  if (!audOk) return false;

  const exp = payload.exp;
  if (typeof exp === 'number' && exp * 1000 < Date.now()) return false;

  const iss = payload.iss;
  if (typeof iss === 'string' && !iss.includes(options.domain)) return false;

  const keys = await loadJwks(options.domain);
  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  const jwk = kid ? keys.find((key) => key.kid === kid) : keys[0];
  if (!jwk) return false;

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signature = base64UrlToBytes(parts[2] as string);
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature as BufferSource,
    data as BufferSource,
  );
}

/**
 * 后台写接口的门禁，两种模式：
 * - 配置了 ACCESS_TEAM_DOMAIN + ACCESS_AUD：校验 Access 注入的 JWT（生产推荐）；
 * - 否则回退到 `x-admin-token` 头与 ADMIN_TOKEN 比对（本地开发用）。
 * 两种都没配置时直接关闭接口，避免把写能力暴露出去。
 */
export const requireAdmin: MiddlewareHandler<{
  Bindings: AppBindings;
}> = async (c, next) => {
  const domain = c.env.ACCESS_TEAM_DOMAIN;
  const aud = c.env.ACCESS_AUD;

  if (domain && aud) {
    const jwt = c.req.header('cf-access-jwt-assertion');
    if (!jwt) return c.json({ error: 'unauthorized' }, 401);
    let valid = false;
    try {
      valid = await verifyAccessJwt(jwt, { domain, aud });
    } catch (error) {
      console.error('access jwt verify failed', error);
    }
    if (!valid) return c.json({ error: 'unauthorized' }, 401);
    await next();
    return;
  }

  const expected = c.env.ADMIN_TOKEN;
  if (!expected) {
    return c.json({ error: 'admin_not_configured' }, 503);
  }

  const given = c.req.header('x-admin-token') ?? '';
  if (!safeEqual(given, expected)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  await next();
};
