export const bangumiSubjectTypes = [
  'anime',
  'book',
  'music',
  'game',
  'real',
] as const;
export type BangumiSubjectType = (typeof bangumiSubjectTypes)[number];

export const bangumiSubjectTypeLabels: Record<BangumiSubjectType, string> = {
  anime: '动画',
  book: '书籍',
  music: '音乐',
  game: '游戏',
  real: '三次元',
};

export type BangumiStatus = 'watching' | 'watched' | 'wish' | 'paused';

export interface BangumiShow {
  id: string;
  subjectType: BangumiSubjectType;
  bangumiId: number | null;
  title: string;
  status: BangumiStatus;
  totalEps: number;
  watchedEps: number;
  score: number | null;
  /** 我在 Bangumi 写的简评。 */
  comment: string | null;
  /** Bangumi 原图 URL；同步封面时用来判断是否需要更新。 */
  coverSource: string | null;
  /** 下一话放送时间（ISO）。同步从 Bangumi 放送日历只拿到星期几时，记当天 00:00（UTC+8），前端只显示星期。 */
  nextAirAt: string | null;
  coverKey: string | null;
  updatedAt: string;
}
