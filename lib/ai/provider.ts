/**
 * 模型供应商 — OpenAI 兼容协议（DeepSeek / 其他）。
 */

import 'server-only';
import OpenAI from 'openai';
import type { DetailLevel } from './prompts';

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export interface ProviderConfig {
  client: OpenAI;
  model: string;
}

// deepseek-flash 是推理模型，reasoning tokens 也计入 max_tokens，
// 这里要给思考过程留出余量，否则正文会被截断或为空。
export const DETAIL_PARAMS: Record<DetailLevel, { maxTokens: number; temperature: number }> = {
  brief: { maxTokens: 8000, temperature: 0.6 },
  standard: { maxTokens: 16000, temperature: 0.7 },
  deep: { maxTokens: 24000, temperature: 0.7 },
};

export function getProvider(): ProviderConfig {
  const provider = (process.env.AI_PROVIDER ?? 'deepseek').toLowerCase();

  let apiKey = '';
  let baseURL = '';
  let model = '';

  if (provider === 'deepseek') {
    apiKey = process.env.DEEPSEEK_API_KEY ?? '';
    baseURL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
    model = process.env.DEEPSEEK_MODEL ?? 'deepseek-flash';
  } else if (provider === 'mimo') {
    apiKey = process.env.MIMO_API_KEY ?? '';
    baseURL = process.env.MIMO_BASE_URL ?? '';
    model = process.env.MIMO_MODEL ?? '';
  } else {
    throw new ProviderConfigError(`unsupported AI_PROVIDER: ${provider}`);
  }

  if (!apiKey) throw new ProviderConfigError(`missing API key for ${provider}`);
  if (!baseURL) throw new ProviderConfigError(`missing base URL for ${provider}`);
  if (!model) throw new ProviderConfigError(`missing model for ${provider}`);

  return {
    model,
    client: new OpenAI({
      apiKey,
      baseURL,
      maxRetries: 1,
      timeout: 60_000,
    }),
  };
}
