/**
 * 命理检索词表 — 星名 / 宫名 / 四化 / 主题别名
 *
 * 只做本仓库需要的确定性映射，不承诺覆盖所有流派叫法。
 */

import 'server-only';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import { BRANCHES, STEMS } from '@/lib/ziwei/constants';

export const STAR_NAMES = [
  '紫微', '天机', '太阳', '武曲', '天同', '廉贞', '天府',
  '太阴', '贪狼', '巨门', '天相', '天梁', '七杀', '破军',
] as const;

export const SIX_SHA = ['擎羊', '陀罗', '火星', '铃星', '地空', '地劫'] as const;

export const MARRIAGE_STARS = [
  '红鸾', '天喜', '天姚', '咸池', '孤辰', '寡宿', '天哭', '天虚', '天巫',
] as const;

/** 问题里常见的宫位别名 → 盘上宫名 */
export const PALACE_ALIASES: Record<string, string> = {
  事业: '官禄', 工作: '官禄', 职业: '官禄',
  交友: '仆役', 朋友: '仆役', 人际: '仆役',
  家庭: '田宅', 房产: '田宅', 置业: '田宅',
  健康: '疾厄', 身体: '疾厄',
  精神: '福德', 心态: '福德', 内心: '福德',
  外出: '迁移', 异地: '迁移', 出国: '迁移', 搬家: '迁移',
  长辈: '父母',
  合伙: '兄弟', 兄弟: '兄弟',
  感情: '夫妻', 婚姻: '夫妻', 恋爱: '夫妻', 桃花: '夫妻',
  命格: '命宫', 整体: '命宫',
};

export const PALACE_NAMES = [
  '命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄',
  '迁移', '仆役', '官禄', '田宅', '福德', '父母',
] as const;

export const SI_HUA_TERMS = ['化禄', '化权', '化科', '化忌', '禄', '权', '科', '忌'] as const;

/** 主题关键词，按优先级从上到下匹配 */
export const TOPIC_KEYWORDS: Record<TopicKey, string[]> = {
  love: ['感情', '婚姻', '夫妻', '恋爱', '桃花', '配偶', '结婚'],
  career: ['事业', '工作', '职业', '升职', '创业', '官禄'],
  wealth: ['财运', '钱', '赚钱', '理财', '投资', '收入', '财帛'],
  health: ['健康', '身体', '疾病', '疾厄', '生病', '体质'],
  children: ['子女', '孩子', '怀孕', '生育'],
  parents: ['父母', '长辈'],
  family: ['兄弟', '姐妹', '合伙'],
  friends: ['朋友', '交友', '人际', '贵人', '小人', '仆役'],
  move: ['迁移', '外出', '异地', '出国', '搬家'],
  home: ['田宅', '房产', '买房', '置业'],
  spirit: ['福德', '精神', '心态', '内心'],
  personality: ['性格', '个性', '脾气'],
  overview: ['命格', '格局', '整体'],
};

const TOPIC_ORDER: TopicKey[] = [
  'love', 'career', 'wealth', 'health', 'children', 'parents',
  'family', 'friends', 'move', 'home', 'spirit', 'personality',
];

const TRAD_MAP: Record<string, string> = {
  宮: '宫', 祿: '禄', 權: '权', 說: '说', 學: '学',
  與: '与', 為: '为', 這: '这', 個: '个', 時: '时',
  間: '间', 發: '发', 現: '现', 關: '关', 係: '系',
};

export function normalizeText(input: string): string {
  let out = input.normalize('NFKC');
  for (const [from, to] of Object.entries(TRAD_MAP)) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function clampText(input: string, max = 8000): string {
  const normalized = normalizeText(input);
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

export function inferTopic(text: string): TopicKey {
  const normalized = normalizeText(text);
  for (const topic of TOPIC_ORDER) {
    if (TOPIC_KEYWORDS[topic].some(kw => normalized.includes(kw))) return topic;
  }
  return 'overview';
}

/** 从问题中提取 1900–2100 的年份，多个取最后一个。 */
export function extractYear(text: string): number | null {
  const matches = normalizeText(text).match(/(?:19|20)\d{2}/g);
  if (!matches?.length) return null;
  const value = Number(matches[matches.length - 1]);
  return value >= 1900 && value <= 2100 ? value : null;
}

function pushUnique(list: string[], value: string) {
  if (value && !list.includes(value)) list.push(value);
}

/** 提取问题中出现的命理词，用于检索。 */
export function extractQueryTerms(text: string): string[] {
  const normalized = normalizeText(text);
  const terms: string[] = [];

  for (const star of STAR_NAMES) {
    if (normalized.includes(star)) pushUnique(terms, star);
  }
  for (const palace of PALACE_NAMES) {
    if (normalized.includes(palace) || normalized.includes(`${palace}宫`)) pushUnique(terms, palace);
  }
  for (const [alias, palace] of Object.entries(PALACE_ALIASES)) {
    if (normalized.includes(alias)) pushUnique(terms, palace);
  }
  for (const term of ['化禄', '化权', '化科', '化忌']) {
    if (normalized.includes(term)) pushUnique(terms, term.slice(1));
  }
  for (const star of MARRIAGE_STARS) {
    if (normalized.includes(star)) pushUnique(terms, star);
  }
  for (const star of SIX_SHA) {
    if (normalized.includes(star)) pushUnique(terms, star);
  }
  return terms;
}

export function branchName(index: number): string {
  return BRANCHES[index] ?? '?';
}

export function stemName(index: number): string {
  return STEMS[index] ?? '?';
}
