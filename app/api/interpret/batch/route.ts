import type { NextRequest } from 'next/server';
import type OpenAI from 'openai';
import type { SiHua, ZiweiChart } from '@/lib/ziwei/types';
import { buildChartContext, type TimeView } from '@/lib/ai/chart-context';
import { buildKnowledgeContext } from '@/lib/ai/knowledge';
import { buildChatMessages } from '@/lib/ai/prompt';
import {
  BATCH_TOPICS,
  PROMPT_VERSION,
  type BatchTopic,
} from '@/lib/ai/prompts';
import { TOPIC_QUESTIONS } from '@/lib/ai/topic-questions';
import { retrieveSources, formatSourcesForPrompt } from '@/lib/ai/retrieval';
import { DETAIL_PARAMS, getProvider, ProviderConfigError, type ProviderConfig } from '@/lib/ai/provider';
import { checkRateLimit, clientIp } from '@/lib/ai/rate-limit';
import { chartFingerprint } from '@/lib/ai/fingerprint';
import { cacheGetJson, cacheSetJson, CACHE_TTL } from '@/lib/ai/cache';
import type { SourceItem } from '@/lib/ai/sources/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface BatchContext {
  view?: TimeView;
  liunianYear?: number;
  palaceName?: string;
  palaceBranch?: number;
  siHua?: { starName: string; hua: SiHua; view: 'daxian' | 'liunian' };
}

interface BatchBody {
  chart?: ZiweiChart;
  context?: BatchContext;
  refresh?: boolean;
}

interface SectionResult {
  text: string;
  sources: SourceItem[];
}

interface BatchCache {
  sections: Partial<Record<BatchTopic, SectionResult>>;
}

const VIEWS: TimeView[] = ['mingpan', 'daxian', 'liunian'];
const HUA: SiHua[] = ['禄', '权', '科', '忌'];

function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

function normalizeContext(context: BatchContext = {}): BatchContext {
  return {
    view: context.view && VIEWS.includes(context.view) ? context.view : undefined,
    liunianYear: Number.isInteger(context.liunianYear) && context.liunianYear! >= 1900 && context.liunianYear! <= 2100
      ? context.liunianYear
      : undefined,
    palaceName: typeof context.palaceName === 'string' ? context.palaceName.slice(0, 20) : undefined,
    palaceBranch: Number.isInteger(context.palaceBranch) ? context.palaceBranch : undefined,
    siHua: context.siHua && typeof context.siHua.starName === 'string' && HUA.includes(context.siHua.hua)
      ? {
          starName: context.siHua.starName.slice(0, 10),
          hua: context.siHua.hua,
          view: context.siHua.view === 'liunian' ? 'liunian' : 'daxian',
        }
      : undefined,
  };
}

function sse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function sectionPayload(topic: BatchTopic, result: SectionResult): string {
  return JSON.stringify({
    type: 'section',
    topic,
    text: result.text,
    sources: result.sources,
  });
}

function replayStream(cache: BatchCache, model: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const topic of BATCH_TOPICS) {
        const section = cache.sections[topic];
        if (section?.text) {
          controller.enqueue(new TextEncoder().encode(`data: ${sectionPayload(topic, section)}\n\n`));
        }
      }
      controller.enqueue(sse({ type: 'meta', model, promptVersion: PROMPT_VERSION, cached: true }));
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

async function generateTopic(
  topic: BatchTopic,
  chart: ZiweiChart,
  facts: string,
  context: BatchContext,
  provider: ProviderConfig,
  signal: AbortSignal,
): Promise<SectionResult> {
  const question = TOPIC_QUESTIONS[topic];
  const knowledge = buildKnowledgeContext(chart, topic);
  const retrieval = retrieveSources(chart, question, topic);
  const messages = buildChatMessages({
    chartContext: facts,
    knowledge,
    retrieval: formatSourcesForPrompt(retrieval.entries),
    topic,
    detail: 'standard',
    history: [{ role: 'user', content: question }],
    question,
  });

  const params = DETAIL_PARAMS.standard;

  const run = async (input: typeof messages): Promise<{ text: string; finish: string | null }> => {
    const completion = await provider.client.chat.completions.create(
      {
        model: provider.model,
        messages: input,
        stream: true,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        reasoning_effort: 'minimal',
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
      { signal },
    ) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    let text = '';
    let finish: string | null = null;
    for await (const chunk of completion) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content ?? '';
      if (delta) text += delta;
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
    return { text, finish };
  };

  const first = await run(messages);
  let text = first.text;

  // 被 max_tokens 截断时续写一次，避免段落停在半句。
  if (first.finish === 'length' && text) {
    const continuation = await run([
      ...messages,
      { role: 'assistant' as const, content: text },
      {
        role: 'user' as const,
        content: '上一条在末尾被截断。请从断点处直接继续，不要重复已经写过的内容，只输出续写部分。',
      },
    ]);
    text += continuation.text;
    if (continuation.finish === 'length') {
      console.warn(`[ai/batch] ${topic} still truncated after continuation`);
    }
  }

  return { text: text.trim(), sources: retrieval.sources };
}

export async function POST(request: NextRequest): Promise<Response> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > 256 * 1024) return jsonError(413, 'invalid_request', '请求体过大');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', '请求体不是合法 JSON');
  }

  const body = raw as BatchBody;
  if (!body.chart || !Array.isArray(body.chart.palaces) || typeof body.chart.birthInfo !== 'object') {
    return jsonError(400, 'invalid_request', '缺少命盘');
  }

  let provider;
  try {
    provider = getProvider();
  } catch (error) {
    if (error instanceof ProviderConfigError) return jsonError(503, 'not_configured', 'AI 服务未配置');
    throw error;
  }

  const chartFp = chartFingerprint(body.chart);
  const rate = await checkRateLimit(clientIp(request.headers), chartFp);
  if (!rate.allowed) {
    return jsonError(rate.code === 'budget_exhausted' ? 503 : 429, rate.code, rate.message, {
      retryAfter: rate.retryAfter,
    });
  }

  const context = normalizeContext(body.context);
  const year = context.liunianYear ?? new Date().getFullYear();
  const cacheKey = [
    'ai:batch:v2',
    chartFp,
    year,
    context.view ?? '',
    context.palaceName ?? '',
    context.palaceBranch ?? '',
    context.siHua ? `${context.siHua.starName}${context.siHua.hua}${context.siHua.view}` : '',
    PROMPT_VERSION,
    provider.model,
  ].join(':');

  if (!body.refresh) {
    const cached = await cacheGetJson<BatchCache>(cacheKey);
    if (cached?.sections && Object.keys(cached.sections).length) {
      return new Response(replayStream(cached, provider.model), {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Cache': 'hit',
        },
      });
    }
  }

  const facts = buildChartContext(body.chart, {
    view: context.view,
    liunianYear: year,
    focusPalace: { name: context.palaceName, branch: context.palaceBranch },
    focusSiHua: context.siHua,
  });

  const controller = new AbortController();
  if (request.signal.aborted) controller.abort();
  else request.signal.addEventListener('abort', () => controller.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const enqueue = (chunk: Uint8Array) => {
        try {
          streamController.enqueue(chunk);
        } catch {
          controller.abort();
        }
      };

      const sections: Partial<Record<BatchTopic, SectionResult>> = {};

      const emit = (topic: BatchTopic, result: SectionResult) => {
        enqueue(new TextEncoder().encode(`data: ${sectionPayload(topic, result)}\n\n`));
      };

      try {
        // 第一步：先单独生成命格，拿到结果立即下发。
        try {
          const overview = await generateTopic('overview', body.chart!, facts, context, provider, controller.signal);
          if (overview.text) {
            sections.overview = overview;
            emit('overview', overview);
          }
        } catch (error) {
          if (!controller.signal.aborted) console.error('[ai/batch] overview failed:', error);
        }

        // 第二步：命格完成后，其余五项并发。
        if (!controller.signal.aborted) {
          await Promise.all(
            BATCH_TOPICS.filter(topic => topic !== 'overview').map(async topic => {
              try {
                const result = await generateTopic(topic, body.chart!, facts, context, provider, controller.signal);
                if (!result.text) return;
                sections[topic] = result;
                emit(topic, result);
              } catch (error) {
                if (!controller.signal.aborted) console.error(`[ai/batch] ${topic} failed:`, error);
              }
            }),
          );
        }

        if (!Object.keys(sections).length) {
          enqueue(sse({ type: 'error', code: 'upstream_error', message: '解读生成失败，请点击刷新重试' }));
        } else {
          await cacheSetJson(cacheKey, { sections } satisfies BatchCache, CACHE_TTL.answer);
          enqueue(sse({ type: 'meta', model: provider.model, promptVersion: PROMPT_VERSION, cached: false }));
        }
        enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('[ai/batch] generation failed:', error);
          enqueue(sse({ type: 'error', code: 'upstream_error', message: '生成中断，请稍后重试' }));
          enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        }
      } finally {
        try {
          streamController.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      controller.abort();
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
