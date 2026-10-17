/**
 * 合盘确定性事实 — 两张盘之间可机械计算的部分。
 */

import 'server-only';
import type { Palace, Star, ZiweiChart } from '@/lib/ziwei/types';
import { STAR_DESCRIPTIONS } from '@/lib/ziwei/constants';
import { HEMING_SCORE_CRITERIA } from '@/lib/ziwei/heming-knowledge';
import { branchName } from './vocab';
import { buildChartContext } from './chart-context';

function findPalace(chart: ZiweiChart, name: string): Palace | undefined {
  return chart.palaces.find(p => p.name === name);
}

function majorNames(palace?: Palace): string[] {
  const direct = palace?.stars.filter(s => s.type === 'major').map(s => s.name) ?? [];
  if (direct.length) return direct;
  return palace?.borrowedStars ?? [];
}

function palaceLabel(name: string): string {
  return name.endsWith('宫') ? name : `${name}宫`;
}

function starLocations(chart: ZiweiChart, starName: string): Palace[] {
  return chart.palaces.filter(p => p.stars.some(s => s.name === starName));
}

function starIn(chart: ZiweiChart, starName: string): Star | undefined {
  for (const palace of chart.palaces) {
    const star = palace.stars.find(s => s.name === starName);
    if (star) return star;
  }
  return undefined;
}

function siHuaStars(chart: ZiweiChart): { star: string; hua: string; palace: string }[] {
  const out: { star: string; hua: string; palace: string }[] = [];
  for (const palace of chart.palaces) {
    for (const star of palace.stars) {
      if (star.siHua) out.push({ star: star.name, hua: star.siHua, palace: palace.name });
    }
  }
  return out;
}

function crossSiHua(source: ZiweiChart, target: ZiweiChart, label: string): string[] {
  const lines: string[] = [];
  for (const item of siHuaStars(source)) {
    const palaces = starLocations(target, item.star).map(p => palaceLabel(p.name));
    if (palaces.length) {
      lines.push(`- ${label} 的 ${item.star}化${item.hua} 落在对方 ${palaces.join('、')}`);
    }
  }
  return lines;
}

const ELEMENT_GENERATES: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
const ELEMENT_OVERCOMES: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

function mingElement(chart: ZiweiChart): string {
  const ming = findPalace(chart, '命宫');
  const star = ming?.stars.find(s => s.type === 'major');
  return star ? STAR_DESCRIPTIONS[star.name]?.element ?? '' : '';
}

function elementRelation(a: string, b: string): string {
  if (!a || !b) return '未知';
  if (a === b) return '同属性';
  if (ELEMENT_GENERATES[a] === b) return `${a}生${b}`;
  if (ELEMENT_GENERATES[b] === a) return `${b}生${a}`;
  if (ELEMENT_OVERCOMES[a] === b) return `${a}克${b}`;
  if (ELEMENT_OVERCOMES[b] === a) return `${b}克${a}`;
  return '无直接生克';
}

function keyPalaceLine(chart: ZiweiChart, name: string): string {
  const palace = findPalace(chart, name);
  if (!palace) return `${name}：未知`;
  const stars = palace.stars
    .filter(s => s.type === 'major' || s.siHua)
    .map(s => `${s.name}${s.brightnessRaw ? `(${s.brightnessRaw})` : ''}${s.siHua ? `化${s.siHua}` : ''}`)
    .join(' ') || '无主星';
  return `${name}（${branchName(palace.branch)}）：${stars}`;
}

function sunMoon(chart: ZiweiChart, gender: 'male' | 'female'): string {
  const target = gender === 'female' ? '太阳' : '太阴';
  const star = starIn(chart, target);
  const palace = star ? starLocations(chart, target)[0] : undefined;
  const role = gender === 'female' ? '夫星' : '妻星';
  if (!star || !palace) return `${role}${target}：未找到`;
  return `${role}${target}：${palace.name}宫${star.brightnessRaw ? `、${star.brightnessRaw}` : ''}${star.siHua ? `、化${star.siHua}` : ''}`;
}

export function buildHemingContext(chartA: ZiweiChart, chartB: ZiweiChart): string {
  const aMing = majorNames(findPalace(chartA, '命宫'));
  const bMing = majorNames(findPalace(chartB, '命宫'));
  const aFuqi = majorNames(findPalace(chartA, '夫妻'));
  const bFuqi = majorNames(findPalace(chartB, '夫妻'));
  const aFude = majorNames(findPalace(chartA, '福德'));
  const bFude = majorNames(findPalace(chartB, '福德'));

  const matchAtoB = aFuqi.some(star => bMing.includes(star));
  const matchBtoA = bFuqi.some(star => aMing.includes(star));

  const lines: string[] = [];

  lines.push('【甲方命盘】');
  lines.push(buildChartContext(chartA, { view: 'mingpan' }));
  lines.push('【乙方命盘】');
  lines.push(buildChartContext(chartB, { view: 'mingpan' }));

  lines.push('【合盘关键事实】');
  lines.push(`甲方命宫主星：${aMing.join('、') || '无'}｜夫妻宫：${aFuqi.join('、') || '无'}｜福德宫：${aFude.join('、') || '无'}`);
  lines.push(`乙方命宫主星：${bMing.join('、') || '无'}｜夫妻宫：${bFuqi.join('、') || '无'}｜福德宫：${bFude.join('、') || '无'}`);
  lines.push(`甲方夫妻宫主星是否对应乙方命宫主星：${matchAtoB ? '是' : '否'}`);
  lines.push(`乙方夫妻宫主星是否对应甲方命宫主星：${matchBtoA ? '是' : '否'}`);
  lines.push(keyPalaceLine(chartA, '命宫'));
  lines.push(keyPalaceLine(chartB, '命宫'));
  lines.push(sunMoon(chartA, chartA.birthInfo.gender));
  lines.push(sunMoon(chartB, chartB.birthInfo.gender));

  const elementA = mingElement(chartA);
  const elementB = mingElement(chartB);
  lines.push(`命宫星性五行：甲方 ${elementA || '未知'}｜乙方 ${elementB || '未知'}｜关系：${elementRelation(elementA, elementB)}`);

  lines.push('四化飞入对方：');
  const cross = [
    ...crossSiHua(chartA, chartB, '甲方'),
    ...crossSiHua(chartB, chartA, '乙方'),
  ];
  lines.push(cross.length ? cross.join('\n') : '- 无生年四化飞入对方命盘');

  lines.push('【评分标准】');
  for (const [score, desc] of Object.entries(HEMING_SCORE_CRITERIA)) {
    lines.push(`- ${score}：${desc}`);
  }

  return lines.join('\n');
}
