export type TaskStatus = 'not' | 'prog' | 'done';
export type EffectiveStatus = TaskStatus | 'late';
export type TaskPriority = 'normal' | 'high';
export type SampleTestResult = 'pending' | 'go' | 'revise' | 'nogo';
export type ViewTab = 'report' | 'products' | 'samples';
export type UserRole = 'admin' | 'editor' | 'viewer';

export interface WorkspaceUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
}

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
  updatedBy?: string;
}

export interface SampleImage {
  id: string;
  caption: string;
  mimeType: string;
  dataUrl: string;
  uploadedBy?: string;
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
  images: SampleImage[];
}

export interface Product {
  id: string;
  name: string;
  category: string;
  launch: string; // YYYY-MM-DD or ''
  cycleStartYear: number; // e.g., 2026 => 03/2026 - 03/2027
  year?: number;
  tasks: Task[];
  samples: RDSample[];
}

export interface CycleMonth {
  index: number; // 1..13
  key: string;   // YYYY-MM
  label: string; // e.g., T3/26
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}
