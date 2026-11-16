import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  apiApproveSample,
  apiDeleteProduct,
  apiDeleteSample,
  apiDeleteSampleImage,
  apiDeleteTask,
  apiImportProducts,
  apiListMembers,
  apiRecordPriceUpdate,
  apiRemoveInvite,
  apiSaveProduct,
  apiSaveSample,
  apiSaveTask,
  apiSetMemberRole,
  apiUpdateImageCaption,
  apiUploadSampleImages,
  fetchWorkspace,
} from './api';
import { createDemoProducts, STAGES, TASK_TEMPLATE } from './data/template';
import { auth, googleAuthProvider } from './lib/firebase';
import { loadProducts, loadTheme, normalizeProduct, saveTheme } from './storage';
import type {
  CycleMonth,
  Product,
  RDSample,
  SampleImage,
  SampleTestResult,
  Task,
  TaskPriority,
  TaskStatus,
  UserRole,
  ViewTab,
  WorkspaceUser,
} from './types';
import {
  calcMarginPct,
  compressImageFile,
  esc,
  fmtDate,
  fmtMoney,
  formatCycleLabel,
  getTodayStr,
  inferCycleFromDate,
  uid,
} from './utils';
import { renderProductsView } from './views/products';
import { renderReportView, type ReportFilterState } from './views/report';
import { renderSamplesView, type SamplesFilterState } from './views/samples';
import {
  renderTimelineView,
  type MonthPickState,
  type TimelineFilterState,
} from './views/timeline';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let authReady = false;
let currentUser: WorkspaceUser | null = null;
let isLoadingData = false;
let loadErrorMsg = '';

let products: Product[] = [];
let currentCycle = 2026; // Default 03/2026 - 03/2027
let activeTab: ViewTab = 'report';
let activeProductId: string | null = null;
let editMode = false; // Default to clean View Mode for Boss / R&D / teams
let theme: 'light' | 'dark' = loadTheme();

const collapsedStages = new Set<number>();

const reportFilter: ReportFilterState = {
  cycleMode: 'current',
  category: '',
  actionFilter: 'all_risk',
  pic: '',
};

let productsSearch = '';

const timelineFilter: TimelineFilterState = {
  stage: 'all',
  status: 'all',
  pic: '',
  milestoneOnly: false,
  search: '',
};

const samplesFilter: SamplesFilterState = {
  productId: '',
  cycleMode: 'current',
  result: 'all',
  search: '',
};

let currentTimelineMonths: CycleMonth[] = [];
let pendingMonthPick: MonthPickState | null = null;
let twoClickAnchor: { taskId: string; anchorMonth: number } | null = null;

// Modal editing context
let editingProductId: string | null = null;
let editingTaskId: string | null = null;
let editingSampleRef: { productId: string; sampleId: string } | null = null;
let pricingSampleRef: { productId: string; sampleId: string } | null = null;
let uploadTargetSampleRef: { productId: string; sampleId: string } | null = null;
let lightboxState: { productId: string; sampleId: string; index: number } | null = null;

let toastTimer: number | undefined;
function showToast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.remove('show');
  }, 2600);
}

function canEdit(): boolean {
  return currentUser?.role === 'admin' || currentUser?.role === 'editor';
}

function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', theme);
  $('themeToggleBtn').textContent = theme === 'dark' ? 'Chế độ sáng' : 'Chế độ tối';
}

function askConfirm(
  title: string,
  message: string,
  okLabel = 'Xác nhận',
  isDanger = false
): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = $<HTMLDialogElement>('confirmDialog');
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    const okBtn = $<HTMLButtonElement>('confirmOkBtn');
    const cancelBtn = $<HTMLButtonElement>('confirmCancelBtn');
    okBtn.textContent = okLabel;
    okBtn.className = isDanger ? 'btn-danger' : 'btn-pri';

    const cleanup = (result: boolean) => {
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      dlg.oncancel = null;
      if (dlg.open) dlg.close();
      resolve(result);
    };

    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    dlg.oncancel = () => cleanup(false);
    dlg.showModal();
  });
}

function getAvailableCycles(): number[] {
  const set = new Set<number>([2026, 2027, 2028, currentCycle]);
  for (const p of products) {
    set.add(p.cycleStartYear);
  }
  const max = Math.max(...set);
  set.add(max + 1);
  return Array.from(set).sort((a, b) => a - b);
}

function syncHeaderControls(): void {
  const signedIn = Boolean(currentUser);
  $('topbar').hidden = !signedIn;
  $('workspaceBar').hidden = !signedIn;

  if (!signedIn || !currentUser) return;

  const roleLabel =
    currentUser.role === 'admin'
      ? 'Admin'
      : currentUser.role === 'editor'
      ? 'Nhập liệu'
      : 'Chỉ Xem';
  $('userLabel').textContent = `${currentUser.displayName || currentUser.email} (${roleLabel})`;

  const editable = canEdit();
  if (!editable) editMode = false;

  $('modeSwitchWrap').hidden = !editable;
  $('viewerBadge').hidden = editable;
  $('newProductBtn').hidden = !(editable && editMode);
  $('importBtn').hidden = !(editable && editMode);
  $('membersBtn').hidden = currentUser.role !== 'admin';

  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.classList.toggle('active', (btn.dataset.mode === 'edit') === editMode);
  });

  const cycles = getAvailableCycles();
  $('cycleSelect').innerHTML = cycles
    .map(
      (y) =>
        `<option value="${y}" ${y === currentCycle ? 'selected' : ''}>${formatCycleLabel(y)}</option>`
    )
    .join('');

  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
  });
}

function render(preserveScroll = false): void {
  const prevWinY = preserveScroll ? window.scrollY : 0;
  const ganttEl = document.getElementById('ganttScrollWrap');
  const prevGanttLeft = preserveScroll && ganttEl ? ganttEl.scrollLeft : 0;

  syncHeaderControls();
  const mainEl = $('main');

  if (!authReady || isLoadingData) {
    mainEl.innerHTML = `<div class="auth-gate"><div class="auth-card"><h3>Đang tải dữ liệu...</h3><p class="mut">Đang đồng bộ tiến độ dự án và mẫu R&amp;D từ Cloud SQL.</p></div></div>`;
    return;
  }

  if (!currentUser) {
    mainEl.innerHTML = `
      <div class="auth-gate">
        <div class="auth-card">
          <h1>Product Timeline Tracker</h1>
          <p class="mut">Theo dõi tiến độ phát triển sản phẩm theo chu kỳ 03/2026 – 03/2027, đánh giá mẫu R&amp;D kèm hình ảnh và báo cáo tổng quan dùng chung toàn đội ngũ.</p>
          ${
            loadErrorMsg
              ? `<div class="pick-banner" style="border-color:var(--st-late)">${esc(loadErrorMsg)}</div>`
              : ''
          }
          <button type="button" class="btn-pri" id="googleSignInBtn" style="width:100%">Đăng nhập bằng Google</button>
          <p class="mut" style="margin:0">Dữ liệu được lưu trữ dài hạn trên Cloud SQL PostgreSQL. Ban Giám đốc, team R&amp;D và các phòng ban đăng nhập để xem cùng một nguồn dữ liệu.</p>
        </div>
      </div>
    `;
    const signInBtn = document.getElementById('googleSignInBtn');
    if (signInBtn) {
      signInBtn.onclick = async () => {
        try {
          loadErrorMsg = '';
          await signInWithPopup(auth, googleAuthProvider);
        } catch (err: any) {
          loadErrorMsg = err?.message || 'Đăng nhập Google thất bại. Vui lòng thử lại.';
          render();
        }
      };
    }
    return;
  }

  if (loadErrorMsg) {
    mainEl.innerHTML = `<div class="panel"><div class="empty-box">
      <p class="status-txt status-late">${esc(loadErrorMsg)}</p>
      <button type="button" class="btn" id="retryLoadBtn" style="margin-top:12px">Thử tải lại</button>
    </div></div>`;
    const retry = document.getElementById('retryLoadBtn');
    if (retry) retry.onclick = () => refreshFromServer();
    return;
  }

  const legacyLocalCount = loadProducts().length;

  if (activeTab === 'report') {
    mainEl.innerHTML = renderReportView(
      products,
      currentCycle,
      reportFilter,
      editMode,
      legacyLocalCount
    );
  } else if (activeTab === 'samples') {
    mainEl.innerHTML = renderSamplesView(products, currentCycle, samplesFilter, editMode);
  } else {
    const selectedProduct = activeProductId
      ? products.find((p) => p.id === activeProductId) || null
      : null;

    if (selectedProduct) {
      const { html, months } = renderTimelineView(
        selectedProduct,
        selectedProduct.cycleStartYear,
        timelineFilter,
        collapsedStages,
        pendingMonthPick,
        editMode
      );
      currentTimelineMonths = months;
      mainEl.innerHTML = html;
    } else {
      activeProductId = null;
      mainEl.innerHTML = renderProductsView(products, currentCycle, productsSearch, editMode);
    }
  }

  bindMainViewDynamicListeners();

  if (preserveScroll) {
    window.scrollTo({ top: prevWinY });
    const nextGanttEl = document.getElementById('ganttScrollWrap');
    if (nextGanttEl) nextGanttEl.scrollLeft = prevGanttLeft;
  }
}

async function refreshFromServer(silent = false): Promise<void> {
  if (!auth.currentUser) return;
  if (!silent) {
    isLoadingData = true;
    render();
  }
  loadErrorMsg = '';
  try {
    const data = await fetchWorkspace();
    products = data.products;
    currentUser = data.user;
    if (!canEdit()) editMode = false;
  } catch (err: any) {
    loadErrorMsg = err?.message || 'Không thể kết nối Cloud SQL.';
  } finally {
    isLoadingData = false;
    render(silent);
  }
}

function bindMainViewDynamicListeners(): void {
  const repCat = document.getElementById('repCatFilter') as HTMLSelectElement | null;
  if (repCat) {
    repCat.onchange = () => {
      reportFilter.category = repCat.value;
      render();
    };
  }
  const repPic = document.getElementById('repPicFilter') as HTMLSelectElement | null;
  if (repPic) {
    repPic.onchange = () => {
      reportFilter.pic = repPic.value;
      render();
    };
  }
  const repPrint = document.getElementById('repPrintBtn');
  if (repPrint) repPrint.onclick = () => window.print();

  const prodSearch = document.getElementById('prodSearchInput') as HTMLInputElement | null;
  if (prodSearch) {
    prodSearch.oninput = () => {
      const pos = prodSearch.selectionStart || 0;
      productsSearch = prodSearch.value;
      render();
      const restored = document.getElementById('prodSearchInput') as HTMLInputElement | null;
      if (restored) {
        restored.focus();
        restored.setSelectionRange(pos, pos);
      }
    };
  }

  const tlStage = document.getElementById('tlStageFilter') as HTMLSelectElement | null;
  if (tlStage) {
    tlStage.onchange = () => {
      timelineFilter.stage = tlStage.value === 'all' ? 'all' : Number(tlStage.value);
      render();
    };
  }
  const tlPic = document.getElementById('tlPicFilter') as HTMLSelectElement | null;
  if (tlPic) {
    tlPic.onchange = () => {
      timelineFilter.pic = tlPic.value;
      render();
    };
  }
  const tlStatus = document.getElementById('tlStatusFilter') as HTMLSelectElement | null;
  if (tlStatus) {
    tlStatus.onchange = () => {
      timelineFilter.status = tlStatus.value as TimelineFilterState['status'];
      render();
    };
  }
  const tlMile = document.getElementById('tlMilestoneFilter') as HTMLInputElement | null;
  if (tlMile) {
    tlMile.onchange = () => {
      timelineFilter.milestoneOnly = tlMile.checked;
      render();
    };
  }
  const tlSearch = document.getElementById('tlSearchInput') as HTMLInputElement | null;
  if (tlSearch) {
    tlSearch.oninput = () => {
      const pos = tlSearch.selectionStart || 0;
      timelineFilter.search = tlSearch.value;
      render();
      const restored = document.getElementById('tlSearchInput') as HTMLInputElement | null;
      if (restored) {
        restored.focus();
        restored.setSelectionRange(pos, pos);
      }
    };
  }

  const sampProd = document.getElementById('sampProdFilter') as HTMLSelectElement | null;
  if (sampProd) {
    sampProd.onchange = () => {
      samplesFilter.productId = sampProd.value;
      render();
    };
  }
  const sampResult = document.getElementById('sampResultFilter') as HTMLSelectElement | null;
  if (sampResult) {
    sampResult.onchange = () => {
      samplesFilter.result = sampResult.value as SamplesFilterState['result'];
      render();
    };
  }
  const sampSearch = document.getElementById('sampSearchInput') as HTMLInputElement | null;
  if (sampSearch) {
    sampSearch.oninput = () => {
      const pos = sampSearch.selectionStart || 0;
      samplesFilter.search = sampSearch.value;
      render();
      const restored = document.getElementById('sampSearchInput') as HTMLInputElement | null;
      if (restored) {
        restored.focus();
        restored.setSelectionRange(pos, pos);
      }
    };
  }
}

/* ---------- Cloud Sync Helpers ---------- */
async function updateTaskOnActiveProduct(
  taskId: string,
  updater: (t: Task) => void,
  msg?: string
): Promise<void> {
  if (!editMode) return;
  const prod = products.find((p) => p.id === activeProductId);
  const task = prod?.tasks.find((t) => t.id === taskId);
  if (!prod || !task) return;
  const prevSnapshot = { ...task };
  updater(task);
  render(true);
  try {
    await apiSaveTask(prod.id, task);
    if (msg) showToast(msg);
  } catch (err: any) {
    Object.assign(task, prevSnapshot);
    render(true);
    showToast(err?.message || 'Lỗi lưu lên Cloud SQL');
  }
}

function updateMonthPreviewDom(): void {
  document.querySelectorAll<HTMLElement>('.mo-cell.preview').forEach((el) => {
    el.classList.remove('preview');
  });
  if (!pendingMonthPick) return;
  const minM = Math.min(pendingMonthPick.anchorMonth, pendingMonthPick.hoverMonth);
  const maxM = Math.max(pendingMonthPick.anchorMonth, pendingMonthPick.hoverMonth);
  const row = document.querySelector<HTMLElement>(
    `tr[data-task-row="${CSS.escape(pendingMonthPick.taskId)}"]`
  );
  if (!row) return;
  row.querySelectorAll<HTMLElement>('.mo-cell').forEach((cell) => {
    const idx = Number(cell.dataset.moIdx);
    if (idx >= minM && idx <= maxM) {
      cell.classList.add('preview');
    }
  });
}

async function commitMonthSpan(taskId: string, mA: number, mB: number): Promise<void> {
  const minM = Math.min(mA, mB);
  const maxM = Math.max(mA, mB);
  const startMonth = currentTimelineMonths[minM - 1];
  const endMonth = currentTimelineMonths[maxM - 1];
  if (!startMonth || !endMonth) return;

  pendingMonthPick = null;
  twoClickAnchor = null;
  await updateTaskOnActiveProduct(
    taskId,
    (t) => {
      t.start = startMonth.startDate;
      t.end = endMonth.endDate;
    },
    minM === maxM
      ? `Đã gán tháng ${startMonth.label}`
      : `Đã gán lịch ${startMonth.label} – ${endMonth.label}`
  );
}

/* ---------- Main Delegation Handlers ---------- */
const mainEl = $('main');

mainEl.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;

  // Report toggles
  const repCycleBtn = target.closest<HTMLElement>('[data-rep-cycle]');
  if (repCycleBtn) {
    reportFilter.cycleMode = repCycleBtn.dataset.repCycle as 'current' | 'all';
    render();
    return;
  }
  const repActBtn = target.closest<HTMLElement>('[data-rep-act]');
  if (repActBtn) {
    reportFilter.actionFilter = repActBtn.dataset.repAct as ReportFilterState['actionFilter'];
    render();
    return;
  }

  // Samples cycle toggle / clear product filter
  const sampCycleBtn = target.closest<HTMLElement>('[data-samp-cycle]');
  if (sampCycleBtn) {
    samplesFilter.cycleMode = sampCycleBtn.dataset.sampCycle as 'current' | 'all';
    render();
    return;
  }
  if (target.closest('[data-clear-sample-prod]')) {
    samplesFilter.productId = '';
    render();
    return;
  }

  // Collapse / Expand stages
  const toggleStageBtn = target.closest<HTMLElement>('[data-toggle-stage]');
  if (toggleStageBtn) {
    const sIdx = Number(toggleStageBtn.dataset.toggleStage);
    if (collapsedStages.has(sIdx)) collapsedStages.delete(sIdx);
    else collapsedStages.add(sIdx);
    render(true);
    return;
  }
  if (target.closest('[data-collapse-done]')) {
    const prod = products.find((p) => p.id === activeProductId);
    if (prod) {
      STAGES.forEach((_, idx) => {
        const ts = prod.tasks.filter((t) => t.stage === idx);
        if (ts.length > 0 && ts.every((t) => t.status === 'done')) {
          collapsedStages.add(idx);
        }
      });
      render(true);
    }
    return;
  }
  if (target.closest('[data-expand-all]')) {
    collapsedStages.clear();
    render(true);
    return;
  }

  // Open Lightbox for Sample Images
  const lbBtn = target.closest<HTMLElement>('[data-open-lightbox]');
  if (lbBtn) {
    e.stopPropagation();
    const [prodId, sampleId, imageId] = (lbBtn.dataset.openLightbox || '').split(':');
    openLightbox(prodId, sampleId, imageId);
    return;
  }

  // Trigger multi-image upload for sample
  const uploadBtn = target.closest<HTMLElement>('[data-trigger-upload]');
  if (uploadBtn) {
    if (!editMode) return;
    e.stopPropagation();
    const [prodId, sampleId] = (uploadBtn.dataset.triggerUpload || '').split(':');
    uploadTargetSampleRef = { productId: prodId, sampleId };
    $<HTMLInputElement>('sampleImageUploadInput').click();
    return;
  }

  // Quick done from Report view
  const quickDoneBtn = target.closest<HTMLElement>('[data-quick-done]');
  if (quickDoneBtn) {
    if (!editMode) return;
    const [prodId, taskId] = (quickDoneBtn.dataset.quickDone || '').split(':');
    const prod = products.find((p) => p.id === prodId);
    const task = prod?.tasks.find((t) => t.id === taskId);
    if (prod && task) {
      task.status = 'done';
      render(true);
      try {
        await apiSaveTask(prod.id, task);
        showToast(`Đã đánh dấu hoàn thành: ${task.name}`);
      } catch (err: any) {
        task.status = 'prog';
        render(true);
        showToast(err?.message || 'Lỗi lưu lên Cloud SQL');
      }
    }
    return;
  }

  // Open samples filtered to product
  const openSampBtn = target.closest<HTMLElement>('[data-open-samples]');
  if (openSampBtn) {
    e.stopPropagation();
    const pid = openSampBtn.dataset.openSamples || '';
    samplesFilter.productId = pid;
    samplesFilter.cycleMode = 'all';
    activeTab = 'samples';
    render();
    return;
  }

  // Open product timeline
  const openProdEl = target.closest<HTMLElement>('[data-open-product]');
  if (openProdEl) {
    const pid = openProdEl.dataset.openProduct || '';
    const found = products.find((p) => p.id === pid);
    if (found) {
      activeTab = 'products';
      activeProductId = found.id;
      currentCycle = found.cycleStartYear;
      pendingMonthPick = null;
      twoClickAnchor = null;
      collapsedStages.clear();
      render();
    }
    return;
  }

  // Back to product list
  if (target.closest('[data-nav-back="products"]')) {
    activeProductId = null;
    pendingMonthPick = null;
    twoClickAnchor = null;
    render();
    return;
  }

  // Global action triggers
  const actionEl = target.closest<HTMLElement>('[data-action]');
  if (actionEl) {
    const act = actionEl.dataset.action;
    if (act === 'new-product') openProductModal(null);
    else if (act === 'edit-product') {
      const p = products.find((x) => x.id === activeProductId);
      if (p) openProductModal(p);
    } else if (act === 'add-task') openTaskModal(null);
    else if (act === 'new-sample') openSampleModal(null);
    else if (act === 'load-demo') {
      if (!editMode) return;
      const demo = createDemoProducts();
      try {
        await apiImportProducts(demo);
        products = demo;
        currentCycle = 2026;
        render();
        showToast('Đã lưu dữ liệu mẫu lên Cloud SQL');
      } catch (err: any) {
        showToast(err?.message || 'Lỗi tải dữ liệu mẫu');
      }
    } else if (act === 'sync-legacy') {
      if (!editMode) return;
      const legacy = loadProducts();
      if (!legacy.length) return;
      try {
        await apiImportProducts(legacy);
        await refreshFromServer();
        showToast(`Đã đồng bộ ${legacy.length} sản phẩm lên Cloud SQL`);
      } catch (err: any) {
        showToast(err?.message || 'Lỗi đồng bộ dữ liệu cũ');
      }
    }
    return;
  }

  if (!editMode) return; // Below this point are Edit Mode actions only

  // Open full task modal
  const openTaskBtn = target.closest<HTMLElement>('[data-open-task]');
  if (openTaskBtn) {
    const prod = products.find((p) => p.id === activeProductId);
    const task = prod?.tasks.find((t) => t.id === openTaskBtn.dataset.openTask);
    if (task) openTaskModal(task);
    return;
  }

  // Clear task dates
  const clearDatesBtn = target.closest<HTMLElement>('[data-clear-dates]');
  if (clearDatesBtn) {
    const tid = clearDatesBtn.dataset.clearDates || '';
    await updateTaskOnActiveProduct(
      tid,
      (t) => {
        t.start = '';
        t.end = '';
      },
      'Đã xóa lịch'
    );
    return;
  }

  // Inline text edit (Task name or PIC)
  const inlineTextEl = target.closest<HTMLElement>('[data-inline-field]');
  if (inlineTextEl && !inlineTextEl.querySelector('input')) {
    const field = inlineTextEl.dataset.inlineField as 'name' | 'pic';
    const tid = inlineTextEl.dataset.taskId || '';
    const prod = products.find((p) => p.id === activeProductId);
    const task = prod?.tasks.find((t) => t.id === tid);
    if (!task) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-edit-input';
    input.value = task[field];
    inlineTextEl.textContent = '';
    inlineTextEl.appendChild(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = (save: boolean) => {
      if (finished) return;
      finished = true;
      const val = input.value.trim();
      if (save && (field === 'pic' || val.length > 0)) {
        if (task[field] !== val) {
          void updateTaskOnActiveProduct(tid, (t) => {
            t[field] = val;
          });
          return;
        }
      }
      render(true);
    };

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    return;
  }

  // Inline due date edit
  const inlineDueBtn = target.closest<HTMLElement>('[data-inline-due]');
  if (inlineDueBtn) {
    const tid = inlineDueBtn.dataset.inlineDue || '';
    const prod = products.find((p) => p.id === activeProductId);
    const task = prod?.tasks.find((t) => t.id === tid);
    if (!task) return;

    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'inline-edit-input';
    input.value = task.end || '';
    inlineDueBtn.replaceWith(input);
    input.focus();

    let finished = false;
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (commit && input.value !== task.end) {
        void updateTaskOnActiveProduct(tid, (t) => {
          t.end = input.value;
          if (t.start && t.end && t.start > t.end) t.start = t.end;
        });
      } else {
        render(true);
      }
    };

    input.addEventListener('change', () => finish(true));
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') finish(false);
    });
    return;
  }

  // Quick-add row toggle / save / cancel inside Timeline stage
  const quickStageBtn = target.closest<HTMLElement>('[data-quick-stage]');
  if (quickStageBtn) {
    const sIdx = quickStageBtn.dataset.quickStage || '0';
    const row = document.querySelector<HTMLTableRowElement>(`tr[data-quick-row="${sIdx}"]`);
    if (row) {
      row.hidden = false;
      const inp = row.querySelector<HTMLInputElement>(`[data-quick-input="${sIdx}"]`);
      inp?.focus();
    }
    return;
  }
  const quickSaveBtn = target.closest<HTMLElement>('[data-quick-save]');
  if (quickSaveBtn) {
    const sIdx = Number(quickSaveBtn.dataset.quickSave);
    await commitQuickAddTask(sIdx);
    return;
  }
  const quickCancelBtn = target.closest<HTMLElement>('[data-quick-cancel]');
  if (quickCancelBtn) {
    const sIdx = quickCancelBtn.dataset.quickCancel || '0';
    const row = document.querySelector<HTMLTableRowElement>(`tr[data-quick-row="${sIdx}"]`);
    if (row) row.hidden = true;
    return;
  }

  // Samples view row buttons
  const approveBtn = target.closest<HTMLElement>('[data-sample-approve]');
  if (approveBtn) {
    const [prodId, sampleId] = (approveBtn.dataset.sampleApprove || '').split(':');
    const prod = products.find((p) => p.id === prodId);
    const samp = prod?.samples.find((s) => s.id === sampleId);
    if (prod && samp) {
      const next = !samp.isApproved;
      if (next) {
        prod.samples.forEach((s) => {
          s.isApproved = s.id === sampleId;
        });
        if (samp.testResult === 'pending') samp.testResult = 'go';
      } else {
        samp.isApproved = false;
      }
      render(true);
      try {
        await apiApproveSample(prodId, sampleId, next);
        showToast(next ? `Đã chốt mẫu ${samp.rdCode} cho sản phẩm` : `Đã bỏ chốt mẫu ${samp.rdCode}`);
      } catch (err: any) {
        await refreshFromServer(true);
        showToast(err?.message || 'Lỗi cập nhật trạng thái chốt mẫu');
      }
    }
    return;
  }

  const priceBtn = target.closest<HTMLElement>('[data-sample-price]');
  if (priceBtn) {
    const [prodId, sampleId] = (priceBtn.dataset.samplePrice || '').split(':');
    openPriceModal(prodId, sampleId);
    return;
  }

  const histBtn = target.closest<HTMLElement>('[data-sample-history]');
  if (histBtn) {
    const [prodId, sampleId] = (histBtn.dataset.sampleHistory || '').split(':');
    openHistoryModal(prodId, sampleId);
    return;
  }

  const editSampBtn = target.closest<HTMLElement>('[data-sample-edit]');
  if (editSampBtn) {
    const [prodId, sampleId] = (editSampBtn.dataset.sampleEdit || '').split(':');
    openSampleModal({ productId: prodId, sampleId });
    return;
  }
});

// Separate click handler for History button in View Mode (since above had `if (!editMode) return;`!)
mainEl.addEventListener('click', (e) => {
  if (editMode) return;
  const histBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-sample-history]');
  if (histBtn) {
    const [prodId, sampleId] = (histBtn.dataset.sampleHistory || '').split(':');
    openHistoryModal(prodId, sampleId);
  }
});

// Inline selects (Task status & Sample testResult)
mainEl.addEventListener('change', async (e) => {
  if (!editMode) return;
  const target = e.target as HTMLElement;

  if (target instanceof HTMLSelectElement && target.dataset.inlineStatus) {
    const tid = target.dataset.inlineStatus;
    const val = target.value as TaskStatus;
    await updateTaskOnActiveProduct(tid, (t) => {
      t.status = val;
    });
    return;
  }

  if (target instanceof HTMLSelectElement && target.dataset.sampleResult) {
    const [prodId, sampleId] = target.dataset.sampleResult.split(':');
    const prod = products.find((p) => p.id === prodId);
    const samp = prod?.samples.find((s) => s.id === sampleId);
    if (prod && samp) {
      const prevRes = samp.testResult;
      const prevDate = samp.testDate;
      samp.testResult = target.value as SampleTestResult;
      if (!samp.testDate) samp.testDate = getTodayStr();
      render(true);
      try {
        await apiSaveSample(prod.id, samp);
        showToast(`Đã cập nhật kết quả test ${samp.rdCode}`);
      } catch (err: any) {
        samp.testResult = prevRes;
        samp.testDate = prevDate;
        render(true);
        showToast(err?.message || 'Lỗi lưu kết quả test');
      }
    }
  }
});

mainEl.addEventListener('keydown', (e) => {
  if (!editMode) return;
  const target = e.target as HTMLElement;
  if (
    target instanceof HTMLInputElement &&
    (target.dataset.quickInput !== undefined || target.dataset.quickPic !== undefined)
  ) {
    const sIdx = Number(target.dataset.quickInput ?? target.dataset.quickPic);
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitQuickAddTask(sIdx);
    } else if (e.key === 'Escape') {
      const row = document.querySelector<HTMLTableRowElement>(`tr[data-quick-row="${sIdx}"]`);
      if (row) row.hidden = true;
    }
  }
});

async function commitQuickAddTask(stageIdx: number): Promise<void> {
  const row = document.querySelector<HTMLTableRowElement>(`tr[data-quick-row="${stageIdx}"]`);
  if (!row) return;
  const nameInput = row.querySelector<HTMLInputElement>(`[data-quick-input="${stageIdx}"]`);
  const picInput = row.querySelector<HTMLInputElement>(`[data-quick-pic="${stageIdx}"]`);
  const name = nameInput?.value.trim() || '';
  if (!name) {
    nameInput?.focus();
    return;
  }
  const prod = products.find((p) => p.id === activeProductId);
  if (!prod) return;
  const newTask: Task = {
    id: uid(),
    stage: stageIdx,
    name,
    pic: picInput?.value.trim() || '',
    status: 'not',
    start: '',
    end: '',
    note: '',
    isMilestone: false,
    priority: 'normal',
  };
  prod.tasks.push(newTask);
  render(true);
  try {
    await apiSaveTask(prod.id, newTask);
    showToast(`Đã thêm "${name}"`);
  } catch (err: any) {
    prod.tasks = prod.tasks.filter((t) => t.id !== newTask.id);
    render(true);
    showToast(err?.message || 'Lỗi lưu công việc mới');
  }
}

/* ---------- 13-Month Grid Drag + Two-Click Selection ---------- */
mainEl.addEventListener('pointerdown', (e) => {
  if (!editMode) return;
  const cell = (e.target as HTMLElement).closest<HTMLElement>('.mo-cell[data-mo-task]');
  if (!cell || e.button !== 0) return;

  const taskId = cell.dataset.moTask || '';
  const moIdx = Number(cell.dataset.moIdx);

  if (twoClickAnchor && twoClickAnchor.taskId === taskId) {
    void commitMonthSpan(taskId, twoClickAnchor.anchorMonth, moIdx);
    return;
  }

  twoClickAnchor = null;
  pendingMonthPick = {
    taskId,
    anchorMonth: moIdx,
    hoverMonth: moIdx,
    isDragging: true,
  };
  updateMonthPreviewDom();
});

mainEl.addEventListener('pointerover', (e) => {
  if (!editMode) return;
  const cell = (e.target as HTMLElement).closest<HTMLElement>('.mo-cell[data-mo-task]');
  if (!cell) return;
  const taskId = cell.dataset.moTask || '';
  const moIdx = Number(cell.dataset.moIdx);

  if (pendingMonthPick && pendingMonthPick.taskId === taskId) {
    if (pendingMonthPick.hoverMonth !== moIdx) {
      pendingMonthPick.hoverMonth = moIdx;
      updateMonthPreviewDom();
    }
  } else if (twoClickAnchor && twoClickAnchor.taskId === taskId) {
    pendingMonthPick = {
      taskId,
      anchorMonth: twoClickAnchor.anchorMonth,
      hoverMonth: moIdx,
      isDragging: false,
    };
    updateMonthPreviewDom();
  }
});

window.addEventListener('pointerup', () => {
  if (!pendingMonthPick || !pendingMonthPick.isDragging) return;
  const { taskId, anchorMonth, hoverMonth } = pendingMonthPick;
  if (hoverMonth !== anchorMonth) {
    void commitMonthSpan(taskId, anchorMonth, hoverMonth);
  } else {
    twoClickAnchor = { taskId, anchorMonth };
    pendingMonthPick = { taskId, anchorMonth, hoverMonth: anchorMonth, isDragging: false };
    render(true);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (pendingMonthPick || twoClickAnchor)) {
    pendingMonthPick = null;
    twoClickAnchor = null;
    render(true);
  }
  const lbDlg = $<HTMLDialogElement>('lightboxDialog');
  if (lbDlg.open && lightboxState) {
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    else if (e.key === 'ArrowRight') navigateLightbox(1);
  }
});

/* ---------- Multi-Image Upload Handler ---------- */
$<HTMLInputElement>('sampleImageUploadInput').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length || !uploadTargetSampleRef) return;

  const { productId, sampleId } = uploadTargetSampleRef;
  uploadTargetSampleRef = null;
  const prod = products.find((p) => p.id === productId);
  const samp = prod?.samples.find((s) => s.id === sampleId);
  if (!prod || !samp) return;

  showToast(`Đang tối ưu và tải ${files.length} ảnh lên Cloud SQL...`);
  try {
    const newImgs: SampleImage[] = [];
    for (const f of files) {
      const compressed = await compressImageFile(f);
      newImgs.push({
        id: uid(),
        caption: f.name.replace(/\.[^.]+$/, ''),
        mimeType: compressed.mimeType,
        dataUrl: compressed.dataUrl,
        uploadedBy: currentUser?.email || '',
      });
    }
    await apiUploadSampleImages(sampleId, newImgs);
    samp.images = [...(samp.images || []), ...newImgs];
    render(true);
    showToast(`Đã tải lên ${newImgs.length} ảnh cho mẫu ${samp.rdCode}`);
  } catch (err: any) {
    showToast(err?.message || 'Lỗi tải ảnh lên');
  }
};

/* ---------- Lightbox Viewer ---------- */
function openLightbox(productId: string, sampleId: string, imageId?: string): void {
  const prod = products.find((p) => p.id === productId);
  const samp = prod?.samples.find((s) => s.id === sampleId);
  if (!prod || !samp || !(samp.images || []).length) return;

  let index = 0;
  if (imageId) {
    const foundIdx = samp.images.findIndex((i) => i.id === imageId);
    if (foundIdx >= 0) index = foundIdx;
  }
  lightboxState = { productId, sampleId, index };
  renderLightboxContent();
  $<HTMLDialogElement>('lightboxDialog').showModal();
}

function renderLightboxContent(): void {
  if (!lightboxState) return;
  const prod = products.find((p) => p.id === lightboxState!.productId);
  const samp = prod?.samples.find((s) => s.id === lightboxState!.sampleId);
  if (!prod || !samp || !samp.images.length) {
    $<HTMLDialogElement>('lightboxDialog').close();
    return;
  }

  if (lightboxState.index >= samp.images.length) lightboxState.index = samp.images.length - 1;
  if (lightboxState.index < 0) lightboxState.index = 0;

  const img = samp.images[lightboxState.index];
  $('lbTitle').textContent = `${samp.rdCode} — ${prod.name}`;
  $('lbSubtitle').textContent = `Ảnh ${lightboxState.index + 1}/${samp.images.length}${
    img.uploadedBy ? ` · Tải bởi ${img.uploadedBy}` : ''
  }`;

  const lbImg = $<HTMLImageElement>('lbImg');
  lbImg.src = img.dataUrl;
  lbImg.alt = img.caption || samp.rdCode;

  const capText = $('lbCaptionText');
  const capInput = $<HTMLInputElement>('lbCaptionInput');
  const saveCapBtn = $('lbSaveCapBtn');
  const delImgBtn = $('lbDeleteImgBtn');

  if (editMode) {
    capText.hidden = true;
    capInput.hidden = false;
    capInput.value = img.caption || '';
    saveCapBtn.hidden = false;
    delImgBtn.hidden = false;
  } else {
    capText.hidden = false;
    capText.textContent = img.caption || 'Không có chú thích';
    capInput.hidden = true;
    saveCapBtn.hidden = true;
    delImgBtn.hidden = true;
  }

  $('lbThumbs').innerHTML = samp.images
    .map(
      (item, idx) =>
        `<button type="button" class="thumb-btn ${
          idx === lightboxState!.index ? 'active' : ''
        }" data-lb-idx="${idx}"><img src="${esc(item.dataUrl)}" alt="" referrerpolicy="no-referrer"></button>`
    )
    .join('');
}

function navigateLightbox(delta: number): void {
  if (!lightboxState) return;
  const prod = products.find((p) => p.id === lightboxState!.productId);
  const samp = prod?.samples.find((s) => s.id === lightboxState!.sampleId);
  if (!samp || !samp.images.length) return;
  const len = samp.images.length;
  lightboxState.index = (lightboxState.index + delta + len) % len;
  renderLightboxContent();
}

$('lbPrevBtn').onclick = () => navigateLightbox(-1);
$('lbNextBtn').onclick = () => navigateLightbox(1);
$('lbCloseBtn').onclick = () => {
  lightboxState = null;
  $<HTMLDialogElement>('lightboxDialog').close();
};
$('lbThumbs').onclick = (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-lb-idx]');
  if (btn && lightboxState) {
    lightboxState.index = Number(btn.dataset.lbIdx);
    renderLightboxContent();
  }
};
$('lbSaveCapBtn').onclick = async () => {
  if (!lightboxState) return;
  const prod = products.find((p) => p.id === lightboxState!.productId);
  const samp = prod?.samples.find((s) => s.id === lightboxState!.sampleId);
  const img = samp?.images[lightboxState.index];
  if (!img) return;
  const caption = $<HTMLInputElement>('lbCaptionInput').value.trim();
  try {
    await apiUpdateImageCaption(img.id, caption);
    img.caption = caption;
    renderLightboxContent();
    showToast('Đã lưu chú thích ảnh');
  } catch (err: any) {
    showToast(err?.message || 'Lỗi lưu chú thích');
  }
};
$('lbDeleteImgBtn').onclick = async () => {
  if (!lightboxState) return;
  const prod = products.find((p) => p.id === lightboxState!.productId);
  const samp = prod?.samples.find((s) => s.id === lightboxState!.sampleId);
  const img = samp?.images[lightboxState.index];
  if (!samp || !img) return;
  const ok = await askConfirm('Xóa hình ảnh', 'Xóa hình ảnh này khỏi mẫu R&D?', 'Xóa ảnh', true);
  if (!ok) return;
  try {
    await apiDeleteSampleImage(img.id);
    samp.images = samp.images.filter((i) => i.id !== img.id);
    render(true);
    renderLightboxContent();
    showToast('Đã xóa ảnh');
  } catch (err: any) {
    showToast(err?.message || 'Lỗi xóa ảnh');
  }
};

/* ---------- Top Bar & Workspace Bar Handlers ---------- */
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
  btn.onclick = () => {
    const tab = btn.dataset.tab as ViewTab;
    activeTab = tab;
    if (tab !== 'products') activeProductId = null;
    pendingMonthPick = null;
    twoClickAnchor = null;
    render();
  };
});

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
  btn.onclick = () => {
    if (!canEdit()) return;
    editMode = btn.dataset.mode === 'edit';
    pendingMonthPick = null;
    twoClickAnchor = null;
    render();
    showToast(editMode ? 'Đã bật Chế độ Nhập liệu' : 'Đã chuyển sang Chế độ Xem');
  };
});

$('brandLink').onclick = (e) => {
  e.preventDefault();
  activeTab = 'report';
  activeProductId = null;
  render();
};

$('cycleSelect').onchange = () => {
  currentCycle = Number($<HTMLSelectElement>('cycleSelect').value);
  activeProductId = null;
  pendingMonthPick = null;
  twoClickAnchor = null;
  render();
};

$('refreshBtn').onclick = async () => {
  await refreshFromServer(true);
  showToast('Đã cập nhật dữ liệu mới nhất');
};

$('signOutBtn').onclick = async () => {
  await signOut(auth);
};

$('newProductBtn').onclick = () => openProductModal(null);

$('themeToggleBtn').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  saveTheme(theme);
  applyTheme();
};

$('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(products, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `product-tracker-${getTodayStr()}.json`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Đã xuất file JSON sao lưu');
};

$('importBtn').onclick = () => $('importFileInput').click();
$<HTMLInputElement>('importFileInput').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed) || parsed.some((item) => !item || !item.id || !item.name)) {
      throw new Error('Invalid');
    }
    const ok = await askConfirm(
      'Nhập dữ liệu JSON lên Cloud SQL',
      `Nhập ${parsed.length} sản phẩm từ file? Các sản phẩm trùng ID sẽ được cập nhật trên Cloud SQL.`,
      'Nhập lên Cloud'
    );
    if (!ok) return;
    const normalizedList = parsed.map(normalizeProduct);
    await apiImportProducts(normalizedList);
    await refreshFromServer(true);
    showToast(`Đã nhập ${normalizedList.length} sản phẩm lên Cloud SQL`);
  } catch (err: any) {
    await askConfirm(
      'Lỗi nhập file',
      err?.message || 'File JSON không đúng định dạng Product Timeline Tracker.',
      'Đóng'
    );
  }
};

/* ---------- Member Access Management Modal (Admin) ---------- */
$('membersBtn').onclick = () => openMembersModal();
$('memCloseBtn').onclick = () => $<HTMLDialogElement>('membersDialog').close();

async function openMembersModal(): Promise<void> {
  const dlg = $<HTMLDialogElement>('membersDialog');
  $('memListWrap').innerHTML = `<div class="empty-box"><p>Đang tải danh sách thành viên...</p></div>`;
  dlg.showModal();
  await reloadMembersTable();
}

async function reloadMembersTable(): Promise<void> {
  try {
    const { users, invites } = await apiListMembers();
    const merged = new Map<string, { email: string; displayName: string; role: UserRole; signedIn: boolean }>();
    for (const inv of invites) {
      merged.set(inv.email, {
        email: inv.email,
        displayName: 'Chưa đăng nhập',
        role: inv.role,
        signedIn: false,
      });
    }
    for (const u of users) {
      merged.set(u.email, {
        email: u.email,
        displayName: u.displayName || '—',
        role: u.role,
        signedIn: true,
      });
    }

    const rows = Array.from(merged.values())
      .sort((a, b) => a.email.localeCompare(b.email))
      .map(
        (m) => `<tr>
          <td><strong>${esc(m.email)}</strong></td>
          <td class="mut">${esc(m.displayName)}</td>
          <td>${
            m.role === 'admin'
              ? '<span class="status-txt status-done">Admin</span>'
              : m.role === 'editor'
              ? '<span class="status-txt status-prog">Nhập liệu (Editor)</span>'
              : '<span class="mut">Chỉ Xem (Viewer)</span>'
          }</td>
          <td>${
            m.email === currentUser?.email
              ? '<span class="mut">Bạn</span>'
              : `<div class="row-actions">
                  <button type="button" class="btn-sm" data-mem-role="${esc(m.email)}:editor">Cho Nhập liệu</button>
                  <button type="button" class="btn-sm" data-mem-role="${esc(m.email)}:viewer">Chỉ Xem</button>
                  ${
                    !m.signedIn
                      ? `<button type="button" class="btn-sm btn-danger" data-mem-del="${esc(m.email)}">Xóa</button>`
                      : ''
                  }
                </div>`
          }</td>
        </tr>`
      )
      .join('');

    $('memListWrap').innerHTML = `<table class="data-table">
      <thead><tr><th>Email</th><th>Tên</th><th>Quyền hiện tại</th><th>Điều chỉnh</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  } catch (err: any) {
    $('memListWrap').innerHTML = `<div class="empty-box"><p class="status-txt status-late">${esc(
      err?.message || 'Không tải được danh sách.'
    )}</p></div>`;
  }
}

$('memAddBtn').onclick = async () => {
  const email = $<HTMLInputElement>('memEmailInput').value.trim().toLowerCase();
  const role = $<HTMLSelectElement>('memRoleSelect').value as UserRole;
  if (!email || !email.includes('@')) {
    $<HTMLInputElement>('memEmailInput').focus();
    return;
  }
  try {
    await apiSetMemberRole(email, role);
    $<HTMLInputElement>('memEmailInput').value = '';
    await reloadMembersTable();
    showToast(`Đã cấp quyền ${role} cho ${email}`);
  } catch (err: any) {
    showToast(err?.message || 'Lỗi cấp quyền');
  }
};

$('memListWrap').onclick = async (e) => {
  const target = e.target as HTMLElement;
  const roleBtn = target.closest<HTMLElement>('[data-mem-role]');
  if (roleBtn) {
    const [email, role] = (roleBtn.dataset.memRole || '').split(':');
    await apiSetMemberRole(email, role as UserRole);
    await reloadMembersTable();
    showToast(`Đã cập nhật quyền cho ${email}`);
    return;
  }
  const delBtn = target.closest<HTMLElement>('[data-mem-del]');
  if (delBtn) {
    const email = delBtn.dataset.memDel || '';
    await apiRemoveInvite(email);
    await reloadMembersTable();
    showToast(`Đã xóa lời mời ${email}`);
  }
};

/* ---------- Product Modal ---------- */
function openProductModal(prod: Product | null): void {
  if (!editMode) return;
  editingProductId = prod?.id || null;
  const dlg = $<HTMLDialogElement>('productDialog');
  $('prodDlgTitle').textContent = prod ? 'Sửa thông tin sản phẩm' : 'Sản phẩm mới';
  $<HTMLInputElement>('pName').value = prod?.name || '';
  $<HTMLInputElement>('pCategory').value = prod?.category || '';
  $<HTMLInputElement>('pLaunch').value = prod?.launch || '';

  const cycles = getAvailableCycles();
  const selectedCycle = prod ? prod.cycleStartYear : currentCycle;
  $('pCycle').innerHTML = cycles
    .map(
      (y) =>
        `<option value="${y}" ${y === selectedCycle ? 'selected' : ''}>${formatCycleLabel(y)}</option>`
    )
    .join('');

  $('pTemplateWrap').style.display = prod ? 'none' : 'inline-flex';
  $('pDeleteBtn').style.display = prod ? '' : 'none';
  dlg.showModal();
}

$('pCancelBtn').onclick = () => $<HTMLDialogElement>('productDialog').close();

$<HTMLInputElement>('pLaunch').onchange = () => {
  const launch = $<HTMLInputElement>('pLaunch').value;
  if (!editingProductId && launch) {
    const inferred = inferCycleFromDate(launch);
    const sel = $<HTMLSelectElement>('pCycle');
    if (Array.from(sel.options).some((o) => Number(o.value) === inferred)) {
      sel.value = String(inferred);
    }
  }
};

$('pSaveBtn').onclick = async () => {
  const name = $<HTMLInputElement>('pName').value.trim();
  if (!name) {
    $<HTMLInputElement>('pName').focus();
    return;
  }
  const category = $<HTMLInputElement>('pCategory').value.trim();
  const launch = $<HTMLInputElement>('pLaunch').value;
  const cycleStartYear = Number($<HTMLSelectElement>('pCycle').value) || currentCycle;
  const withTpl = $<HTMLInputElement>('pTemplate').checked;

  try {
    if (editingProductId) {
      const prod = products.find((p) => p.id === editingProductId);
      if (prod) {
        prod.name = name;
        prod.category = category;
        prod.launch = launch;
        prod.cycleStartYear = cycleStartYear;
        await apiSaveProduct(prod, false);
      }
    } else {
      const newProd: Product = {
        id: uid(),
        name,
        category,
        launch,
        cycleStartYear,
        tasks: withTpl
          ? TASK_TEMPLATE.map(([stage, tName, pic, isMilestone]) => ({
              id: uid(),
              stage,
              name: tName,
              pic,
              status: 'not',
              start: '',
              end: '',
              note: '',
              isMilestone: Boolean(isMilestone),
              priority: 'normal',
            }))
          : [],
        samples: [],
      };
      await apiSaveProduct(newProd, true);
      products.push(newProd);
      activeTab = 'products';
      activeProductId = newProd.id;
    }

    currentCycle = cycleStartYear;
    $<HTMLDialogElement>('productDialog').close();
    render();
    showToast(editingProductId ? 'Đã cập nhật sản phẩm' : `Đã tạo sản phẩm "${name}"`);
  } catch (err: any) {
    showToast(err?.message || 'Lỗi lưu sản phẩm');
  }
};

$('pDeleteBtn').onclick = async () => {
  if (!editingProductId) return;
  const prod = products.find((p) => p.id === editingProductId);
  const ok = await askConfirm(
    'Xóa sản phẩm',
    `Xóa "${prod?.name || ''}" cùng toàn bộ công việc và mẫu R&D liên quan trên Cloud SQL?`,
    'Xóa vĩnh viễn',
    true
  );
  if (!ok) return;
  try {
    await apiDeleteProduct(editingProductId);
    products = products.filter((p) => p.id !== editingProductId);
    if (activeProductId === editingProductId) activeProductId = null;
    $<HTMLDialogElement>('productDialog').close();
    render();
    showToast('Đã xóa sản phẩm');
  } catch (err: any) {
    showToast(err?.message || 'Lỗi xóa sản phẩm');
  }
};

/* ---------- Task Detail Modal ---------- */
function openTaskModal(task: Task | null): void {
  if (!editMode) return;
  editingTaskId = task?.id || null;
  const dlg = $<HTMLDialogElement>('taskDialog');
  $('tStage').innerHTML = STAGES.map((s, i) => `<option value="${i}">${esc(s)}</option>`).join('');
  $('taskDlgTitle').textContent = task ? 'Chi tiết công việc' : 'Thêm công việc mới';

  $<HTMLSelectElement>('tStage').value = String(
    task ? task.stage : timelineFilter.stage === 'all' ? 0 : timelineFilter.stage
  );
  $<HTMLInputElement>('tName').value = task?.name || '';
  $<HTMLInputElement>('tPic').value = task?.pic || '';
  $<HTMLSelectElement>('tStatus').value = task?.status || 'not';
  $<HTMLInputElement>('tStart').value = task?.start || '';
  $<HTMLInputElement>('tEnd').value = task?.end || '';
  $<HTMLInputElement>('tMilestone').checked = Boolean(task?.isMilestone);
  $<HTMLSelectElement>('tPriority').value = task?.priority || 'normal';
  $<HTMLTextAreaElement>('tNote').value = task?.note || '';

  $('tDeleteBtn').style.display = task ? '' : 'none';
  dlg.showModal();
}

$('tCancelBtn').onclick = () => $<HTMLDialogElement>('taskDialog').close();

$('tSaveBtn').onclick = async () => {
  const name = $<HTMLInputElement>('tName').value.trim();
  if (!name) {
    $<HTMLInputElement>('tName').focus();
    return;
  }
  const prod = products.find((p) => p.id === activeProductId);
  if (!prod) return;

  let start = $<HTMLInputElement>('tStart').value;
  let end = $<HTMLInputElement>('tEnd').value;
  if (start && end && start > end) [start, end] = [end, start];

  const payload: Task = {
    id: editingTaskId || uid(),
    stage: Number($<HTMLSelectElement>('tStage').value) || 0,
    name,
    pic: $<HTMLInputElement>('tPic').value.trim(),
    status: $<HTMLSelectElement>('tStatus').value as TaskStatus,
    start,
    end,
    isMilestone: $<HTMLInputElement>('tMilestone').checked,
    priority: $<HTMLSelectElement>('tPriority').value as TaskPriority,
    note: $<HTMLTextAreaElement>('tNote').value.trim(),
  };

  try {
    await apiSaveTask(prod.id, payload);
    const idx = prod.tasks.findIndex((t) => t.id === payload.id);
    if (idx < 0) prod.tasks.push(payload);
    else prod.tasks[idx] = payload;
    $<HTMLDialogElement>('taskDialog').close();
    render(true);
    showToast('Đã lưu công việc');
  } catch (err: any) {
    showToast(err?.message || 'Lỗi lưu công việc');
  }
};

$('tDeleteBtn').onclick = async () => {
  const prod = products.find((p) => p.id === activeProductId);
  if (!prod || !editingTaskId) return;
  try {
    await apiDeleteTask(editingTaskId);
    prod.tasks = prod.tasks.filter((t) => t.id !== editingTaskId);
    $<HTMLDialogElement>('taskDialog').close();
    render(true);
    showToast('Đã xóa công việc');
  } catch (err: any) {
    showToast(err?.message || 'Lỗi xóa công việc');
  }
};

/* ---------- R&D Sample Modal ---------- */
function openSampleModal(ref: { productId: string; sampleId: string } | null): void {
  if (!editMode) return;
  if (!products.length) {
    openProductModal(null);
    return;
  }
  editingSampleRef = ref;
  const dlg = $<HTMLDialogElement>('sampleDialog');
  const prodSel = $<HTMLSelectElement>('sProduct');
  prodSel.innerHTML = products
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${formatCycleLabel(p.cycleStartYear)})</option>`)
    .join('');

  const prod = ref
    ? products.find((p) => p.id === ref.productId)
    : products.find((p) => p.id === (samplesFilter.productId || activeProductId)) || products[0];
  const samp = ref ? prod?.samples.find((s) => s.id === ref.sampleId) || null : null;

  $('sampleDlgTitle').textContent = samp ? `Sửa mẫu ${samp.rdCode}` : 'Thêm mã mẫu R&D mới';
  prodSel.value = prod?.id || products[0].id;
  prodSel.disabled = Boolean(samp);

  $<HTMLInputElement>('sCode').value = samp?.rdCode || '';
  $<HTMLInputElement>('sVersion').value = samp?.version || '';
  $<HTMLInputElement>('sPic').value = samp?.pic || '';
  $<HTMLInputElement>('sTestDate').value = samp?.testDate || '';
  $<HTMLSelectElement>('sResult').value = samp?.testResult || 'pending';
  $<HTMLInputElement>('sCvsPrice').value = samp?.cvsPrice ? String(samp.cvsPrice) : '';
  $<HTMLInputElement>('sPackCost').value = samp?.packagingCost ? String(samp.packagingCost) : '';
  $<HTMLInputElement>('sSellPrice').value = samp?.sellPrice ? String(samp.sellPrice) : '';
  $<HTMLInputElement>('sModalImages').value = '';
  $<HTMLInputElement>('sApproved').checked = Boolean(samp?.isApproved);
  $<HTMLTextAreaElement>('sNote').value = samp?.note || '';

  $('sInitialPriceBlock').style.display = samp ? 'none' : 'grid';
  $('sDeleteBtn').style.display = samp ? '' : 'none';
  dlg.showModal();
}

$('sCancelBtn').onclick = () => $<HTMLDialogElement>('sampleDialog').close();

$('sSaveBtn').onclick = async () => {
  const rdCode = $<HTMLInputElement>('sCode').value.trim();
  if (!rdCode) {
    $<HTMLInputElement>('sCode').focus();
    return;
  }
  const prodId = $<HTMLSelectElement>('sProduct').value;
  const prod = products.find((p) => p.id === prodId);
  if (!prod) return;

  const isApproved = $<HTMLInputElement>('sApproved').checked;
  const today = getTodayStr();
  const modalFiles = Array.from($<HTMLInputElement>('sModalImages').files || []);

  try {
    let targetSample: RDSample;
    if (editingSampleRef) {
      const existing = prod.samples.find((s) => s.id === editingSampleRef?.sampleId);
      if (!existing) return;
      if (isApproved) {
        prod.samples.forEach((s) => {
          s.isApproved = s.id === existing.id;
        });
      }
      existing.rdCode = rdCode;
      existing.version = $<HTMLInputElement>('sVersion').value.trim();
      existing.pic = $<HTMLInputElement>('sPic').value.trim();
      existing.testDate = $<HTMLInputElement>('sTestDate').value;
      existing.testResult = $<HTMLSelectElement>('sResult').value as SampleTestResult;
      existing.isApproved = isApproved;
      existing.note = $<HTMLTextAreaElement>('sNote').value.trim();
      await apiSaveSample(prod.id, existing);
      targetSample = existing;
    } else {
      if (isApproved) {
        prod.samples.forEach((s) => {
          s.isApproved = false;
        });
      }
      const cvsPrice = Number($<HTMLInputElement>('sCvsPrice').value) || 0;
      const packagingCost = Number($<HTMLInputElement>('sPackCost').value) || 0;
      const sellPrice = Number($<HTMLInputElement>('sSellPrice').value) || 0;
      const hasPrice = cvsPrice > 0 || packagingCost > 0 || sellPrice > 0;

      const newSample: RDSample = {
        id: uid(),
        rdCode,
        version: $<HTMLInputElement>('sVersion').value.trim(),
        pic: $<HTMLInputElement>('sPic').value.trim(),
        testDate: $<HTMLInputElement>('sTestDate').value,
        testResult: $<HTMLSelectElement>('sResult').value as SampleTestResult,
        isApproved,
        note: $<HTMLTextAreaElement>('sNote').value.trim(),
        cvsPrice,
        packagingCost,
        sellPrice,
        updatedAt: hasPrice ? today : '',
        priceHistory: hasPrice
          ? [
              {
                id: uid(),
                date: today,
                cvsPrice,
                packagingCost,
                sellPrice,
                reason: 'Khởi tạo giá ban đầu',
                updatedBy: currentUser?.email || '',
              },
            ]
          : [],
        images: [],
      };
      await apiSaveSample(prod.id, newSample);
      prod.samples.push(newSample);
      targetSample = newSample;
    }

    if (modalFiles.length > 0) {
      const uploadedImgs: SampleImage[] = [];
      for (const f of modalFiles) {
        const compressed = await compressImageFile(f);
        uploadedImgs.push({
          id: uid(),
          caption: f.name.replace(/\.[^.]+$/, ''),
          mimeType: compressed.mimeType,
          dataUrl: compressed.dataUrl,
          uploadedBy: currentUser?.email || '',
        });
      }
      await apiUploadSampleImages(targetSample.id, uploadedImgs);
      targetSample.images = [...(targetSample.images || []), ...uploadedImgs];
    }

    $<HTMLDialogElement>('sampleDialog').close();
    render(true);
    showToast(editingSampleRef ? `Đã cập nhật mẫu ${rdCode}` : `Đã thêm mẫu ${rdCode}`);
  } catch (err: any) {
    showToast(err?.message || 'Lỗi lưu mẫu R&D');
  }
};

$('sDeleteBtn').onclick = async () => {
  if (!editingSampleRef) return;
  const prod = products.find((p) => p.id === editingSampleRef?.productId);
  const samp = prod?.samples.find((s) => s.id === editingSampleRef?.sampleId);
  if (!prod || !samp) return;
  const ok = await askConfirm(
    'Xóa mã mẫu R&D',
    `Xóa mã mẫu "${samp.rdCode}", toàn bộ hình ảnh và lịch sử giá của mẫu này?`,
    'Xóa mẫu',
    true
  );
  if (!ok) return;
  try {
    await apiDeleteSample(samp.id);
    prod.samples = prod.samples.filter((s) => s.id !== samp.id);
    $<HTMLDialogElement>('sampleDialog').close();
    render(true);
    showToast(`Đã xóa mẫu ${samp.rdCode}`);
  } catch (err: any) {
    showToast(err?.message || 'Lỗi xóa mẫu');
  }
};

/* ---------- Price Update Modal ---------- */
function updateMarginPreview(): void {
  const cvs = Number($<HTMLInputElement>('prCvs').value) || 0;
  const sell = Number($<HTMLInputElement>('prSell').value) || 0;
  const margin = calcMarginPct(cvs, sell);
  $('prMarginPreview').textContent = margin !== null ? `${margin}%` : '—';
}

['prCvs', 'prSell'].forEach((id) => {
  $(id).addEventListener('input', updateMarginPreview);
});

function openPriceModal(productId: string, sampleId: string): void {
  const prod = products.find((p) => p.id === productId);
  const samp = prod?.samples.find((s) => s.id === sampleId);
  if (!prod || !samp) return;
  pricingSampleRef = { productId, sampleId };

  $('priceTargetInfo').textContent = `${samp.rdCode} · ${prod.name} (Hiện tại: CVS ${fmtMoney(
    samp.cvsPrice
  )} · Bán ${fmtMoney(samp.sellPrice)})`;

  $<HTMLInputElement>('prCvs').value = String(samp.cvsPrice || 0);
  $<HTMLInputElement>('prPack').value = String(samp.packagingCost || 0);
  $<HTMLInputElement>('prSell').value = String(samp.sellPrice || 0);
  $<HTMLInputElement>('prDate').value = getTodayStr();
  $<HTMLInputElement>('prReason').value = '';
  updateMarginPreview();

  $<HTMLDialogElement>('priceDialog').showModal();
}

$('prCancelBtn').onclick = () => $<HTMLDialogElement>('priceDialog').close();

$('prSaveBtn').onclick = async () => {
  if (!pricingSampleRef) return;
  const prod = products.find((p) => p.id === pricingSampleRef?.productId);
  const samp = prod?.samples.find((s) => s.id === pricingSampleRef?.sampleId);
  if (!samp) return;

  const log = {
    id: uid(),
    date: $<HTMLInputElement>('prDate').value || getTodayStr(),
    cvsPrice: Number($<HTMLInputElement>('prCvs').value) || 0,
    packagingCost: Number($<HTMLInputElement>('prPack').value) || 0,
    sellPrice: Number($<HTMLInputElement>('prSell').value) || 0,
    reason: $<HTMLInputElement>('prReason').value.trim() || 'Cập nhật giá định kỳ',
    updatedBy: currentUser?.email || '',
  };

  try {
    await apiRecordPriceUpdate(samp.id, log);
    samp.cvsPrice = log.cvsPrice;
    samp.packagingCost = log.packagingCost;
    samp.sellPrice = log.sellPrice;
    samp.updatedAt = log.date;
    samp.priceHistory.push(log);

    $<HTMLDialogElement>('priceDialog').close();
    render(true);
    showToast(`Đã cập nhật giá mới cho ${samp.rdCode}`);
  } catch (err: any) {
    showToast(err?.message || 'Lỗi lưu lịch sử giá');
  }
};

/* ---------- Price History Modal ---------- */
function openHistoryModal(productId: string, sampleId: string): void {
  const prod = products.find((p) => p.id === productId);
  const samp = prod?.samples.find((s) => s.id === sampleId);
  if (!prod || !samp) return;

  $('histTargetInfo').textContent = `${samp.rdCode} — ${prod.name}${
    samp.version ? ` (${samp.version})` : ''
  }`;

  const logs = (samp.priceHistory || []).slice();
  if (!logs.length) {
    $('histContent').innerHTML = `<div class="empty-box"><p>Chưa có bản ghi cập nhật giá nào cho mẫu này.</p></div>`;
  } else {
    const rows = logs
      .map((log, i) => {
        const prev = i > 0 ? logs[i - 1] : null;
        const deltaCvs = prev ? log.cvsPrice - prev.cvsPrice : 0;
        const deltaText =
          prev && deltaCvs !== 0
            ? `<span class="${deltaCvs > 0 ? 'status-txt status-late' : 'status-txt status-done'}">${
                deltaCvs > 0 ? '+' : ''
              }${new Intl.NumberFormat('vi-VN').format(deltaCvs)} đ</span>`
            : `<span class="mut">—</span>`;
        const margin = calcMarginPct(log.cvsPrice, log.sellPrice);

        return `<tr>
          <td class="num">${fmtDate(log.date, true)}</td>
          <td class="num mono-sm"><strong>${fmtMoney(log.cvsPrice)}</strong></td>
          <td class="num mono-sm">${deltaText}</td>
          <td class="num mono-sm">${fmtMoney(log.packagingCost)}</td>
          <td class="num mono-sm"><strong>${fmtMoney(log.sellPrice)}</strong></td>
          <td class="num mono-sm">${margin !== null ? `${margin}%` : '—'}</td>
          <td>${esc(log.reason || '—')}</td>
        </tr>`;
      })
      .reverse()
      .join('');

    $('histContent').innerHTML = `<table class="data-table">
      <thead>
        <tr>
          <th class="num">Ngày</th>
          <th class="num">Giá CVS</th>
          <th class="num">Chênh lệch</th>
          <th class="num">Bao bì / NL</th>
          <th class="num">Giá bán DK</th>
          <th class="num">Biên LN</th>
          <th>Lý do cập nhật</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  $<HTMLDialogElement>('historyDialog').showModal();
}

$('histCloseBtn').onclick = () => $<HTMLDialogElement>('historyDialog').close();

/* ---------- Auth Boot ---------- */
applyTheme();
render();

onAuthStateChanged(auth, async (fbUser) => {
  authReady = true;
  if (!fbUser) {
    currentUser = null;
    products = [];
    editMode = false;
    isLoadingData = false;
    render();
    return;
  }
  await refreshFromServer();
});
