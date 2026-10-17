import 'server-only';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import corpus from '../../data/tianji-corpus.json';
import type { SourceEntry } from '../types';
import { tagText } from '../tagger';

interface CorpusRow {
  book: string;
  h2: string;
  h3: string;
  quote: string;
  section: number;
  t_hms: string;
  note: string;
  bvid: string;
  part: number;
}

const ROWS = (corpus as { entries: CorpusRow[] }).entries;

const BOOK_TOPICS: Record<string, TopicKey[]> = {
  '01-stars': ['personality', 'overview', 'love', 'career', 'wealth'],
  '02-palaces': ['overview', 'love', 'career', 'wealth', 'health', 'family', 'children', 'parents', 'friends', 'move', 'home', 'spirit'],
  '03-patterns': ['overview', 'personality', 'career'],
  '04-sihua': ['overview', 'love', 'career', 'wealth', 'spirit'],
  '05-illness': ['health'],
  '07-methodology': ['overview', 'personality'],
};

const PALACE_TOPICS: Record<string, TopicKey[]> = {
  夫妻: ['love'],
  福德: ['love', 'spirit'],
  官禄: ['career'],
  财帛: ['wealth'],
  田宅: ['home', 'wealth'],
  疾厄: ['health'],
  迁移: ['move'],
  子女: ['children'],
  父母: ['parents'],
  兄弟: ['family'],
  仆役: ['friends'],
  交友: ['friends'],
  命宫: ['overview', 'personality'],
};

const BOOK_WEIGHT: Record<string, number> = {
  '01-stars': 100,
  '02-palaces': 100,
  '03-patterns': 100,
  '04-sihua': 100,
  '05-illness': 90,
  '07-methodology': 85,
};

function toSeconds(hms: string): number {
  const [h, m, s] = hms.split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

function topicsForRow(row: CorpusRow): TopicKey[] {
  if (row.book === '02-palaces') {
    for (const [palace, topics] of Object.entries(PALACE_TOPICS)) {
      if (row.h2.includes(palace)) return topics;
    }
  }
  return BOOK_TOPICS[row.book] ?? ['overview'];
}

export function loadTianjiSources(): SourceEntry[] {
  return ROWS.map(row => {
    const text = [row.h2, row.h3, row.quote].filter(Boolean).join(' · ');
    const tags = tagText(text);
    const patternTag = row.book === '03-patterns' && row.h3 ? row.h3.replace(/^\d+\.\s*/, '') : '';
    return {
      id: `tianji:${row.book}:${row.part}:${row.t_hms}:${row.section}`,
      kind: 'lecture',
      author: '倪海厦',
      work: '《天纪》',
      school: '三合派',
      citation: `《天纪》第 ${row.part} 讲 ${row.t_hms}`,
      text,
      url: `https://www.bilibili.com/video/${row.bvid}?p=${row.part}&t=${toSeconds(row.t_hms)}`,
      topics: topicsForRow(row),
      stars: tags.stars,
      palaces: tags.palaces,
      patterns: patternTag ? [patternTag] : [],
      hua: tags.hua,
      weight: BOOK_WEIGHT[row.book] ?? 80,
    };
  });
}
