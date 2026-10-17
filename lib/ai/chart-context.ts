/**
 * 命盘事实层 — ZiweiChart → 确定性中文文本
 *
 * 原则：数字索引全部翻译，空宫 / 自化 / 四化 / 三方四正由代码算好，
 * 不让模型从原始 JSON 里推导。
 */

import 'server-only';
import type { BirthInfo, Palace, Star, ZiweiChart, SiHua } from '@/lib/ziwei/types';

type BirthInfoWithPolicy = BirthInfo & { leapMonthPolicy?: string };
import { branchName, stemName } from './vocab';
import { CHILDHOOD_DAXIAN_INDEX } from '@/lib/ziwei/yunxian-context';
import {
  getDaXianSiHua,
  getLiuNianSiHua,
  getYearBranchIndex,
} from '@/lib/ziwei/sihua';

export type TimeView = 'mingpan' | 'daxian' | 'liunian';

export interface ChartContextOptions {
  view?: TimeView;
  liunianYear?: number;
  /** 用户点选的宫位，用于提示模型当前焦点。 */
  focusPalace?: { name?: string; branch?: number };
  focusSiHua?: { starName: string; hua: SiHua; view: 'daxian' | 'liunian' };
}

/** 十二地支对应盘面方位（不是住宅风水坐向）。 */
const BRANCH_DIRECTION: Record<number, string> = {
  0: '北', 1: '东北偏北', 2: '东北偏东', 3: '东',
  4: '东南偏东', 5: '东南偏南', 6: '南', 7: '西南偏南',
  8: '西南偏西', 9: '西', 10: '西北偏西', 11: '西北偏北',
};

const AUSPICIOUS_STARS = ['左辅', '右弼', '文昌', '文曲', '天魁', '天钺', '禄存', '天马'];
const MALEFIC_STARS = ['擎羊', '陀罗', '火星', '铃星', '地空', '地劫'];

const STAR_TYPE_ORDER: Record<Star['type'], number> = {
  major: 0,
  lucky: 1,
  sha: 2,
  minor: 3,
};

function starText(star: Star): string {
  const brightness = star.brightnessRaw ? `(${star.brightnessRaw})` : '';
  const hua = star.siHua ? `·${star.siHua}` : '';
  return `${star.name}${brightness}${hua}`;
}

function sortStars(stars: Star[]): Star[] {
  return [...stars].sort((a, b) => {
    const byType = (STAR_TYPE_ORDER[a.type] ?? 9) - (STAR_TYPE_ORDER[b.type] ?? 9);
    return byType !== 0 ? byType : a.name.localeCompare(b.name, 'zh-CN');
  });
}

function palaceByBranch(chart: ZiweiChart, branch: number): Palace | undefined {
  return chart.palaces.find(p => p.branch === branch);
}

function palaceNameByBranch(chart: ZiweiChart, branch: number): string {
  return palaceByBranch(chart, branch)?.name ?? '未知宫';
}

function palaceLine(palace: Palace): string {
  const groups: Record<Star['type'], string[]> = { major: [], lucky: [], sha: [], minor: [] };
  for (const star of sortStars(palace.stars)) groups[star.type].push(starText(star));

  const parts: string[] = [];
  parts.push(`${palace.name}(${branchName(palace.branch)}/${BRANCH_DIRECTION[palace.branch] ?? '?'}/${stemName(palace.stem)}干)`);
  parts.push(`主星：${groups.major.join(' ') || '无（空宫）'}`);
  if (groups.lucky.length) parts.push(`辅星：${groups.lucky.join(' ')}`);
  if (groups.sha.length) parts.push(`煞星：${groups.sha.join(' ')}`);
  if (groups.minor.length) parts.push(`杂曜：${groups.minor.join(' ')}`);
  if (palace.selfSihua?.length) {
    parts.push(`自化：${palace.selfSihua.map(s => `${s.starName}化${s.siHua}`).join(' ')}`);
  }
  if (palace.isEmpty) {
    const borrowed = palace.borrowedStars?.length
      ? `借对宫 ${palace.borrowedFromName ?? ''}：${palace.borrowedStars.join(' ')}`
      : `借对宫 ${palace.borrowedFromName ?? '未知'}`;
    parts.push(borrowed);
  }
  if (palace.daXianAge) parts.push(`大限 ${palace.daXianAge[0]}–${palace.daXianAge[1]} 岁`);
  if (palace.isCurrentDaXian) parts.push('【当前大限】');
  return `- ${parts.join(' ｜ ')}`;
}

function sanFangSiZheng(chart: ZiweiChart, palace: Palace): string {
  const opposite = palaceNameByBranch(chart, (palace.branch + 6) % 12);
  const trine1 = palaceNameByBranch(chart, (palace.branch + 4) % 12);
  const trine2 = palaceNameByBranch(chart, (palace.branch + 8) % 12);
  return `${palace.name}：对宫 ${opposite}｜三合 ${trine1}、${trine2}`;
}

function yearSiHuaText(year: number): string {
  const { stemName: stem, transforms } = getLiuNianSiHua(year);
  return `${stem}${branchName(getYearBranchIndex(year))}年：${transforms.禄}化禄 · ${transforms.权}化权 · ${transforms.科}化科 · ${transforms.忌}化忌`;
}

function daXianSiHuaText(chart: ZiweiChart, index: number, year: number): string {
  const info = getDaXianSiHua(chart, index, year);
  if (!info) return '';
  const t = info.transforms;
  return `${info.stemName}干：${t.禄}化禄 · ${t.权}化权 · ${t.科}化科 · ${t.忌}化忌`;
}

function palaceLabel(name: string): string {
  return name.endsWith('宫') ? name : `${name}宫`;
}

function palaceBrief(chart: ZiweiChart, name: string): string {
  const palace = chart.palaces.find(p => p.name === name);
  if (!palace) return `${name}：未知`;
  const stars = palace.stars.map(starText).join(' ') || '无主星';
  return `${name}在${branchName(palace.branch)}宫（${BRANCH_DIRECTION[palace.branch] ?? '?'}，${stemName(palace.stem)}干）：${stars}`;
}

function starPlacements(chart: ZiweiChart, names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const palaces = chart.palaces
      .filter(p => p.stars.some(s => s.name === name))
      .map(p => `${p.name}（${BRANCH_DIRECTION[p.branch] ?? '?'}）`);
    if (palaces.length) out.push(`${name}→${palaces.join('、')}`);
  }
  return out;
}

function collectYearSiHua(chart: ZiweiChart): string[] {
  const lines: string[] = [];
  for (const palace of chart.palaces) {
    for (const star of palace.stars) {
      if (star.siHua) lines.push(`${star.siHua}：${star.name} → ${palace.name}`);
    }
  }
  return lines;
}

export function buildChartContext(
  chart: ZiweiChart,
  opts: ChartContextOptions = {},
): string {
  const { birthInfo, lunarInfo } = chart;
  const liunianYear = opts.liunianYear ?? new Date().getFullYear();
  const lines: string[] = [];

  lines.push('【基本信息】');
  lines.push(`性别 ${birthInfo.gender === 'male' ? '男' : '女'}｜${chart.yinYangGender ?? ''}｜${chart.wuxingJuName}`);
  lines.push(`命主 ${chart.mingZhu ?? '未知'}｜身主 ${chart.shenZhu ?? '未知'}`);
  lines.push(
    `公历 ${birthInfo.year}-${String(birthInfo.month).padStart(2, '0')}-${String(birthInfo.day).padStart(2, '0')}`
    + `｜时辰索引 ${birthInfo.hour}（${branchName(birthInfo.hour)}时）`,
  );
  lines.push(
    `农历 ${lunarInfo.lunarYear}年${lunarInfo.isLeapMonth ? '闰' : ''}${Math.abs(lunarInfo.lunarMonth)}月${lunarInfo.lunarDay}日`,
  );
  const pillars = lunarInfo.fourPillars ?? lunarInfo.fourPillarsLunar;
  if (pillars) lines.push(`四柱 ${pillars.join(' ')}`);
  lines.push(`命宫在${branchName(chart.mingGongBranch)}｜身宫在${branchName(chart.shenGongBranch)}`);
  const leapMonthPolicy = (birthInfo as BirthInfoWithPolicy).leapMonthPolicy;
  if (leapMonthPolicy) lines.push(`闰月口径 ${leapMonthPolicy}`);
  if (birthInfo.origInput) {
    const o = birthInfo.origInput;
    lines.push(`原始输入 ${o.year}-${o.month}-${o.day} ${String(o.clockHour).padStart(2, '0')}:${String(o.clockMinute).padStart(2, '0')}（已按子时规则换算）`);
  }

  lines.push('');
  lines.push('【时间锚点】');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  lines.push(`今天 ${today}｜虚岁 ${chart.currentAge}`);
  const dxIndex = chart.currentDaXianIndex;
  if (dxIndex >= 0 && chart.daXians[dxIndex]) {
    const dx = chart.daXians[dxIndex];
    lines.push(`当前大限 ${dx.startAge}–${dx.endAge} 岁（${palaceLabel(dx.palaceName)}）${daXianSiHuaText(chart, dxIndex, liunianYear)}`);
  } else if (dxIndex === CHILDHOOD_DAXIAN_INDEX || dxIndex === -1) {
    lines.push('当前处于童限，尚未进入实际大限');
  }
  const lnBranch = getYearBranchIndex(liunianYear);
  lines.push(`流年 ${liunianYear} ${yearSiHuaText(liunianYear)}｜流年命宫在${branchName(lnBranch)}宫（${palaceNameByBranch(chart, lnBranch)}）`);
  if (opts.view) {
    const label = opts.view === 'mingpan' ? '本命' : opts.view === 'daxian' ? '大限' : '流年';
    lines.push(`用户当前查看：${label}`);
  }
  if (opts.focusPalace) {
    const name = opts.focusPalace.name ?? (opts.focusPalace.branch !== undefined ? palaceNameByBranch(chart, opts.focusPalace.branch) : '');
    if (name) lines.push(`用户当前点选：${name}宫`);
  }
  if (opts.focusSiHua) {
    const { starName, hua, view } = opts.focusSiHua;
    lines.push(`用户当前点选四化：${view === 'daxian' ? '大限' : '流年'} ${starName}化${hua}`);
  }

  lines.push('');
  lines.push('【本命十二宫】');
  for (const palace of [...chart.palaces].sort((a, b) => a.branch - b.branch)) {
    lines.push(palaceLine(palace));
  }

  lines.push('');
  lines.push('【三方四正】');
  for (const palace of [...chart.palaces].sort((a, b) => a.branch - b.branch)) {
    lines.push(`- ${sanFangSiZheng(chart, palace)}`);
  }

  lines.push('');
  lines.push('【生年四化】');
  const siHuaLines = collectYearSiHua(chart);
  lines.push(siHuaLines.length ? siHuaLines.map(l => `- ${l}`).join('\n') : '- 无');

  lines.push('');
  lines.push('【大限】');
  chart.daXians.forEach((dx, idx) => {
    const extra: string[] = [`${dx.startAge}–${dx.endAge} 岁`, palaceLabel(dx.palaceName)];
    if (idx === chart.currentDaXianIndex) extra.push('当前');
    if (dx.siHua) {
      extra.push(`${dx.siHua.stemName}干四化：${dx.siHua.lu}禄 ${dx.siHua.quan}权 ${dx.siHua.ke}科 ${dx.siHua.ji}忌`);
    }
    lines.push(`- ${extra.join('｜')}`);
  });

  lines.push('');
  lines.push('【财位与吉凶星】');
  lines.push(`- 财位（求财方式）：${palaceBrief(chart, '财帛')}`);
  lines.push(`- 财库（资产积蓄）：${palaceBrief(chart, '田宅')}`);
  const auspicious = starPlacements(chart, AUSPICIOUS_STARS);
  const malefic = starPlacements(chart, MALEFIC_STARS);
  const huaGood = collectYearSiHua(chart).filter(line => !line.startsWith('忌'));
  const huaBad = collectYearSiHua(chart).filter(line => line.startsWith('忌'));
  lines.push(`- 吉星落宫：${auspicious.length ? auspicious.join('；') : '无'}`);
  lines.push(`- 煞星落宫：${malefic.length ? malefic.join('；') : '无'}`);
  if (huaGood.length) lines.push(`- 吉化：${huaGood.join('；')}`);
  if (huaBad.length) lines.push(`- 忌化：${huaBad.join('；')}`);
  lines.push('- 说明：以上方位是盘面地支方位，不等同住宅风水坐向。');

  return lines.join('\n');
}
