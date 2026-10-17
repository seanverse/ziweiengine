import 'server-only';
import { TIANJI_MODULES, TIANJI_QUOTES } from '@/lib/nihai';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import type { SourceEntry } from '../types';
import { defaultTopics, tagText } from '../tagger';

const ZIWEI_TOPICS: TopicKey[] = ['overview', 'personality', 'love', 'career', 'wealth'];

export function loadNihaiSources(): SourceEntry[] {
  const entries: SourceEntry[] = [];

  for (const module of TIANJI_MODULES) {
    if (module.id !== 'tj-ziwei') continue;
    module.details.forEach((detail, idx) => {
      const tags = tagText(detail);
      entries.push({
        id: `nihai:module:${idx}`,
        kind: 'curated',
        author: '倪海厦',
        work: '《天纪》紫微斗数',
        school: '三合派',
        citation: `天纪·${module.name}`,
        text: detail,
        topics: defaultTopics(detail, ZIWEI_TOPICS),
        stars: tags.stars,
        palaces: tags.palaces,
        patterns: [],
        hua: tags.hua,
        weight: 80,
      });
    });

  }

  TIANJI_QUOTES.forEach((quote, idx) => {
    const tags = tagText(quote.text);
    entries.push({
      id: `nihai:quote:${idx}`,
      kind: 'curated',
      author: '倪海厦',
      work: '《天纪》语录',
      school: '三合派',
      citation: `天纪语录·${quote.topic}`,
      text: quote.text,
      topics: defaultTopics(quote.text, ['overview']),
      stars: tags.stars,
      palaces: tags.palaces,
      patterns: [],
      hua: tags.hua,
      weight: 80,
    });
  });

  return entries;
}
