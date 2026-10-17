/**
 * /api/interpret 前端流式客户端。
 *
 * 跨 chunk 行缓冲；解析 delta / sources / error 帧。
 */

import type { ZiweiChart, SiHua } from '@/lib/ziwei/types';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import type { SourceItem } from '@/lib/ai/sources/types';

export interface InterpretContext {
  view?: 'mingpan' | 'daxian' | 'liunian';
  liunianYear?: number;
  topic?: TopicKey;
  palaceName?: string;
  palaceBranch?: number;
  siHua?: { starName: string; hua: SiHua; view: 'daxian' | 'liunian' };
}

export interface InterpretRequest {
  chart: ZiweiChart;
  messages: { role: 'user' | 'assistant'; content: string }[];
  context?: InterpretContext;
  options?: { detail?: 'brief' | 'standard' | 'deep' };
}

export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onSources?: (sources: SourceItem[]) => void;
  onSection?: (topic: string, text: string, sources?: SourceItem[]) => void;
  onError?: (code: string, message: string) => void;
  onDone?: () => void;
}

const MAX_BUFFER = 1024 * 1024;

function handleLine(line: string, handlers: StreamHandlers): boolean {
  if (!line.startsWith('data: ')) return true;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return false;
  try {
    const parsed = JSON.parse(data) as {
      delta?: { text?: string };
      type?: string;
      sources?: SourceItem[];
      topic?: string;
      text?: string;
      code?: string;
      message?: string;
    };
    if (parsed.delta?.text) handlers.onDelta?.(parsed.delta.text);
    if (parsed.type === 'sources' && parsed.sources) handlers.onSources?.(parsed.sources);
    if (parsed.type === 'section' && parsed.topic && parsed.text) {
      handlers.onSection?.(parsed.topic, parsed.text, parsed.sources);
    }
    if (parsed.type === 'error') {
      handlers.onError?.(parsed.code ?? 'upstream_error', parsed.message ?? '生成中断');
    }
  } catch {
    // 忽略非法帧
  }
  return true;
}

export async function streamSSE(
  path: string,
  body: unknown,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (!signal?.aborted) handlers.onError?.('network_error', '网络请求失败');
    return;
  }

  if (response.status === 404) {
    handlers.onError?.('not_implemented', 'AI 解读接口未实现');
    return;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as
      | { error?: { code?: string; message?: string } }
      | null;
    const code = payload?.error?.code ?? (response.status === 429 ? 'rate_limited' : 'request_failed');
    const message = payload?.error?.message ?? '解读失败，请稍后重试';
    handlers.onError?.(code, message);
    return;
  }
  if (!response.body) {
    handlers.onError?.('no_body', '无响应流');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_BUFFER) {
        handlers.onError?.('buffer_overflow', '响应过大');
        await reader.cancel();
        return;
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!handleLine(line, handlers)) {
          handlers.onDone?.();
          return;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer && !handleLine(buffer, handlers)) {
      handlers.onDone?.();
      return;
    }
    handlers.onDone?.();
  } catch {
    if (!signal?.aborted) handlers.onError?.('stream_error', '流式响应中断');
  }
}

export function streamInterpret(
  request: InterpretRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return streamSSE('/api/interpret', request, handlers, signal);
}
