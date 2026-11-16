import type {
  CycleMonthGroup,
  CycleWeek,
  EffectiveStatus,
  Product,
  RDSample,
  SampleTestResult,
  Task,
} from './types';

export const STATUS_META: Record<EffectiveStatus, { label: string; color: string }> = {
  done: { label: 'Hoàn thành', color: 'var(--st-done)' },
  prog: { label: 'Đang làm', color: 'var(--st-prog)' },
  not: { label: 'Chưa làm', color: 'var(--st-not)' },
  late: { label: 'Trễ', color: 'var(--st-late)' },
};

export const SAMPLE_RESULT_META: Record<SampleTestResult, { label: string; color: string }> = {
  pending: { label: 'Chờ test', color: 'var(--st-not)' },
  go: { label: 'Đạt (Go)', color: 'var(--st-done)' },
  revise: { label: 'Chỉnh sửa', color: 'var(--st-prog)' },
  nogo: { label: 'Không đạt', color: 'var(--st-late)' },
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function getTodayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return ch;
    }
  });
}

export function fmtDate(iso?: string, withYear = false): string {
  if (!iso || iso.length < 10) return '—';
  const dd = iso.slice(8, 10);
  const mm = iso.slice(5, 7);
  const yy = iso.slice(2, 4);
  return withYear ? `${dd}/${mm}/${yy}` : `${dd}/${mm}`;
}

export function fmtMoney(val?: number): string {
  if (val === undefined || val === null || Number.isNaN(val) || val === 0) return '—';
  return new Intl.NumberFormat('vi-VN').format(Math.round(val)) + ' đ';
}

export function calcMarginPct(cvs: number, sell: number): number | null {
  if (!sell || sell <= 0 || !cvs || cvs <= 0) return null;
  return Math.round(((sell - cvs) / sell) * 1000) / 10;
}

export function effectiveStatus(task: Task, today = getTodayStr()): EffectiveStatus {
  if (task.status !== 'done' && task.end && task.end < today) {
    return 'late';
  }
  return task.status;
}

export function daysDiff(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + 'T00:00:00Z');
  const b = Date.parse(toIso + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

export function formatCycleLabel(cycleStartYear: number): string {
  return `03/${cycleStartYear} – 03/${cycleStartYear + 1}`;
}

export function inferCycleFromDate(iso?: string): number {
  if (!iso || iso.length < 7) return 2026;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 2026;
  return m >= 3 ? y : y - 1;
}

function toIsoUTC(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Generates Monday-Sunday weeks covering 01/03/<cycleStartYear> through 31/03/<cycleStartYear + 1> (13 months).
 */
export function buildCycleCalendar(cycleStartYear: number): {
  weeks: CycleWeek[];
  months: CycleMonthGroup[];
  cycleStartIso: string;
  cycleEndIso: string;
} {
  const march1 = new Date(Date.UTC(cycleStartYear, 2, 1)); // month 2 = March
  const march31Next = new Date(Date.UTC(cycleStartYear + 1, 2, 31));
  const cycleStartIso = `${cycleStartYear}-03-01`;
  const cycleEndIso = `${cycleStartYear + 1}-03-31`;

  // Find Monday of the week whose Thursday >= March 1 (guarantees Week 1 belongs to T3/YYYY)
  const dow = march1.getUTCDay(); // 0=Sun..6=Sat
  const daysToMonday = dow === 0 ? 1 : dow <= 4 ? -(dow - 1) : 8 - dow;
  const firstMonday = new Date(march1.getTime() + daysToMonday * 86400000);
  // Ensure March 1 itself isn't left unmapped if it was Fri/Sat/Sun — shift back to Monday containing March 1 if needed,
  // while keeping month assignment clamped to 03/YYYY..03/(YYYY+1)
  const containMondayOffset = dow === 0 ? -6 : -(dow - 1);
  const startMonday =
    containMondayOffset < daysToMonday && march1.getUTCDate() === 1 && dow !== 0
      ? new Date(march1.getTime() + containMondayOffset * 86400000)
      : firstMonday;

  const weeks: CycleWeek[] = [];
  let cursor = startMonday.getTime();
  let idx = 1;
  while (cursor <= march31Next.getTime()) {
    const mon = new Date(cursor);
    const sun = new Date(cursor + 6 * 86400000);
    const thu = new Date(cursor + 3 * 86400000);

    // Assign month label based on Thursday, clamped within [03/N .. 03/N+1]
    let mYear = thu.getUTCFullYear();
    let mNum = thu.getUTCMonth() + 1;
    if (mYear < cycleStartYear || (mYear === cycleStartYear && mNum < 3)) {
      mYear = cycleStartYear;
      mNum = 3;
    }
    if (mYear > cycleStartYear + 1 || (mYear === cycleStartYear + 1 && mNum > 3)) {
      mYear = cycleStartYear + 1;
      mNum = 3;
    }
    const monthKey = `${mYear}-${String(mNum).padStart(2, '0')}`;
    const monthLabel = `T${mNum}/${String(mYear).slice(2)}`;

    weeks.push({
      index: idx,
      startDate: toIsoUTC(mon),
      endDate: toIsoUTC(sun),
      monthKey,
      monthLabel,
    });

    idx += 1;
    cursor += 7 * 86400000;
  }

  const months: CycleMonthGroup[] = [];
  for (const w of weeks) {
    const last = months[months.length - 1];
    if (last && last.key === w.monthKey) {
      last.span += 1;
    } else {
      months.push({ key: w.monthKey, label: w.monthLabel, span: 1 });
    }
  }

  return { weeks, months, cycleStartIso, cycleEndIso };
}

export function getTaskWeekSpan(
  task: Task,
  weeks: CycleWeek[]
): { startIdx: number; endIdx: number; clipsBefore: boolean; clipsAfter: boolean } | null {
  const a = task.start || task.end;
  const b = task.end || task.start;
  if (!a || !b || !weeks.length) return null;
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;

  const firstWeekStart = weeks[0].startDate;
  const lastWeekEnd = weeks[weeks.length - 1].endDate;

  if (end < firstWeekStart || start > lastWeekEnd) {
    return null;
  }

  let startIdx = -1;
  let endIdx = -1;
  for (const w of weeks) {
    if (w.endDate >= start && w.startDate <= end) {
      if (startIdx === -1) startIdx = w.index;
      endIdx = w.index;
    }
  }
  if (startIdx === -1) return null;

  return {
    startIdx,
    endIdx,
    clipsBefore: start < firstWeekStart,
    clipsAfter: end > lastWeekEnd,
  };
}

export function getProductStats(product: Product, today = getTodayStr()) {
  const counts: Record<EffectiveStatus, number> = { done: 0, prog: 0, not: 0, late: 0 };
  for (const t of product.tasks || []) {
    counts[effectiveStatus(t, today)] += 1;
  }
  const total = (product.tasks || []).length;
  const pct = total ? Math.round((counts.done / total) * 100) : 0;
  return { counts, total, pct };
}

export function getPrimarySample(product: Product): RDSample | null {
  const samples = product.samples || [];
  if (!samples.length) return null;
  return (
    samples.find((s) => s.isApproved) ||
    samples.find((s) => s.testResult === 'go') ||
    samples[samples.length - 1]
  );
}
