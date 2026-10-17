import type { NextRequest } from 'next/server';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { HEMING_METHODOLOGY } from '@/lib/ziwei/heming-knowledge';
import { buildHemingContext } from '@/lib/ai/heming-context';
import { buildChatMessages } from '@/lib/ai/prompt';
import { PROMPT_VERSION } from '@/lib/ai/prompts';
import { DETAIL_PARAMS, getProvider, ProviderConfigError } from '@/lib/ai/provider';
import { checkRateLimit, clientIp } from '@/lib/ai/rate-limit';
import { retrieveSources, formatSourcesForPrompt } from '@/lib/ai/retrieval';
import { chartFingerprint, questionHash } from '@/lib/ai/fingerprint';
import { cacheGetJson, cacheSetJson, CACHE_TTL } from '@/lib/ai/cache';
import { createSSEStream } from '@/lib/ai/stream';
import type { SourceEntry, SourceItem } from '@/lib/ai/sources/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface HemingBody {
  chartA?: ZiweiChart;
  chartB?: ZiweiChart;
  question?: string;
}

const MAX_BODY = 256 * 1024;
const MAX_QUESTION = 2000;

function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

function validChart(value: unknown): value is ZiweiChart {
  return !!value
    && typeof value === 'object'
    && Array.isArray((value as ZiweiChart).palaces)
    && typeof (value as ZiweiChart).birthInfo === 'object';
}

export async function POST(request: NextRequest): Promise<Response> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY) return jsonError(413, 'invalid_request', '请求体过大');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', '请求体不是合法 JSON');
  }

  const body = raw as HemingBody;
  if (!validChart(body.chartA) || !validChart(body.chartB)) {
    return jsonError(400, 'invalid_request', '缺少合盘命盘');
  }

  const question = (body.question ?? '请分析两人的合盘匹配度、相处模式与注意事项。')
    .trim()
    .slice(0, MAX_QUESTION);
  if (!question) return jsonError(400, 'invalid_request', '缺少问题');

  let provider;
  try {
    provider = getProvider();
  } catch (error) {
    if (error instanceof ProviderConfigError) return jsonError(503, 'not_configured', 'AI 服务未配置');
    throw error;
  }

  const fpA = chartFingerprint(body.chartA);
  const fpB = chartFingerprint(body.chartB);
  const pairFp = `heming:${fpA}:${fpB}`;

  const rate = await checkRateLimit(clientIp(request.headers), pairFp);
  if (!rate.allowed) {
    return jsonError(rate.code === 'budget_exhausted' ? 503 : 429, rate.code, rate.message, {
      retryAfter: rate.retryAfter,
    });
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const factsKey = `ai:heming:facts:v1:${pairFp}:${today}`;
  let facts = await cacheGetJson<string>(factsKey);
  if (!facts) {
    facts = buildHemingContext(body.chartA, body.chartB);
    await cacheSetJson(factsKey, facts, CACHE_TTL.facts);
  }

  const qHash = questionHash(question);
  const retrievalKey = `ai:heming:ret:v1:${pairFp}:${qHash}:${PROMPT_VERSION}`;
  let retrieval = await cacheGetJson<{ entries: SourceEntry[]; sources: SourceItem[] }>(retrievalKey);
  if (!retrieval) {
    const a = retrieveSources(body.chartA, question, 'love');
    const b = retrieveSources(body.chartB, question, 'love');
    const seen = new Set<string>();
    const entries: SourceEntry[] = [];
    for (const entry of [...a.entries, ...b.entries]) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
      if (entries.length >= 8) break;
    }
    retrieval = {
      entries,
      sources: [...a.sources, ...b.sources].filter((source, idx, all) =>
        all.findIndex(s => s.id === source.id) === idx).slice(0, 8),
    };
    await cacheSetJson(retrievalKey, retrieval, CACHE_TTL.retrieval);
  }

  const answerKey = `ai:heming:ans:v1:${pairFp}:${qHash}:${PROMPT_VERSION}:${provider.model}:${today}`;
  const cached = await cacheGetJson<{ text: string; sources: SourceItem[] }>(answerKey);
  if (cached?.text) {
    return new Response(replay(cached.text, cached.sources, provider.model), {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Cache': 'hit',
      },
    });
  }

  const messages = buildChatMessages({
    chartContext: facts,
    knowledge: HEMING_METHODOLOGY,
    retrieval: formatSourcesForPrompt(retrieval.entries),
    topic: 'love',
    detail: 'standard',
    history: [{ role: 'user', content: question }],
    question,
    limits: { chart: 5000, knowledge: 5000, retrieval: 1900 },
  });

  const params = DETAIL_PARAMS.standard;
  const stream = createSSEStream({
    client: provider.client,
    model: provider.model,
    messages,
    sources: retrieval.sources,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    promptVersion: PROMPT_VERSION,
    signal: request.signal,
    onComplete: async text => {
      await cacheSetJson(answerKey, { text, sources: retrieval.sources }, CACHE_TTL.answer);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Cache': 'miss',
    },
  });
}

function replay(text: string, sources: SourceItem[], model: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      if (sources.length) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`));
      }
      for (let i = 0; i < text.length; i += 240) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text: text.slice(i, i + 240) } })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'meta', model, promptVersion: PROMPT_VERSION, cached: true })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}
