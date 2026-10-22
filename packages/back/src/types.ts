import type { D1Database, Fetcher, R2Bucket } from '@cloudflare/workers-types';

/** Worker 原生绑定；web 的 wrangler 生成的 Env 在运行时与它结构一致。 */
export interface AppBindings {
  DB: D1Database;
  MEDIA: R2Bucket;
  /** 静态资产；媒体路由用它回退到随仓库发布的图片。 */
  ASSETS?: Fetcher;
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
}
