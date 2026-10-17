import type { TopicKey } from '@/lib/ziwei/db-analysis';
import type { SiHua } from '@/lib/ziwei/types';
import { PALACE_NAMES, STAR_NAMES, inferTopic, normalizeText } from '../vocab';

export interface TextTags {
  stars: string[];
  palaces: string[];
  hua: SiHua[];
}

export function tagText(text: string): TextTags {
  const normalized = normalizeText(text);
  const stars = STAR_NAMES.filter(name => normalized.includes(name));
  const palaces = PALACE_NAMES.filter(name => normalized.includes(name) || normalized.includes(`${name}宫`));
  const hua: SiHua[] = [];
  if (normalized.includes('化禄') || normalized.includes('禄')) hua.push('禄');
  if (normalized.includes('化权') || normalized.includes('权')) hua.push('权');
  if (normalized.includes('化科') || normalized.includes('科')) hua.push('科');
  if (normalized.includes('化忌') || normalized.includes('忌')) hua.push('忌');
  return { stars, palaces, hua };
}

export function defaultTopics(text: string, fallback: TopicKey[]): TopicKey[] {
  const topic = inferTopic(text);
  return topic === 'overview' && !text.includes('命格') && !text.includes('格局')
    ? fallback
    : [topic, ...fallback.filter(t => t !== topic)];
}
