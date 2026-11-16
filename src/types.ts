export type TaskStatus = 'not' | 'prog' | 'done';
export type EffectiveStatus = TaskStatus | 'late';
export type TaskPriority = 'normal' | 'high';
export type SampleTestResult = 'pending' | 'go' | 'revise' | 'nogo';
export type ViewTab = 'report' | 'products' | 'samples';

export interface Task {
  id: string;
  stage: number; // 0..6
  name: string;
  pic: string;
  status: TaskStatus;
  start: string; // YYYY-MM-DD or ''
  end: string;   // YYYY-MM-DD or ''
  note: string;
  isMilestone?: boolean;
  priority?: TaskPriority;
}

export interface PriceLog {
  id: string;
  date: string; // YYYY-MM-DD
  cvsPrice: number;
  packagingCost: number;
  sellPrice: number;
  reason: string;
}

export interface RDSample {
  id: string;
  rdCode: string;
  version: string;
  pic: string;
  testDate: string; // YYYY-MM-DD or ''
  testResult: SampleTestResult;
  isApproved: boolean;
  note: string;
  cvsPrice: number;
  packagingCost: number;
  sellPrice: number;
  updatedAt: string; // YYYY-MM-DD
  priceHistory: PriceLog[];
}

export interface Product {
  id: string;
  name: string;
  category: string;
  launch: string; // YYYY-MM-DD or ''
  cycleStartYear: number; // e.g., 2026 => 03/2026 - 03/2027
  year?: number; // legacy compatibility
  tasks: Task[];
  samples: RDSample[];
}

export interface CycleWeek {
  index: number; // 1..N
  startDate: string; // YYYY-MM-DD (Monday)
  endDate: string;   // YYYY-MM-DD (Sunday)
  monthKey: string;  // YYYY-MM
  monthLabel: string; // e.g., T3/26
}

export interface CycleMonthGroup {
  key: string;
  label: string;
  span: number;
}
