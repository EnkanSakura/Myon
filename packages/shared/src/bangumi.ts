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
  nextAirAt: string | null;
  coverKey: string | null;
  updatedAt: string;
}
