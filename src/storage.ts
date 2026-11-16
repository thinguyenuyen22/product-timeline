import type { Product, RDSample, Task } from './types';
import { inferCycleFromDate, uid } from './utils';

const STORAGE_KEY = 'prod_tracker_v1';
const THEME_KEY = 'prod_tracker_theme';

export function normalizeProduct(raw: any): Product {
  const launch = typeof raw.launch === 'string' ? raw.launch : '';
  let cycleStartYear = Number(raw.cycleStartYear);
  if (!Number.isFinite(cycleStartYear) || cycleStartYear < 2024) {
    // Legacy schema used `year` (e.g. 2027 launch year -> cycle starts 03/2026)
    const legacyYear = Number(raw.year);
    if (launch) {
      cycleStartYear = inferCycleFromDate(launch);
    } else if (Number.isFinite(legacyYear) && legacyYear >= 2027) {
      cycleStartYear = legacyYear - 1;
    } else {
      cycleStartYear = 2026;
    }
  }

  const tasks: Task[] = Array.isArray(raw.tasks)
    ? raw.tasks.map((t: any) => ({
        id: String(t.id || uid()),
        stage: Number.isFinite(Number(t.stage)) ? Math.min(6, Math.max(0, Number(t.stage))) : 0,
        name: String(t.name || '').trim() || 'Công việc chưa đặt tên',
        pic: String(t.pic || ''),
        status: t.status === 'done' || t.status === 'prog' ? t.status : 'not',
        start: typeof t.start === 'string' ? t.start : '',
        end: typeof t.end === 'string' ? t.end : '',
        note: typeof t.note === 'string' ? t.note : '',
        isMilestone: Boolean(t.isMilestone),
        priority: t.priority === 'high' ? 'high' : 'normal',
      }))
    : [];

  const samples: RDSample[] = Array.isArray(raw.samples)
    ? raw.samples.map((s: any) => ({
        id: String(s.id || uid()),
        rdCode: String(s.rdCode || 'RD-001'),
        version: String(s.version || ''),
        pic: String(s.pic || ''),
        testDate: typeof s.testDate === 'string' ? s.testDate : '',
        testResult:
          s.testResult === 'go' || s.testResult === 'revise' || s.testResult === 'nogo'
            ? s.testResult
            : 'pending',
        isApproved: Boolean(s.isApproved),
        note: String(s.note || ''),
        cvsPrice: Number(s.cvsPrice) || 0,
        packagingCost: Number(s.packagingCost) || 0,
        sellPrice: Number(s.sellPrice) || 0,
        updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : '',
        priceHistory: Array.isArray(s.priceHistory)
          ? s.priceHistory.map((h: any) => ({
              id: String(h.id || uid()),
              date: String(h.date || ''),
              cvsPrice: Number(h.cvsPrice) || 0,
              packagingCost: Number(h.packagingCost) || 0,
              sellPrice: Number(h.sellPrice) || 0,
              reason: String(h.reason || ''),
            }))
          : [],
        images: Array.isArray(s.images)
          ? s.images.map((img: any) => ({
              id: String(img.id || uid()),
              caption: String(img.caption || ''),
              mimeType: String(img.mimeType || 'image/webp'),
              dataUrl: String(img.dataUrl || ''),
              uploadedBy: String(img.uploadedBy || ''),
            }))
          : [],
      }))
    : [];

  return {
    id: String(raw.id || uid()),
    name: String(raw.name || 'Sản phẩm chưa đặt tên'),
    category: String(raw.category || ''),
    launch,
    cycleStartYear,
    tasks,
    samples,
  };
}

export function loadProducts(): Product[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeProduct);
  } catch {
    return [];
  }
}

export function saveProducts(products: Product[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
  } catch {
    // ignore quota errors gracefully
  }
}

export function loadTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // ignore
  }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function saveTheme(theme: 'light' | 'dark'): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}
