import type { NextRequest } from 'next/server';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import type { SiHua, ZiweiChart } from '@/lib/ziwei/types';
import { buildChartContext, type TimeView } from '@/lib/ai/chart-context';
import { buildKnowledgeContext } from '@/lib/ai/knowledge';
import { buildChatMessages, type ChatMessage } from '@/lib/ai/prompt';
import { PROMPT_VERSION, type DetailLevel } from '@/lib/ai/prompts';
import { DETAIL_PARAMS, getProvider, ProviderConfigError } from '@/lib/ai/provider';
import { checkRateLimit, clientIp } from '@/lib/ai/rate-limit';
import { retrieveSources, formatSourcesForPrompt } from '@/lib/ai/retrieval';
import { chartFingerprint, questionHash } from '@/lib/ai/fingerprint';
import { cacheGetJson, cacheSetJson, CACHE_TTL } from '@/lib/ai/cache';
import { createSSEStream } from '@/lib/ai/stream';
import type { SourceEntry, SourceItem } from '@/lib/ai/sources/types';
import { extractYear, inferTopic } from '@/lib/ai/vocab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RequestContext {
  view?: TimeView;
  liunianYear?: number;
  topic?: TopicKey;
  palaceName?: string;
  palaceBranch?: number;
  siHua?: { starName: string; hua: SiHua; view: 'daxian' | 'liunian' };
}

interface InterpretBody {
  chart?: ZiweiChart;
  messages?: ChatMessage[];
  context?: RequestContext;
  options?: { detail?: DetailLevel };
}

const TOPICS: TopicKey[] = [
  'overview', 'personality', 'love', 'career', 'wealth', 'health',
  'family', 'children', 'move', 'friends', 'home', 'spirit', 'parents',
];

const VIEWS: TimeView[] = ['mingpan', 'daxian', 'liunian'];
const DETAILS: DetailLevel[] = ['brief', 'standard', 'deep'];
const HUA: SiHua[] = ['禄', '权', '科', '忌'];

const MAX_BODY = 256 * 1024;
const MAX_MESSAGES = 12;
const MAX_CONTENT = 8000;

function jsonError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

function parseBody(raw: unknown): { chart: ZiweiChart; messages: ChatMessage[]; context: RequestContext; detail: DetailLevel } | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as InterpretBody;
  if (!body.chart || !Array.isArray(body.chart.palaces) || typeof body.chart.birthInfo !== 'object') return null;
  if (!Array.isArray(body.messages)) return null;

  const messages: ChatMessage[] = [];
  for (const message of body.messages) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    if (typeof message.content !== 'string') continue;
    const content = message.content.trim().slice(0, MAX_CONTENT);
    if (!content) continue;
    messages.push({ role: message.role, content });
  }

  const context = body.context ?? {};
  const detail = body.options?.detail && DETAILS.includes(body.options.detail)
    ? body.options.detail
    : 'standard';

  return { chart: body.chart, messages, context, detail };
}

function normalizeContext(context: RequestContext): RequestContext {
  return {
    view: context.view && VIEWS.includes(context.view) ? context.view : undefined,
    liunianYear: Number.isInteger(context.liunianYear) && context.liunianYear! >= 1900 && context.liunianYear! <= 2100
      ? context.liunianYear
      : undefined,
    topic: context.topic && TOPICS.includes(context.topic) ? context.topic : undefined,
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

function replayStream(text: string, sources: SourceItem[], model: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      if (sources.length) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`));
      }
      for (let i = 0; i < text.length; i += 240) {
        const delta = text.slice(i, i + 240);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text: delta } })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'meta', model, promptVersion: PROMPT_VERSION, cached: true })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
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

  const parsed = parseBody(raw);
  if (!parsed) return jsonError(400, 'invalid_request', '缺少命盘或消息');
  const { chart, messages, detail } = parsed;
  const context = normalizeContext(parsed.context);

  if (messages.length > MAX_MESSAGES) {
    return jsonError(400, 'invalid_request', `对话最多 ${MAX_MESSAGES} 条，请重新起盘`);
  }

  const questionMessage = [...messages].reverse().find(m => m.role === 'user');
  if (!questionMessage) return jsonError(400, 'invalid_request', '缺少用户问题');
  const question = questionMessage.content;

  let provider;
  try {
    provider = getProvider();
  } catch (error) {
    if (error instanceof ProviderConfigError) {
      return jsonError(503, 'not_configured', 'AI 服务未配置');
    }
    throw error;
  }

  const chartFp = chartFingerprint(chart);
  const rate = await checkRateLimit(clientIp(request.headers), chartFp);
  if (!rate.allowed) {
    return jsonError(rate.code === 'budget_exhausted' ? 503 : 429, rate.code, rate.message, {
      retryAfter: rate.retryAfter,
    });
  }

  const inferredTopic = inferTopic(question);
  const topic = context.topic && context.topic !== 'overview'
    ? context.topic
    : inferredTopic !== 'overview'
      ? inferredTopic
      : (context.topic ?? inferredTopic);
  const liunianYear = context.liunianYear ?? extractYear(question) ?? new Date().getFullYear();

  const contextKey = [
    liunianYear,
    context.view ?? '',
    context.palaceName ?? '',
    context.palaceBranch ?? '',
    context.siHua ? `${context.siHua.starName}${context.siHua.hua}${context.siHua.view}` : '',
  ].join(':');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const factsKey = `ai:facts:v1:${chartFp}:${today}:${contextKey}`;
  let facts = await cacheGetJson<string>(factsKey);
  if (!facts) {
    facts = buildChartContext(chart, {
      view: context.view,
      liunianYear,
      focusPalace: { name: context.palaceName, branch: context.palaceBranch },
      focusSiHua: context.siHua,
    });
    await cacheSetJson(factsKey, facts, CACHE_TTL.facts);
  }

  const qHash = questionHash(question);
  const retrievalKey = `ai:ret:v1:${chartFp}:${qHash}:${topic}:${PROMPT_VERSION}`;
  let retrieval = await cacheGetJson<{ entries: SourceEntry[]; sources: SourceItem[] }>(retrievalKey);
  if (!retrieval) {
    retrieval = retrieveSources(chart, question, topic);
    await cacheSetJson(retrievalKey, retrieval, CACHE_TTL.retrieval);
  }

  const knowledge = buildKnowledgeContext(chart, topic);
  const retrievalText = formatSourcesForPrompt(retrieval.entries);
  const promptMessages = buildChatMessages({
    chartContext: facts,
    knowledge,
    retrieval: retrievalText,
    topic,
    detail,
    history: messages,
    question,
  });

  const priorMessages = messages.length && messages[messages.length - 1].content === question
    ? messages.slice(0, -1)
    : messages;
  const historyKey = questionHash(priorMessages.map(m => `${m.role}:${m.content}`).join('\n'));
  const answerKey = `ai:ans:v2:${chartFp}:${qHash}:${historyKey}:${topic}:${PROMPT_VERSION}:${provider.model}:${detail}:${contextKey}:${today}`;
  const cached = await cacheGetJson<{ text: string; sources: SourceItem[] }>(answerKey);
  if (cached?.text) {
    return new Response(replayStream(cached.text, cached.sources ?? [], provider.model), {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Cache': 'hit',
      },
    });
  }

  const params = DETAIL_PARAMS[detail];
  const stream = createSSEStream({
    client: provider.client,
    model: provider.model,
    messages: promptMessages,
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
