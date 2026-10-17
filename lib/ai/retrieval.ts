/**
 * 统一检索 — 古籍、天纪语料、倪海厦策展知识、夫妻宫常量。
 *
 * 确定性排序，配额固定，结果可复现。
 */

import 'server-only';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import { TOPIC_PALACE_NAME } from '@/lib/ziwei/db-analysis';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { detectPatterns } from '@/lib/ziwei/patterns';
import { getAllSources } from './sources/registry';
import type { SourceEntry, SourceItem } from './sources/types';
import { STAR_NAMES, extractQueryTerms, normalizeText } from './vocab';

export interface RetrievalResult {
  entries: SourceEntry[];
  sources: SourceItem[];
}

const TOPIC_FOCUS: Record<TopicKey, string[]> = {
  overview: ['命宫', '财帛', '官禄', '迁移', '福德'],
  personality: ['命宫', '福德', '迁移'],
  love: ['夫妻', '福德'],
  career: ['官禄', '命宫', '财帛', '迁移'],
  wealth: ['财帛', '田宅', '命宫', '官禄'],
  health: ['疾厄', '命宫', '福德'],
  family: ['兄弟', '命宫'],
  children: ['子女', '命宫'],
  parents: ['父母', '命宫'],
  move: ['迁移', '命宫'],
  friends: ['仆役', '命宫'],
  home: ['田宅', '命宫'],
  spirit: ['福德', '命宫'],
};

function chartTerms(chart: ZiweiChart, topic: TopicKey): string[] {
  const terms = new Set<string>();
  const focus = TOPIC_FOCUS[topic];
  const focusPalaces = chart.palaces.filter(p => focus.includes(p.name));

  for (const palace of focusPalaces) {
    for (const star of palace.stars) {
      if ((STAR_NAMES as readonly string[]).includes(star.name)) terms.add(star.name);
    }
  }
  for (const pattern of detectPatterns(chart)) {
    if (pattern.palaces.some(name => focus.includes(name))) terms.add(pattern.name);
  }
  return [...terms];
}

function topicTerms(topic: TopicKey): string[] {
  const palace = TOPIC_PALACE_NAME[topic];
  const terms = [palace];
  if (topic === 'love') terms.push('福德', '夫妻');
  return terms;
}

function allowed(entry: SourceEntry, topic: TopicKey): boolean {
  if (entry.id.startsWith('tianji:08-')) return false;
  if (entry.id.startsWith('tianji:10-')) return false;
  if (entry.id.startsWith('tianji:11-')) return false;
  if (entry.id.startsWith('tianji:05-') && topic !== 'health') return false;
  if (entry.topics.includes('love') && !entry.topics.some(t => t !== 'love') && topic !== 'love') {
    // 纯婚恋条目只在感情主题出现
    return false;
  }
  return true;
}

function scoreEntry(
  entry: SourceEntry,
  terms: string[],
  topic: TopicKey,
): number {
  const normalizedText = normalizeText(entry.text);
  let score = 0;
  const matched = new Set<string>();

  for (const term of terms) {
    if (entry.stars.includes(term)) { score += 6; matched.add(term); }
    if (entry.palaces.includes(term)) { score += 5; matched.add(term); }
    if (entry.patterns.some(p => p.includes(term))) { score += 4; matched.add(term); }
    if (entry.hua.some(h => term === h || term === `化${h}`)) { score += 3; matched.add(term); }
    if (entry.text.includes(term)) { score += 1; matched.add(term); }
  }

  if (entry.topics.includes(topic)) score += 4;
  if (matched.size === 0 && !entry.topics.includes(topic)) return 0;
  return score + entry.weight / 100;
}

function snippet(text: string): string {
  const normalized = normalizeText(text).replace(/\s+/g, ' ');
  return normalized.length > 160 ? `${normalized.slice(0, 157)}…` : normalized;
}

function bigrams(text: string): Set<string> {
  const normalized = normalizeText(text).replace(/[\s，。、；：！？「」『』（）()《》·,.;:!?]/g, '');
  const set = new Set<string>();
  for (let i = 0; i + 1 < normalized.length; i++) set.add(normalized.slice(i, i + 2));
  return set;
}

function tooSimilar(text: string, chosen: SourceEntry[]): boolean {
  const current = bigrams(text);
  if (current.size === 0) return false;
  for (const entry of chosen) {
    const other = bigrams(entry.text);
    let overlap = 0;
    for (const gram of current) if (other.has(gram)) overlap++;
    const union = current.size + other.size - overlap;
    if (union > 0 && overlap / union > 0.55) return true;
  }
  return false;
}

export function retrieveSources(
  chart: ZiweiChart,
  question: string,
  topic: TopicKey,
): RetrievalResult {
  const termSet = new Set<string>([
    ...extractQueryTerms(question),
    ...topicTerms(topic),
    ...chartTerms(chart, topic),
  ]);
  const terms = [...termSet];

  const scored = getAllSources()
    .filter(entry => allowed(entry, topic))
    .map(entry => ({ entry, score: scoreEntry(entry, terms, topic) }))
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.entry.weight !== a.entry.weight) return b.entry.weight - a.entry.weight;
      return a.entry.id.localeCompare(b.entry.id);
    });

  const perWork = new Map<string, number>();
  const seenText = new Set<string>();
  const chosen: SourceEntry[] = [];
  let chars = 0;

  for (const { entry } of scored) {
    if (chosen.length >= 8 || chars >= 1200) break;
    const workCount = perWork.get(entry.work) ?? 0;
    if (workCount >= 2) continue;
    const textKey = normalizeText(entry.text);
    if (seenText.has(textKey)) continue;
    if (chars + textKey.length > 1400) continue;
    if (tooSimilar(textKey, chosen)) continue;

    seenText.add(textKey);
    perWork.set(entry.work, workCount + 1);
    chosen.push(entry);
    chars += textKey.length;
  }

  const sources: SourceItem[] = chosen.map(entry => ({
    id: entry.id,
    kind: entry.kind,
    author: entry.author,
    work: entry.work,
    school: entry.school,
    citation: entry.citation,
    snippet: snippet(entry.text),
    url: entry.url,
  }));

  return { entries: chosen, sources };
}

export function formatSourcesForPrompt(entries: SourceEntry[]): string {
  if (!entries.length) return '';
  const lectures: string[] = [];
  const classics: string[] = [];
  const curated: string[] = [];

  for (const entry of entries) {
    const line = `- 〔${entry.citation}〕${normalizeText(entry.text)}`;
    if (entry.kind === 'classic') classics.push(line);
    else if (entry.kind === 'lecture') lectures.push(line);
    else curated.push(line);
  }

  const blocks: string[] = [];
  if (lectures.length) blocks.push(`【倪师原话】\n${lectures.join('\n')}`);
  if (classics.length) blocks.push(`【古籍参考】\n${classics.join('\n')}`);
  if (curated.length) blocks.push(`【体系资料】\n${curated.join('\n')}`);
  return blocks.join('\n\n');
}
