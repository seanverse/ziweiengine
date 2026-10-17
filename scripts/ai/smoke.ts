/**
 * AI 上下文冒烟测试（不调用模型）。
 *
 * 运行：node --conditions=react-server --import tsx scripts/ai/smoke.ts
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateChart } from '../../lib/ziwei/algorithm';
import { buildChartContext } from '../../lib/ai/chart-context';
import { buildKnowledgeContext } from '../../lib/ai/knowledge';
import { retrieveSources } from '../../lib/ai/retrieval';
import { chartFingerprint } from '../../lib/ai/fingerprint';
import { buildHemingContext } from '../../lib/ai/heming-context';

let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) {
    console.log(`✅ ${name}`);
  } else {
    failed += 1;
    console.error(`❌ ${name}`);
  }
}

const chart = generateChart({ year: 1990, month: 5, day: 17, hour: 6, gender: 'male' });
const chartB = generateChart({ year: 1992, month: 8, day: 3, hour: 4, gender: 'female' });

const facts = buildChartContext(chart, { liunianYear: 2026 });
check('事实层包含十二宫', (facts.match(/^- .+\(/gm) ?? []).length >= 12);
check('事实层无「命宫宫」', !facts.includes('命宫宫'));
check('事实层含流年干支', /丙午年/.test(facts));
check('事实层不含姓名字段', !facts.includes('name'));
check('事实层含财位与财库', facts.includes('财位') && facts.includes('财库'));
check('事实层含吉星/煞星落宫', facts.includes('吉星落宫') && facts.includes('煞星落宫'));
check('事实层含地支方位', /[(（](北|南|东|西|东北|东南|西南|西北)/.test(facts));

const knowledge = buildKnowledgeContext(chart, 'love');
check('感情专题包含夫妻宫', knowledge.includes('夫妻宫'));
check('感情专题包含双宫联参', knowledge.includes('双宫联参'));

const retrieval = retrieveSources(chart, '我的感情婚姻运势如何？', 'love');
check('检索结果不超过 8 条', retrieval.entries.length <= 8);
check('检索结果带出处', retrieval.sources.every(s => s.citation.length > 0));
check('检索结果覆盖多个来源', new Set(retrieval.entries.map(e => e.work)).size >= 2);

const named = { ...chart, birthInfo: { ...chart.birthInfo, name: '测试', city: '北京' } };
check('姓名不影响指纹', chartFingerprint(chart) === chartFingerprint(named));

const heming = buildHemingContext(chart, chartB);
check('合盘包含双方命盘', heming.includes('【甲方命盘】') && heming.includes('【乙方命盘】'));
check('合盘包含四化飞入', heming.includes('四化飞入对方'));

const corpusRaw = readFileSync('docs/tianji-ziwei/entries.jsonl', 'utf8');
const corpus = JSON.parse(readFileSync('lib/ai/data/tianji-corpus.json', 'utf8')) as {
  count: number;
  sourceSha256: string;
};
check('语料条数与源文件一致', corpus.count === corpusRaw.trim().split('\n').length);
check(
  '语料与源文件校验和一致',
  corpus.sourceSha256 === createHash('sha256').update(corpusRaw).digest('hex'),
);

if (failed) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\nAI 冒烟测试通过');
