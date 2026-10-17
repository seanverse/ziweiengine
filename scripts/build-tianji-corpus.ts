/**
 * 构建天纪语料 JSON。
 *
 * 输入：docs/tianji-ziwei/entries.jsonl
 * 输出：lib/ai/data/tianji-corpus.json
 *
 * 该产物入库，运行时不读 docs/，避免 Vercel 部署漏文件。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = process.cwd();
const SOURCE = join(ROOT, 'docs/tianji-ziwei/entries.jsonl');
const TARGET = join(ROOT, 'lib/ai/data/tianji-corpus.json');

interface CorpusEntry {
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

const raw = readFileSync(SOURCE, 'utf8');
const lines = raw.trim().split('\n');
const entries: CorpusEntry[] = lines.map((line, idx) => {
  const parsed = JSON.parse(line) as CorpusEntry;
  for (const key of ['book', 'h2', 'quote', 't_hms', 'bvid'] as const) {
    if (typeof parsed[key] !== 'string') {
      throw new Error(`entries.jsonl:${idx + 1} missing ${key}`);
    }
  }
  if (!Number.isInteger(parsed.part) || !Number.isInteger(parsed.section)) {
    throw new Error(`entries.jsonl:${idx + 1} invalid section/part`);
  }
  return {
    book: parsed.book,
    h2: parsed.h2.normalize('NFKC').trim(),
    h3: (parsed.h3 ?? '').normalize('NFKC').trim(),
    quote: parsed.quote.normalize('NFKC').replace(/\s+/g, ' ').trim(),
    section: parsed.section,
    t_hms: parsed.t_hms,
    note: parsed.note ?? '',
    bvid: parsed.bvid,
    part: parsed.part,
  };
});

const payload = {
  kind: 'tianji-corpus',
  version: 1,
  count: entries.length,
  source: 'docs/tianji-ziwei/entries.jsonl',
  sourceSha256: createHash('sha256').update(raw).digest('hex'),
  entries,
};

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`wrote ${TARGET}: ${entries.length} entries`);
