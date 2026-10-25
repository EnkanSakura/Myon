/** Worker 原生绑定；web 的 wrangler 生成的 Env 在运行时与它结构一致。 */
export interface AppBindings {
  DB: D1Database;
  MEDIA: R2Bucket;
  /** 站点设置（Workers KV）；键名与默认值见 @myon/shared 的 siteSettingKeys。 */
  SETTINGS: KVNamespace;
  SITE_URL: string;
  ENVIRONMENT: string;
  /** 后台写接口的临时令牌；未配置时后台接口返回 503。 */
  ADMIN_TOKEN?: string;
  /** Cloudflare Access：配置后后台接口改为校验 Access JWT。 */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Bangumi 同步所需的个人令牌与用户名；未配置时同步直接跳过。 */
  BANGUMI_ACCESS_TOKEN?: string;
  BANGUMI_USERNAME?: string;
  /** GIF → animated WebP 外部服务的 Bearer token；未配置时该接口返回 503。 */
  IMG2WEBP_TOKEN?: string;
}
