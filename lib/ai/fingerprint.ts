/**
 * 命盘指纹与问题哈希。
 *
 * 不使用姓名 + 八字：姓名不参与排盘，八字也不唯一。
 * 指纹只取影响命盘输出的字段，忽略姓名、城市、分析缓存标记。
 */

import 'server-only';
import { createHash } from 'node:crypto';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { normalizeText } from './vocab';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function chartFingerprint(chart: ZiweiChart): string {
  const birth = chart.birthInfo as typeof chart.birthInfo & { leapMonthPolicy?: string };
  const canonical = {
    birthInfo: {
      year: birth.year,
      month: birth.month,
      day: birth.day,
      hour: birth.hour,
      gender: birth.gender,
      leapMonthPolicy: birth.leapMonthPolicy ?? null,
    },
    lunarInfo: chart.lunarInfo,
    mingGongBranch: chart.mingGongBranch,
    shenGongBranch: chart.shenGongBranch,
    wuxingJu: chart.wuxingJu,
    ziweiPos: chart.ziweiPos,
    mingZhu: chart.mingZhu ?? null,
    shenZhu: chart.shenZhu ?? null,
    yinYangGender: chart.yinYangGender ?? null,
    palaces: chart.palaces.map(p => ({
      branch: p.branch,
      stem: p.stem,
      name: p.name,
      stars: p.stars.map(s => ({
        name: s.name,
        type: s.type,
        siHua: s.siHua ?? '',
        brightnessRaw: s.brightnessRaw ?? '',
      })),
      selfSihua: p.selfSihua ?? [],
      isEmpty: p.isEmpty ?? false,
      borrowedFromName: p.borrowedFromName ?? '',
      borrowedStars: p.borrowedStars ?? [],
    })),
    daXians: chart.daXians,
  };
  return sha256(stableStringify(canonical));
}

export function questionHash(text: string): string {
  return sha256(normalizeText(text));
}
