import { z } from 'zod';

/**
 * 站内工具与访问统计的共享契约。
 *
 * - 工具列表存 D1（`tools` 表），前台 /tools 与后台 /admin/tools 读同一份；
 * - 访问量由 Worker 入口写入 `page_views`，后台总览只读最近 30 天聚合。
 */

/** 内置工具面板的 key；前台按 key 渲染对应工作台，自定义工具只有链接。 */
export const builtinToolKeys = [
  'ts',
  'img',
  'md',
  'color',
  'bgm',
  'json',
  'redirect',
  'short',
] as const;

export type BuiltinToolKey = (typeof builtinToolKeys)[number];

/** 工具页地址里的 slug 规则：小写字母 / 数字 / 连字符，例如 timestamp。 */
export const toolSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ToolItem {
  id: string;
  /** 前台工具页地址：/tools/<slug>。 */
  slug: string;
  /** 内置面板 key；自定义链接工具为 null。 */
  toolKey: BuiltinToolKey | null;
  name: string;
  description: string;
  /** 工作台顶部的类型行，例如 “UNIX TIME · 浏览器内换算”。 */
  kind: string;
  /** 搜索关键词，空格分隔。 */
  keywords: string;
  /** 自定义工具的目标地址；内置工具为 null。 */
  href: string | null;
  enabled: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ToolListResponse {
  items: ToolItem[];
}

const toolFields = {
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(toolSlugPattern, 'slug 只能用小写字母、数字和连字符'),
  name: z.string().min(1).max(60),
  description: z.string().max(200),
  kind: z.string().max(80),
  keywords: z.string().max(200),
  toolKey: z.enum(builtinToolKeys).nullable().optional(),
  href: z
    .string()
    .max(300)
    .regex(/^(\/|https?:\/\/)/, '链接需要是站内路径、http(s) 链接或留空')
    .nullable()
    .optional(),
  enabled: z.boolean(),
  position: z.number().int().min(0).max(9999),
};

export const toolInputSchema = z.object({
  ...toolFields,
  description: toolFields.description.default(''),
  kind: toolFields.kind.default(''),
  keywords: toolFields.keywords.default(''),
  enabled: toolFields.enabled.default(true),
  position: toolFields.position.default(0),
});

/** PATCH 必须用没有默认值的基础字段，避免只改一项时把其他字段重置。 */
export const toolPatchSchema = z.object(toolFields).partial();

export type ToolInput = z.infer<typeof toolInputSchema>;
export type ToolPatch = z.infer<typeof toolPatchSchema>;

/** 访问统计的一天。 */
export interface TrafficDay {
  /** YYYY-MM-DD（UTC）。 */
  date: string;
  pv: number;
  uv: number;
}

export type TrafficSummary = {
  /** 按日期升序，含没有访问的 0 值天。 */
  days: TrafficDay[];
  totals: { pv: number; uv: number };
  today: TrafficDay;
};
