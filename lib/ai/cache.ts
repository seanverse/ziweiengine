/**
 * 三级缓存：facts / retrieval / answer。
 *
 * 优先 Upstash Redis（Vercel 多实例共享）；本地无配置时退回进程内 Map。
 * 缓存失败不影响主流程。
 */

import 'server-only';
import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = url && token ? new Redis({ url, token }) : null;

interface MemoryValue {
  value: string;
  expiresAt: number;
}

const memory = new Map<string, MemoryValue>();
const MEMORY_LIMIT = 1000;

let warned = false;

function warnOnce(error: unknown) {
  if (warned) return;
  warned = true;
  console.error('[ai/cache] redis error, fallback to no-cache:', error);
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (redis) {
    try {
      const raw = await redis.get<unknown>(key);
      if (raw === null || raw === undefined) return null;
      // Upstash 会自动反序列化合法 JSON；字符串缓存可能原样返回。
      if (typeof raw !== 'string') return raw as T;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as T;
      }
    } catch (error) {
      warnOnce(error);
      return null;
    }
  }

  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return JSON.parse(hit.value) as T;
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const raw = JSON.stringify(value);
  if (redis) {
    try {
      await redis.set(key, raw, { ex: ttlSeconds });
    } catch (error) {
      warnOnce(error);
    }
    return;
  }

  if (memory.size >= MEMORY_LIMIT) {
    const now = Date.now();
    for (const [k, v] of memory) {
      if (v.expiresAt <= now) memory.delete(k);
    }
    if (memory.size >= MEMORY_LIMIT) {
      const oldest = memory.keys().next().value;
      if (oldest) memory.delete(oldest);
    }
  }
  memory.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export const CACHE_TTL = {
  facts: 30 * 24 * 3600,
  retrieval: 7 * 24 * 3600,
  answer: 3 * 24 * 3600,
} as const;
