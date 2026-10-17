/**
 * 结构化知识注入 — 只做格式化，不做检索。
 */

import 'server-only';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { STAR_DESCRIPTIONS } from '@/lib/ziwei/constants';
import { detectPatterns, getMingGongSummary, type Pattern } from '@/lib/ziwei/patterns';
import {
  MARRIAGE_STARS_BRIEF,
  SIHUA_IN_FUQI_GU,
  STAR_IN_FUQI_GU,
} from '@/lib/ziwei/heming-knowledge';

const LEVEL_LABEL: Record<Pattern['level'], string> = {
  excellent: '上格',
  good: '吉格',
  neutral: '中性',
  caution: '破格/注意',
};

function starBriefs(chart: ZiweiChart): string {
  const present = new Set<string>();
  for (const palace of chart.palaces) {
    for (const star of palace.stars) {
      if (star.type === 'major') present.add(star.name);
    }
  }
  const lines: string[] = [];
  for (const star of present) {
    const info = STAR_DESCRIPTIONS[star];
    if (info) lines.push(`- ${star}：${info.keywords}｜${info.nature}｜${info.element}`);
  }
  return lines.length ? `【主星要点】\n${lines.join('\n')}` : '';
}

function mingGongSummary(chart: ZiweiChart): string {
  const summary = getMingGongSummary(chart);
  if (!summary.stars.length && !summary.keywords.length) return '';
  const parts = [
    summary.stars.length ? `主星 ${summary.stars.join('、')}` : '',
    summary.keywords.length ? `关键词 ${summary.keywords.join('、')}` : '',
    summary.nature ? `性质 ${summary.nature}` : '',
  ].filter(Boolean);
  return parts.length ? `【命宫摘要】\n- ${parts.join('｜')}` : '';
}

function patternsText(chart: ZiweiChart): string {
  const patterns = detectPatterns(chart).slice(0, 8);
  if (!patterns.length) return '';
  const lines = patterns.map(pattern => {
    const parts = [`- ${pattern.name}（${LEVEL_LABEL[pattern.level]}${pattern.palaces.length ? `，${pattern.palaces.join('、')}` : ''}）`];
    if (pattern.description) parts.push(`  含义：${pattern.description}`);
    if (pattern.conditions?.required.length) parts.push(`  成立：${pattern.conditions.required.join('；')}`);
    if (pattern.conditions?.bonus?.length) parts.push(`  加分：${pattern.conditions.bonus.join('；')}`);
    if (pattern.conditions?.breaking?.length) parts.push(`  破格：${pattern.conditions.breaking.join('；')}`);
    if (pattern.source) parts.push(`  出处：${pattern.source}`);
    return parts.join('\n');
  });
  return `【已识别格局】\n${lines.join('\n')}`;
}

function loveTopic(chart: ZiweiChart): string {
  const fuqi = chart.palaces.find(p => p.name === '夫妻');
  const fude = chart.palaces.find(p => p.name === '福德');
  const lines: string[] = [];

  if (fuqi) {
    lines.push(`夫妻宫：${fuqi.stars.map(s => `${s.name}${s.siHua ? `化${s.siHua}` : ''}`).join(' ') || '空宫，借对宫'}`);
    for (const star of fuqi.stars) {
      const info = STAR_IN_FUQI_GU[star.name];
      if (!info) continue;
      lines.push(`- ${star.name}在夫妻：${info.summary}；吉象 ${info.good}；凶象 ${info.bad}；婚期 ${info.timing}`);
      const hua = star.siHua;
      if (hua) {
        const key = `化${hua}` as keyof typeof SIHUA_IN_FUQI_GU;
        if (SIHUA_IN_FUQI_GU[key]) lines.push(`  ${key}：${SIHUA_IN_FUQI_GU[key]}`);
      }
    }
  }

  if (fude) {
    lines.push(`福德宫：${fude.stars.map(s => `${s.name}${s.siHua ? `化${s.siHua}` : ''}`).join(' ') || '空宫，借对宫'}`);
    lines.push('双宫联参：判断婚姻必须夫妻宫与福德宫同看，不能只看夫妻宫。');
  }

  const marriageStars = new Set<string>();
  for (const palace of chart.palaces) {
    for (const star of palace.stars) {
      if (MARRIAGE_STARS_BRIEF[star.name]) marriageStars.add(star.name);
    }
  }
  if (marriageStars.size) {
    lines.push('婚恋星：');
    for (const star of marriageStars) lines.push(`- ${star}：${MARRIAGE_STARS_BRIEF[star]}`);
  }

  return lines.length ? `【感情专题】\n${lines.join('\n')}` : '';
}

export function buildKnowledgeContext(chart: ZiweiChart, topic: TopicKey): string {
  const blocks = [
    starBriefs(chart),
    mingGongSummary(chart),
    patternsText(chart),
  ];
  if (topic === 'love') blocks.push(loveTopic(chart));
  return blocks.filter(Boolean).join('\n\n');
}
