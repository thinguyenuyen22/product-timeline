import { auth } from './lib/firebase';
import type { PriceLog, Product, RDSample, SampleImage, Task, UserRole } from './types';

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Bạn chưa đăng nhập.');
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Lỗi máy chủ (${res.status})`);
  }
  return data as T;
}

export async function fetchWorkspace() {
  return apiFetch<{
    products: Product[];
    user: { id: number; uid: string; email: string; displayName: string; role: UserRole };
  }>('/api/workspace');
}

export async function apiSaveProduct(product: Product, includeTasks = false) {
  return apiFetch<{ ok: boolean }>('/api/products', {
    method: 'POST',
    body: JSON.stringify({
      id: product.id,
      name: product.name,
      category: product.category,
      launch: product.launch,
      cycleStartYear: product.cycleStartYear,
      tasks: includeTasks ? product.tasks : undefined,
    }),
  });
}

export async function apiDeleteProduct(productId: string) {
  return apiFetch<{ ok: boolean }>(`/api/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  });
}

export async function apiSaveTask(productId: string, task: Task) {
  return apiFetch<{ ok: boolean }>(
    `/api/products/${encodeURIComponent(productId)}/tasks/${encodeURIComponent(task.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(task),
    }
  );
}

export async function apiDeleteTask(taskId: string) {
  return apiFetch<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
}

export async function apiSaveSample(productId: string, sample: RDSample) {
  return apiFetch<{ ok: boolean }>(
    `/api/products/${encodeURIComponent(productId)}/samples/${encodeURIComponent(sample.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(sample),
    }
  );
}

export async function apiApproveSample(productId: string, sampleId: string, approve: boolean) {
  return apiFetch<{ ok: boolean }>(
    `/api/products/${encodeURIComponent(productId)}/samples/${encodeURIComponent(sampleId)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ approve }),
    }
  );
}

export async function apiDeleteSample(sampleId: string) {
  return apiFetch<{ ok: boolean }>(`/api/samples/${encodeURIComponent(sampleId)}`, {
    method: 'DELETE',
  });
}

export async function apiRecordPriceUpdate(sampleId: string, log: PriceLog) {
  return apiFetch<{ ok: boolean }>(`/api/samples/${encodeURIComponent(sampleId)}/price-logs`, {
    method: 'POST',
    body: JSON.stringify(log),
  });
}

export async function apiUploadSampleImages(sampleId: string, images: SampleImage[]) {
  return apiFetch<{ ok: boolean }>(`/api/samples/${encodeURIComponent(sampleId)}/images`, {
    method: 'POST',
    body: JSON.stringify({ images }),
  });
}

export async function apiUpdateImageCaption(imageId: string, caption: string) {
  return apiFetch<{ ok: boolean }>(`/api/images/${encodeURIComponent(imageId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ caption }),
  });
}

export async function apiDeleteSampleImage(imageId: string) {
  return apiFetch<{ ok: boolean }>(`/api/images/${encodeURIComponent(imageId)}`, {
    method: 'DELETE',
  });
}

export async function apiImportProducts(products: Product[]) {
  return apiFetch<{ ok: boolean; count: number }>('/api/workspace/import', {
    method: 'POST',
    body: JSON.stringify({ products }),
  });
}

export async function apiListMembers() {
  return apiFetch<{
    users: Array<{ uid: string; email: string; displayName: string; role: UserRole }>;
    invites: Array<{ email: string; role: UserRole; addedBy: string }>;
  }>('/api/members');
}

export async function apiSetMemberRole(email: string, role: UserRole) {
  return apiFetch<{ ok: boolean }>('/api/members', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

export async function apiRemoveInvite(email: string) {
  return apiFetch<{ ok: boolean }>(`/api/members/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  });
}
