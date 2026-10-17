import 'server-only';
import {
  MARRIAGE_STARS_BRIEF,
  SIHUA_IN_FUQI_GU,
  STAR_IN_FUQI_GU,
} from '@/lib/ziwei/heming-knowledge';
import type { SiHua } from '@/lib/ziwei/types';
import type { SourceEntry } from '../types';

const HUA_KEYS: Record<string, SiHua> = {
  化禄: '禄',
  化权: '权',
  化科: '科',
  化忌: '忌',
};

export function loadHemingSources(): SourceEntry[] {
  const entries: SourceEntry[] = [];

  for (const [star, info] of Object.entries(STAR_IN_FUQI_GU)) {
    const text = [
      info.summary,
      `吉象：${info.good}`,
      `凶象：${info.bad}`,
      `配偶特质：${info.spouse_traits}`,
      `婚期：${info.timing}`,
      info.ni_quote ? `倪师原话：${info.ni_quote}` : '',
    ].filter(Boolean).join('\n');
    entries.push({
      id: `heming:star:${star}`,
      kind: 'curated',
      author: '倪海厦',
      work: '《天纪》夫妻宫',
      school: '三合派',
      citation: `天纪·夫妻宫·${star}`,
      text,
      topics: ['love'],
      stars: [star],
      palaces: ['夫妻'],
      patterns: [],
      hua: [],
      weight: 100,
    });
  }

  for (const [key, text] of Object.entries(SIHUA_IN_FUQI_GU)) {
    const hua = HUA_KEYS[key];
    entries.push({
      id: `heming:sihua:${key}`,
      kind: 'curated',
      author: '倪海厦',
      work: '《天纪》夫妻宫四化',
      school: '三合派',
      citation: `天纪·夫妻宫·${key}`,
      text,
      topics: ['love'],
      stars: [],
      palaces: ['夫妻'],
      patterns: [],
      hua: hua ? [hua] : [],
      weight: 100,
    });
  }

  for (const [star, text] of Object.entries(MARRIAGE_STARS_BRIEF)) {
    entries.push({
      id: `heming:marriage-star:${star}`,
      kind: 'curated',
      author: '倪海厦',
      work: '《天纪》婚恋星',
      school: '三合派',
      citation: `天纪·婚恋星·${star}`,
      text,
      topics: ['love'],
      stars: [star],
      palaces: ['夫妻'],
      patterns: [],
      hua: [],
      weight: 95,
    });
  }

  return entries;
}
