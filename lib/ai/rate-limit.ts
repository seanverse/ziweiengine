/**
 * 公网限流：IP 分钟 / IP 日 / 命盘日 / 全局日。
 *
 * Vercel 上必须用 Upstash Redis 共享计数；本地无配置时退回进程内。
 */

import 'server-only';
import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

const LIMITS = {
  perMinute: envInt('AI_RATE_LIMIT_PER_MIN', 10),
  perDay: envInt('AI_RATE_LIMIT_PER_DAY', 100),
  perChartDay: envInt('AI_RATE_LIMIT_PER_CHART_DAY', 30),
  globalDay: envInt('AI_DAILY_REQUEST_CAP', 2000),
};

interface MemoryCounter {
  count: number;
  expiresAt: number;
}

const memory = new Map<string, MemoryCounter>();

function memoryIncr(key: string, ttlSeconds: number): number {
  const now = Date.now();
  const current = memory.get(key);
  if (!current || current.expiresAt <= now) {
    memory.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }
  current.count += 1;
  return current.count;
}

async function incr(key: string, ttlSeconds: number): Promise<number> {
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, ttlSeconds);
      return count;
    } catch (error) {
      console.error('[ai/rate-limit] redis error, using memory:', error);
    }
  }
  return memoryIncr(key, ttlSeconds);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 额度按北京时间（UTC+8）自然日 / 分钟重置。 */
function cnDate(date: Date): Date {
  return new Date(date.getTime() + 8 * 3600 * 1000);
}

function minuteKey(date: Date): string {
  const d = cnDate(date);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function dayKey(date: Date): string {
  const d = cnDate(date);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; code: 'rate_limited' | 'budget_exhausted'; retryAfter: number; message: string };

export async function checkRateLimit(ip: string, chartFp: string): Promise<RateLimitResult> {
  const now = new Date();
  const day = dayKey(now);

  const minuteCount = await incr(`rl:ip:${ip}:m:${minuteKey(now)}`, 120);
  if (minuteCount > LIMITS.perMinute) {
    return { allowed: false, code: 'rate_limited', retryAfter: 60, message: '请求过于频繁，请稍后再试' };
  }

  const ipDayCount = await incr(`rl:ip:${ip}:d:${day}`, 2 * 24 * 3600);
  if (ipDayCount > LIMITS.perDay) {
    return { allowed: false, code: 'rate_limited', retryAfter: 3600, message: '今日请求次数已达上限' };
  }

  const chartDayCount = await incr(`rl:chart:${chartFp}:d:${day}`, 2 * 24 * 3600);
  if (chartDayCount > LIMITS.perChartDay) {
    return { allowed: false, code: 'rate_limited', retryAfter: 3600, message: '该命盘今日解读次数已达上限' };
  }

  const globalCount = await incr(`budget:global:${day}`, 2 * 24 * 3600);
  if (globalCount > LIMITS.globalDay) {
    return { allowed: false, code: 'budget_exhausted', retryAfter: 3600, message: '今日全站解读额度已用尽' };
  }

  return { allowed: true };
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip') ?? 'unknown';
}
