import type {
  CycleMonth,
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

/**
 * Generates 13 calendar months from 03/<cycleStartYear> through 03/<cycleStartYear + 1>.
 */
export function buildCycleMonths(cycleStartYear: number): CycleMonth[] {
  const months: CycleMonth[] = [];
  for (let i = 0; i < 13; i++) {
    const totalM = 2 + i; // 0-indexed month: 2 = March
    const yr = cycleStartYear + Math.floor(totalM / 12);
    const m0 = totalM % 12; // 0..11
    const m1 = m0 + 1; // 1..12
    const lastDay = new Date(Date.UTC(yr, m0 + 1, 0)).getUTCDate();
    const mm = String(m1).padStart(2, '0');
    const key = `${yr}-${mm}`;
    months.push({
      index: i + 1,
      key,
      label: `T${m1}/${String(yr).slice(2)}`,
      startDate: `${key}-01`,
      endDate: `${key}-${String(lastDay).padStart(2, '0')}`,
    });
  }
  return months;
}

export function getTaskMonthSpan(
  task: Task,
  months: CycleMonth[]
): {
  startIdx: number;
  endIdx: number;
  clipsBefore: boolean;
  clipsAfter: boolean;
  startIso: string;
  endIso: string;
} | null {
  const a = task.start || task.end;
  const b = task.end || task.start;
  if (!a || !b || !months.length) return null;
  const startIso = a <= b ? a : b;
  const endIso = a <= b ? b : a;

  const firstStart = months[0].startDate;
  const lastEnd = months[months.length - 1].endDate;
  if (endIso < firstStart || startIso > lastEnd) return null;

  let startIdx = -1;
  let endIdx = -1;
  for (const m of months) {
    if (m.endDate >= startIso && m.startDate <= endIso) {
      if (startIdx === -1) startIdx = m.index;
      endIdx = m.index;
    }
  }
  if (startIdx === -1) return null;

  return {
    startIdx,
    endIdx,
    clipsBefore: startIso < firstStart,
    clipsAfter: endIso > lastEnd,
    startIso,
    endIso,
  };
}

export function formatMonthCellText(
  month: CycleMonth,
  span: { startIdx: number; endIdx: number; startIso: string; endIso: string; clipsBefore: boolean; clipsAfter: boolean }
): string {
  const isStart = month.index === span.startIdx;
  const isEnd = month.index === span.endIdx;
  const d1 = span.startIso.slice(8, 10);
  const d2 = span.endIso.slice(8, 10);

  if (isStart && isEnd) {
    if (span.clipsBefore) return `‹→${d2}`;
    if (span.clipsAfter) return `${d1}→›`;
    return d1 === d2 ? d1 : `${d1}–${d2}`;
  }
  if (isStart) return span.clipsBefore ? '‹—' : `${d1}→`;
  if (isEnd) return span.clipsAfter ? '—›' : `→${d2}`;
  return '•••';
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

/**
 * Compresses an uploaded image File client-side to WebP/JPEG (max 1200px longest side)
 * so multi-image uploads are fast and stored cleanly in Cloud SQL.
 */
export function compressImageFile(
  file: File,
  maxDimension = 1200,
  quality = 0.82
): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được file ảnh.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('File không phải hình ảnh hợp lệ.'));
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxDimension || h > maxDimension) {
          if (w >= h) {
            h = Math.round((h * maxDimension) / w);
            w = maxDimension;
          } else {
            w = Math.round((w * maxDimension) / h);
            h = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Trình duyệt không hỗ trợ xử lý ảnh.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const mimeType = 'image/webp';
        let dataUrl = canvas.toDataURL(mimeType, quality);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({ dataUrl, mimeType: 'image/jpeg' });
          return;
        }
        resolve({ dataUrl, mimeType });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
