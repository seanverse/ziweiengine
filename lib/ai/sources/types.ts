import type { TopicKey } from '@/lib/ziwei/db-analysis';
import type { SiHua } from '@/lib/ziwei/types';

export type SourceKind = 'classic' | 'lecture' | 'curated';

export interface SourceEntry {
  id: string;
  kind: SourceKind;
  author?: string;
  work: string;
  school?: string;
  citation: string;
  text: string;
  url?: string;
  topics: TopicKey[];
  stars: string[];
  palaces: string[];
  patterns: string[];
  hua: SiHua[];
  weight: number;
}

/** 发给前端的摘要，不包含全文。 */
export interface SourceItem {
  id: string;
  kind: SourceKind;
  author?: string;
  work: string;
  school?: string;
  citation: string;
  snippet: string;
  url?: string;
}
