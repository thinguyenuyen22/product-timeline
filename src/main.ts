import { createDemoProducts, STAGES, TASK_TEMPLATE } from './data/template';
import { loadProducts, loadTheme, normalizeProduct, saveProducts, saveTheme } from './storage';
import type {
  CycleWeek,
  Product,
  RDSample,
  SampleTestResult,
  Task,
  TaskPriority,
  TaskStatus,
  ViewTab,
} from './types';
import {
  calcMarginPct,
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
  type TimelineFilterState,
  type WeekPickState,
} from './views/timeline';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let products: Product[] = loadProducts();
let currentCycle = 2026; // Default 03/2026 - 03/2027
let activeTab: ViewTab = 'report';
let activeProductId: string | null = null;
let theme: 'light' | 'dark' = loadTheme();

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
  milestoneOnly: false,
  search: '',
};

const samplesFilter: SamplesFilterState = {
  productId: '',
  cycleMode: 'current',
  result: 'all',
  search: '',
};

let currentTimelineWeeks: CycleWeek[] = [];
let pendingWeekPick: WeekPickState | null = null;
let twoClickAnchor: { taskId: string; anchorWeek: number } | null = null;

// Modal editing context
let editingProductId: string | null = null;
let editingTaskId: string | null = null;
let editingSampleRef: { productId: string; sampleId: string } | null = null;
let pricingSampleRef: { productId: string; sampleId: string } | null = null;

let toastTimer: number | undefined;
function showToast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.remove('show');
  }, 2400);
}

function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', theme);
  $('themeToggleBtn').textContent = theme === 'dark' ? 'Chế độ sáng' : 'Chế độ tối';
}

function askConfirm(title: string, message: string, okLabel = 'Xác nhận', isDanger = false): Promise<boolean> {
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

function persistAndRender(preserveScroll = false): void {
  saveProducts(products);
  render(preserveScroll);
}

function render(preserveScroll = false): void {
  const prevWinY = preserveScroll ? window.scrollY : 0;
  const ganttEl = document.getElementById('ganttScrollWrap');
  const prevGanttLeft = preserveScroll && ganttEl ? ganttEl.scrollLeft : 0;

  // Sync cycle dropdown
  const cycles = getAvailableCycles();
  $('cycleSelect').innerHTML = cycles
    .map(
      (y) =>
        `<option value="${y}" ${y === currentCycle ? 'selected' : ''}>${formatCycleLabel(y)}</option>`
    )
    .join('');

  // Sync top nav active tab
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
  });

  const mainEl = $('main');

  if (activeTab === 'report') {
    mainEl.innerHTML = renderReportView(products, currentCycle, reportFilter);
  } else if (activeTab === 'samples') {
    mainEl.innerHTML = renderSamplesView(products, currentCycle, samplesFilter);
  } else {
    const selectedProduct = activeProductId
      ? products.find((p) => p.id === activeProductId) || null
      : null;

    if (selectedProduct) {
      const { html, weeks } = renderTimelineView(
        selectedProduct,
        selectedProduct.cycleStartYear,
        timelineFilter,
        pendingWeekPick
      );
      currentTimelineWeeks = weeks;
      mainEl.innerHTML = html;
    } else {
      activeProductId = null;
      mainEl.innerHTML = renderProductsView(products, currentCycle, productsSearch);
    }
  }

  bindMainViewDynamicListeners();

  if (preserveScroll) {
    window.scrollTo({ top: prevWinY });
    const nextGanttEl = document.getElementById('ganttScrollWrap');
    if (nextGanttEl) nextGanttEl.scrollLeft = prevGanttLeft;
  }
}

function bindMainViewDynamicListeners(): void {
  // Report view filters
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
  if (repPrint) {
    repPrint.onclick = () => window.print();
  }

  // Products view search
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

  // Timeline view filters
  const tlStage = document.getElementById('tlStageFilter') as HTMLSelectElement | null;
  if (tlStage) {
    tlStage.onchange = () => {
      timelineFilter.stage = tlStage.value === 'all' ? 'all' : Number(tlStage.value);
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

  // Samples view filters
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

/* ---------- Inline Task Updates & Week Selection ---------- */
function updateTaskOnActiveProduct(taskId: string, updater: (t: Task) => void, msg?: string): void {
  const prod = products.find((p) => p.id === activeProductId);
  if (!prod) return;
  const task = prod.tasks.find((t) => t.id === taskId);
  if (!task) return;
  updater(task);
  persistAndRender(true);
  if (msg) showToast(msg);
}

function updateWeekPreviewDom(): void {
  document.querySelectorAll<HTMLElement>('.wk-cell.preview').forEach((el) => {
    el.classList.remove('preview');
  });
  if (!pendingWeekPick) return;
  const minW = Math.min(pendingWeekPick.anchorWeek, pendingWeekPick.hoverWeek);
  const maxW = Math.max(pendingWeekPick.anchorWeek, pendingWeekPick.hoverWeek);
  const row = document.querySelector<HTMLElement>(
    `tr[data-task-row="${CSS.escape(pendingWeekPick.taskId)}"]`
  );
  if (!row) return;
  row.querySelectorAll<HTMLElement>('.wk-cell').forEach((cell) => {
    const idx = Number(cell.dataset.wkIdx);
    if (idx >= minW && idx <= maxW) {
      cell.classList.add('preview');
    }
  });
}

function commitWeekSpan(taskId: string, wA: number, wB: number): void {
  const minW = Math.min(wA, wB);
  const maxW = Math.max(wA, wB);
  const startWeek = currentTimelineWeeks[minW - 1];
  const endWeek = currentTimelineWeeks[maxW - 1];
  if (!startWeek || !endWeek) return;

  pendingWeekPick = null;
  twoClickAnchor = null;
  updateTaskOnActiveProduct(
    taskId,
    (t) => {
      t.start = startWeek.startDate;
      t.end = endWeek.endDate;
    },
    minW === maxW ? `Đã gán tuần W${minW}` : `Đã gán lịch W${minW}–W${maxW}`
  );
}

/* ---------- Main Delegation Handlers ---------- */
const mainEl = $('main');

mainEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  // Report cycle/action toggles
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

  // Quick done from Report view
  const quickDoneBtn = target.closest<HTMLElement>('[data-quick-done]');
  if (quickDoneBtn) {
    const [prodId, taskId] = (quickDoneBtn.dataset.quickDone || '').split(':');
    const prod = products.find((p) => p.id === prodId);
    const task = prod?.tasks.find((t) => t.id === taskId);
    if (task) {
      task.status = 'done';
      persistAndRender(true);
      showToast(`Đã đánh dấu hoàn thành: ${task.name}`);
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
      pendingWeekPick = null;
      twoClickAnchor = null;
      render();
    }
    return;
  }

  // Back to product list
  if (target.closest('[data-nav-back="products"]')) {
    activeProductId = null;
    pendingWeekPick = null;
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
      products = createDemoProducts();
      currentCycle = 2026;
      persistAndRender();
      showToast('Đã tải dữ liệu mẫu chu kỳ 03/2026 – 03/2027');
    }
    return;
  }

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
    updateTaskOnActiveProduct(
      tid,
      (t) => {
        t.start = '';
        t.end = '';
      },
      'Đã xóa lịch tuần'
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
          updateTaskOnActiveProduct(tid, (t) => {
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
        updateTaskOnActiveProduct(tid, (t) => {
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
    commitQuickAddTask(sIdx);
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
      persistAndRender(true);
      showToast(next ? `Đã chốt mẫu ${samp.rdCode} cho sản phẩm` : `Đã bỏ chốt mẫu ${samp.rdCode}`);
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

// Inline selects (Task status & Sample testResult)
mainEl.addEventListener('change', (e) => {
  const target = e.target as HTMLElement;

  if (target instanceof HTMLSelectElement && target.dataset.inlineStatus) {
    const tid = target.dataset.inlineStatus;
    const val = target.value as TaskStatus;
    updateTaskOnActiveProduct(tid, (t) => {
      t.status = val;
    });
    return;
  }

  if (target instanceof HTMLSelectElement && target.dataset.sampleResult) {
    const [prodId, sampleId] = target.dataset.sampleResult.split(':');
    const prod = products.find((p) => p.id === prodId);
    const samp = prod?.samples.find((s) => s.id === sampleId);
    if (samp) {
      samp.testResult = target.value as SampleTestResult;
      if (!samp.testDate) samp.testDate = getTodayStr();
      persistAndRender(true);
      showToast(`Đã cập nhật kết quả test ${samp.rdCode}`);
    }
  }
});

// Quick-add Enter key support
mainEl.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (
    target instanceof HTMLInputElement &&
    (target.dataset.quickInput !== undefined || target.dataset.quickPic !== undefined)
  ) {
    const sIdx = Number(target.dataset.quickInput ?? target.dataset.quickPic);
    if (e.key === 'Enter') {
      e.preventDefault();
      commitQuickAddTask(sIdx);
    } else if (e.key === 'Escape') {
      const row = document.querySelector<HTMLTableRowElement>(`tr[data-quick-row="${sIdx}"]`);
      if (row) row.hidden = true;
    }
  }
});

function commitQuickAddTask(stageIdx: number): void {
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
  prod.tasks.push({
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
  });
  persistAndRender(true);
  showToast(`Đã thêm "${name}"`);
}

/* ---------- Week Cell Drag + Two-Click Selection ---------- */
mainEl.addEventListener('pointerdown', (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>('.wk-cell[data-wk-task]');
  if (!cell || e.button !== 0) return;

  const taskId = cell.dataset.wkTask || '';
  const wkIdx = Number(cell.dataset.wkIdx);

  // If 2-click mode is already active on this same task, second click commits immediately
  if (twoClickAnchor && twoClickAnchor.taskId === taskId) {
    commitWeekSpan(taskId, twoClickAnchor.anchorWeek, wkIdx);
    return;
  }

  twoClickAnchor = null;
  pendingWeekPick = {
    taskId,
    anchorWeek: wkIdx,
    hoverWeek: wkIdx,
    isDragging: true,
  };
  updateWeekPreviewDom();
});

mainEl.addEventListener('pointerover', (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>('.wk-cell[data-wk-task]');
  if (!cell) return;
  const taskId = cell.dataset.wkTask || '';
  const wkIdx = Number(cell.dataset.wkIdx);

  if (pendingWeekPick && pendingWeekPick.taskId === taskId) {
    if (pendingWeekPick.hoverWeek !== wkIdx) {
      pendingWeekPick.hoverWeek = wkIdx;
      updateWeekPreviewDom();
    }
  } else if (twoClickAnchor && twoClickAnchor.taskId === taskId) {
    pendingWeekPick = {
      taskId,
      anchorWeek: twoClickAnchor.anchorWeek,
      hoverWeek: wkIdx,
      isDragging: false,
    };
    updateWeekPreviewDom();
  }
});

window.addEventListener('pointerup', () => {
  if (!pendingWeekPick || !pendingWeekPick.isDragging) return;
  const { taskId, anchorWeek, hoverWeek } = pendingWeekPick;
  if (hoverWeek !== anchorWeek) {
    commitWeekSpan(taskId, anchorWeek, hoverWeek);
  } else {
    // Released on same week: switch into 2-click pick mode
    twoClickAnchor = { taskId, anchorWeek };
    pendingWeekPick = { taskId, anchorWeek, hoverWeek: anchorWeek, isDragging: false };
    render(true);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (pendingWeekPick || twoClickAnchor)) {
    pendingWeekPick = null;
    twoClickAnchor = null;
    render(true);
  }
});

/* ---------- Top Bar & Workspace Bar Handlers ---------- */
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
  btn.onclick = () => {
    const tab = btn.dataset.tab as ViewTab;
    activeTab = tab;
    if (tab !== 'products') activeProductId = null;
    pendingWeekPick = null;
    twoClickAnchor = null;
    render();
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
  pendingWeekPick = null;
  twoClickAnchor = null;
  render();
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
      'Nhập dữ liệu JSON',
      `Nhập ${parsed.length} sản phẩm từ file? Các sản phẩm trùng ID sẽ được cập nhật theo file mới.`,
      'Nhập dữ liệu'
    );
    if (!ok) return;
    for (const raw of parsed) {
      const normalized = normalizeProduct(raw);
      const idx = products.findIndex((p) => p.id === normalized.id);
      if (idx < 0) products.push(normalized);
      else products[idx] = normalized;
    }
    persistAndRender();
    showToast(`Đã nhập ${parsed.length} sản phẩm`);
  } catch {
    await askConfirm('Lỗi nhập file', 'File JSON không đúng định dạng Product Timeline Tracker.', 'Đóng');
  }
};

/* ---------- Product Modal ---------- */
function openProductModal(prod: Product | null): void {
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

$('pSaveBtn').onclick = () => {
  const name = $<HTMLInputElement>('pName').value.trim();
  if (!name) {
    $<HTMLInputElement>('pName').focus();
    return;
  }
  const category = $<HTMLInputElement>('pCategory').value.trim();
  const launch = $<HTMLInputElement>('pLaunch').value;
  const cycleStartYear = Number($<HTMLSelectElement>('pCycle').value) || currentCycle;
  const withTpl = $<HTMLInputElement>('pTemplate').checked;

  if (editingProductId) {
    const prod = products.find((p) => p.id === editingProductId);
    if (prod) {
      prod.name = name;
      prod.category = category;
      prod.launch = launch;
      prod.cycleStartYear = cycleStartYear;
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
    products.push(newProd);
    activeTab = 'products';
    activeProductId = newProd.id;
  }

  currentCycle = cycleStartYear;
  $<HTMLDialogElement>('productDialog').close();
  persistAndRender();
  showToast(editingProductId ? 'Đã cập nhật sản phẩm' : `Đã tạo sản phẩm "${name}"`);
};

$('pDeleteBtn').onclick = async () => {
  if (!editingProductId) return;
  const prod = products.find((p) => p.id === editingProductId);
  const ok = await askConfirm(
    'Xóa sản phẩm',
    `Xóa "${prod?.name || ''}" cùng toàn bộ công việc và mẫu R&D liên quan?`,
    'Xóa vĩnh viễn',
    true
  );
  if (!ok) return;
  products = products.filter((p) => p.id !== editingProductId);
  if (activeProductId === editingProductId) activeProductId = null;
  $<HTMLDialogElement>('productDialog').close();
  persistAndRender();
  showToast('Đã xóa sản phẩm');
};

/* ---------- Task Detail Modal ---------- */
function openTaskModal(task: Task | null): void {
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

$('tSaveBtn').onclick = () => {
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

  const idx = prod.tasks.findIndex((t) => t.id === payload.id);
  if (idx < 0) prod.tasks.push(payload);
  else prod.tasks[idx] = payload;

  $<HTMLDialogElement>('taskDialog').close();
  persistAndRender(true);
  showToast('Đã lưu công việc');
};

$('tDeleteBtn').onclick = () => {
  const prod = products.find((p) => p.id === activeProductId);
  if (!prod || !editingTaskId) return;
  prod.tasks = prod.tasks.filter((t) => t.id !== editingTaskId);
  $<HTMLDialogElement>('taskDialog').close();
  persistAndRender(true);
  showToast('Đã xóa công việc');
};

/* ---------- R&D Sample Modal ---------- */
function openSampleModal(ref: { productId: string; sampleId: string } | null): void {
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
  $<HTMLInputElement>('sApproved').checked = Boolean(samp?.isApproved);
  $<HTMLTextAreaElement>('sNote').value = samp?.note || '';

  // When editing existing sample, hide initial price block (use "Cập nhật giá" to preserve price history!)
  $('sInitialPriceBlock').style.display = samp ? 'none' : 'grid';
  $('sDeleteBtn').style.display = samp ? '' : 'none';
  dlg.showModal();
}

$('sCancelBtn').onclick = () => $<HTMLDialogElement>('sampleDialog').close();

$('sSaveBtn').onclick = () => {
  const rdCode = $<HTMLInputElement>('sCode').value.trim();
  if (!rdCode) {
    $<HTMLInputElement>('sCode').focus();
    return;
  }
  const prodId = $<HTMLSelectElement>('sProduct').value;
  const prod = products.find((p) => p.id === prodId);
  if (!prod) return;

  const isApproved = $<HTMLInputElement>('sApproved').checked;
  if (isApproved) {
    prod.samples.forEach((s) => {
      s.isApproved = false;
    });
  }

  const today = getTodayStr();
  if (editingSampleRef) {
    const samp = prod.samples.find((s) => s.id === editingSampleRef?.sampleId);
    if (samp) {
      samp.rdCode = rdCode;
      samp.version = $<HTMLInputElement>('sVersion').value.trim();
      samp.pic = $<HTMLInputElement>('sPic').value.trim();
      samp.testDate = $<HTMLInputElement>('sTestDate').value;
      samp.testResult = $<HTMLSelectElement>('sResult').value as SampleTestResult;
      samp.isApproved = isApproved;
      samp.note = $<HTMLTextAreaElement>('sNote').value.trim();
    }
  } else {
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
            },
          ]
        : [],
    };
    prod.samples.push(newSample);
  }

  $<HTMLDialogElement>('sampleDialog').close();
  persistAndRender(true);
  showToast(editingSampleRef ? `Đã cập nhật mẫu ${rdCode}` : `Đã thêm mẫu ${rdCode}`);
};

$('sDeleteBtn').onclick = async () => {
  if (!editingSampleRef) return;
  const prod = products.find((p) => p.id === editingSampleRef?.productId);
  const samp = prod?.samples.find((s) => s.id === editingSampleRef?.sampleId);
  if (!prod || !samp) return;
  const ok = await askConfirm(
    'Xóa mã mẫu R&D',
    `Xóa mã mẫu "${samp.rdCode}" và toàn bộ lịch sử giá của mẫu này?`,
    'Xóa mẫu',
    true
  );
  if (!ok) return;
  prod.samples = prod.samples.filter((s) => s.id !== samp.id);
  $<HTMLDialogElement>('sampleDialog').close();
  persistAndRender(true);
  showToast(`Đã xóa mẫu ${samp.rdCode}`);
};

/* ---------- Price Update Modal (Appends to History) ---------- */
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

$('prSaveBtn').onclick = () => {
  if (!pricingSampleRef) return;
  const prod = products.find((p) => p.id === pricingSampleRef?.productId);
  const samp = prod?.samples.find((s) => s.id === pricingSampleRef?.sampleId);
  if (!samp) return;

  const cvsPrice = Number($<HTMLInputElement>('prCvs').value) || 0;
  const packagingCost = Number($<HTMLInputElement>('prPack').value) || 0;
  const sellPrice = Number($<HTMLInputElement>('prSell').value) || 0;
  const date = $<HTMLInputElement>('prDate').value || getTodayStr();
  const reason = $<HTMLInputElement>('prReason').value.trim() || 'Cập nhật giá định kỳ';

  samp.cvsPrice = cvsPrice;
  samp.packagingCost = packagingCost;
  samp.sellPrice = sellPrice;
  samp.updatedAt = date;
  samp.priceHistory.push({
    id: uid(),
    date,
    cvsPrice,
    packagingCost,
    sellPrice,
    reason,
  });

  $<HTMLDialogElement>('priceDialog').close();
  persistAndRender(true);
  showToast(`Đã cập nhật giá mới cho ${samp.rdCode}`);
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
    // Show chronological order oldest->newest to calculate delta, then reverse for display newest first
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

/* ---------- Boot ---------- */
applyTheme();
render();
