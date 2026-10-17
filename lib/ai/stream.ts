/**
 * 模型流 → 前端 SSE 契约。
 *
 * 前端只认：
 *   data: {"delta":{"text":"..."}}
 *   data: {"type":"sources","sources":[...]}
 *   data: {"type":"error","code":"...","message":"..."}
 *   data: [DONE]
 */

import 'server-only';
import type OpenAI from 'openai';
import type { ChatRequestMessage } from './prompt';
import type { SourceItem } from './sources/types';

export interface SSEStreamOptions {
  client: OpenAI;
  model: string;
  messages: ChatRequestMessage[];
  sources: SourceItem[];
  maxTokens: number;
  temperature: number;
  promptVersion: string;
  signal?: AbortSignal;
  onComplete?: (text: string) => Promise<void> | void;
}

export function createSSEStream(options: SSEStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const controller = new AbortController();

  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const send = (payload: unknown) => {
    return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  };

  return new ReadableStream<Uint8Array>({
    async start(streamController) {
      const enqueue = (chunk: Uint8Array) => {
        try {
          streamController.enqueue(chunk);
        } catch {
          controller.abort();
        }
      };

      try {
        if (options.sources.length) {
          enqueue(send({ type: 'sources', sources: options.sources }));
        }

        const stream = await options.client.chat.completions.create(
          {
            model: options.model,
            messages: options.messages,
            stream: true,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            // deepseek-flash 支持 reasoning_effort；minimal 明显降低首字延迟。
            reasoning_effort: 'minimal',
          } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
          { signal: controller.signal },
        );

        let fullText = '';

        for await (const chunk of stream) {
          const text = chunk.choices?.[0]?.delta?.content ?? '';
          if (!text) continue;
          fullText += text;
          enqueue(send({ delta: { text } }));
        }

        if (!fullText) {
          console.error('[ai/stream] empty response (reasoning tokens may have consumed max_tokens)');
          enqueue(send({ type: 'error', code: 'empty_response', message: '模型未返回正文，请重试' }));
        } else {
          enqueue(send({ type: 'meta', model: options.model, promptVersion: options.promptVersion }));
          if (options.onComplete) await options.onComplete(fullText);
        }
        enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('[ai/stream] generation failed:', error);
          enqueue(send({ type: 'error', code: 'upstream_error', message: '生成中断，请稍后重试' }));
          enqueue(encoder.encode('data: [DONE]\n\n'));
        }
      } finally {
        try {
          streamController.close();
        } catch {
          // 已关闭
        }
      }
    },

    cancel() {
      controller.abort();
    },
  });
}
