import { STAGES, STAGE_SHORT } from '../data/template';
import type { Product, Task } from '../types';
import {
  daysDiff,
  effectiveStatus,
  esc,
  fmtDate,
  fmtMoney,
  formatCycleLabel,
  getPrimarySample,
  getProductStats,
  getTodayStr,
} from '../utils';

export interface ReportFilterState {
  cycleMode: 'current' | 'all';
  category: string;
  actionFilter: 'all_risk' | 'late' | 'milestone';
  pic: string;
}

export function renderReportView(
  allProducts: Product[],
  currentCycle: number,
  filter: ReportFilterState,
  editMode: boolean,
  legacyLocalCount: number
): string {
  const today = getTodayStr();
  const cycleProducts =
    filter.cycleMode === 'all'
      ? allProducts
      : allProducts.filter((p) => p.cycleStartYear === currentCycle);

  const categories = Array.from(
    new Set(cycleProducts.map((p) => p.category.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'en'));

  const products = (
    filter.category
      ? cycleProducts.filter((p) => p.category.trim() === filter.category)
      : cycleProducts
  )
    .slice()
    .sort((a, b) => (a.launch || '9999').localeCompare(b.launch || '9999'));

  let totalDone = 0;
  let totalProg = 0;
  let totalNot = 0;
  let totalLate = 0;
  let totalTasks = 0;
  let dueSoonCount = 0;
  let totalSamples = 0;
  let goSamples = 0;
  let approvedProducts = 0;

  interface ActionItem {
    productId: string;
    productName: string;
    cycleStartYear: number;
    task: Task;
    stageName: string;
    diffDays: number;
    isLate: boolean;
  }

  const actionItems: ActionItem[] = [];
  const picSet = new Set<string>();

  for (const p of products) {
    const st = getProductStats(p, today);
    totalDone += st.counts.done;
    totalProg += st.counts.prog;
    totalNot += st.counts.not;
    totalLate += st.counts.late;
    totalTasks += st.total;

    const samples = p.samples || [];
    totalSamples += samples.length;
    goSamples += samples.filter((s) => s.testResult === 'go').length;
    if (samples.some((s) => s.isApproved)) approvedProducts += 1;

    for (const t of p.tasks || []) {
      if (t.pic.trim()) picSet.add(t.pic.trim());
      if (t.status === 'done') continue;
      const eff = effectiveStatus(t, today);
      const diff = t.end ? daysDiff(today, t.end) : 999;
      if (eff === 'late') {
        actionItems.push({
          productId: p.id,
          productName: p.name,
          cycleStartYear: p.cycleStartYear,
          task: t,
          stageName: STAGES[t.stage] || '',
          diffDays: diff,
          isLate: true,
        });
      } else if (t.end && diff >= 0 && diff <= 14) {
        dueSoonCount += 1;
        actionItems.push({
          productId: p.id,
          productName: p.name,
          cycleStartYear: p.cycleStartYear,
          task: t,
          stageName: STAGES[t.stage] || '',
          diffDays: diff,
          isLate: false,
        });
      } else if (t.isMilestone) {
        actionItems.push({
          productId: p.id,
          productName: p.name,
          cycleStartYear: p.cycleStartYear,
          task: t,
          stageName: STAGES[t.stage] || '',
          diffDays: diff,
          isLate: false,
        });
      }
    }
  }

  const overallPct = totalTasks ? Math.round((totalDone / totalTasks) * 100) : 0;
  const pics = Array.from(picSet).sort((a, b) => a.localeCompare(b, 'en'));

  const filteredActions = actionItems
    .filter((item) => {
      if (filter.actionFilter === 'late') return item.isLate;
      if (filter.actionFilter === 'milestone') return Boolean(item.task.isMilestone);
      return item.isLate || (item.diffDays >= 0 && item.diffDays <= 14);
    })
    .filter((item) => !filter.pic || item.task.pic.trim() === filter.pic)
    .sort((a, b) => {
      if (a.isLate !== b.isLate) return a.isLate ? -1 : 1;
      return (a.task.end || '9999').localeCompare(b.task.end || '9999');
    });

  const cycleLabel =
    filter.cycleMode === 'all' ? 'All Cycles' : `Cycle ${formatCycleLabel(currentCycle)}`;

  const matrixRows = products
    .map((p) => {
      const stats = getProductStats(p, today);
      const primarySample = getPrimarySample(p);
      const stageCells = STAGES.map((_, si) => {
        const ts = (p.tasks || []).filter((t) => t.stage === si);
        if (!ts.length) return `<td class="num mut">—</td>`;

        let done = 0;
        let late = 0;
        let prog = 0;
        for (const t of ts) {
          const e = effectiveStatus(t, today);
          if (e === 'done') done += 1;
          else if (e === 'late') late += 1;
          else if (e === 'prog') prog += 1;
        }
        const pct = Math.round((done / ts.length) * 100);
        const cls =
          late > 0
            ? 'stage-late'
            : done === ts.length
            ? 'stage-done'
            : prog > 0 || done > 0
            ? 'stage-prog'
            : 'stage-not';
        return `<td class="num stage-cell ${cls}" title="${esc(STAGES[si])}: ${done}/${ts.length}${late ? `, ${late} overdue` : ''}">
          <div class="stage-ratio">${done}/${ts.length}${late ? `<span class="stage-late-mark"> !${late}</span>` : ''}</div>
          <div class="mini-bar"><i style="width:${pct}%"></i></div>
        </td>`;
      }).join('');

      const rdSummary = primarySample
        ? `<div class="mono-sm"><strong>${esc(primarySample.rdCode)}</strong>${
            primarySample.isApproved ? ' · Approved' : ''
          }</div>
           <div class="mut mono-sm">${fmtMoney(primarySample.cvsPrice)} / ${fmtMoney(primarySample.sellPrice)}</div>`
        : `<span class="mut">No samples</span>`;

      const rowStatus =
        stats.counts.late > 0
          ? `<span class="status-txt status-late">${stats.counts.late} overdue</span>`
          : stats.pct === 100 && stats.total > 0
          ? `<span class="status-txt status-done">Completed</span>`
          : `<span class="status-txt status-prog">On Track</span>`;

      return `<tr class="clickable-row" data-open-product="${esc(p.id)}">
        <td class="col-prod">
          <div class="prod-name">${esc(p.name)}</div>
          <div class="mut">${esc(p.category || 'Uncategorized')} · ${formatCycleLabel(p.cycleStartYear)}</div>
        </td>
        <td class="num">${fmtDate(p.launch, true)}</td>
        <td>${rdSummary}</td>
        <td class="num">
          <div class="mono-sm"><strong>${stats.pct}%</strong> (${stats.counts.done}/${stats.total})</div>
          <div style="margin-top:2px">${rowStatus}</div>
        </td>
        ${stageCells}
      </tr>`;
    })
    .join('');

  const actionRows = filteredActions
    .map((item) => {
      const dueText = item.isLate
        ? `<span class="status-txt status-late">${Math.abs(item.diffDays)}d overdue</span>`
        : item.task.end
        ? item.diffDays === 0
          ? `<span class="status-txt status-prog">Due today</span>`
          : `<span class="status-txt status-prog">In ${item.diffDays}d</span>`
        : `<span class="mut">No due date</span>`;

      return `<tr>
        <td>
          <button type="button" class="link-btn" data-open-product="${esc(item.productId)}">${esc(
        item.productName
      )}</button>
          <div class="mut">${formatCycleLabel(item.cycleStartYear)}</div>
        </td>
        <td class="mut">${esc(item.stageName)}</td>
        <td>
          <div>${item.task.isMilestone ? '<span class="milestone-mark" title="Key Milestone">◆</span> ' : ''}${esc(
        item.task.name
      )}</div>
          ${item.task.note ? `<div class="mut">${esc(item.task.note)}</div>` : ''}
        </td>
        <td>${esc(item.task.pic || '—')}</td>
        <td class="num">${fmtDate(item.task.end, true)}</td>
        <td>${dueText}</td>
        ${
          editMode
            ? `<td class="no-print">
                <button type="button" class="btn-sm" data-quick-done="${esc(item.productId)}:${esc(
                item.task.id
              )}">Mark Done</button>
              </td>`
            : ''
        }
      </tr>`;
    })
    .join('');

  const legacyBanner =
    editMode && legacyLocalCount > 0 && allProducts.length === 0
      ? `<div class="pick-banner no-print" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <span>Detected <strong>${legacyLocalCount}</strong> locally saved products in this browser. Sync them to Cloud SQL so leadership and R&amp;D can view shared data.</span>
          <button type="button" class="btn-sm btn-pri" data-action="sync-legacy">Sync to Cloud SQL</button>
        </div>`
      : '';

  return `
  <section class="print-header">
    <div>
      <h1>PRODUCT PROGRESS OVERVIEW REPORT</h1>
      <div class="mut">${esc(cycleLabel)}${filter.category ? ` · Category: ${esc(filter.category)}` : ''} · Generated: ${fmtDate(today, true)}</div>
    </div>
  </section>

  ${legacyBanner}

  <div class="section-head no-print">
    <div>
      <h2>Progress Overview</h2>
      <p class="mut">Shared executive report for Leadership, R&amp;D, and cross-functional teams.</p>
    </div>
    <div class="toolbar-group">
      <div class="segmented" role="group" aria-label="Cycle Scope">
        <button type="button" class="${filter.cycleMode === 'current' ? 'active' : ''}" data-rep-cycle="current">Cycle ${formatCycleLabel(currentCycle)}</button>
        <button type="button" class="${filter.cycleMode === 'all' ? 'active' : ''}" data-rep-cycle="all">All Cycles</button>
      </div>
      <select id="repCatFilter" class="select-auto" aria-label="Filter by product category">
        <option value="">All Categories</option>
        ${categories
          .map((c) => `<option value="${esc(c)}" ${filter.category === c ? 'selected' : ''}>${esc(c)}</option>`)
          .join('')}
      </select>
      <button type="button" id="repPrintBtn" class="btn">Print / Export PDF</button>
    </div>
  </div>

  <div class="kpi-strip">
    <div class="kpi-cell">
      <div class="kpi-label">Active Products</div>
      <div class="kpi-val">${products.length}</div>
      <div class="mut">${approvedProducts} with approved RD sample</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Overall Progress</div>
      <div class="kpi-val">${overallPct}%</div>
      <div class="mut tabular">${totalDone}/${totalTasks} tasks done</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">In Progress</div>
      <div class="kpi-val" style="color:var(--st-prog)">${totalProg}</div>
      <div class="mut tabular">${totalNot} not started</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Overdue Tasks</div>
      <div class="kpi-val" style="color:${totalLate > 0 ? 'var(--st-late)' : 'inherit'}">${totalLate}</div>
      <div class="mut tabular">${dueSoonCount} due within 14 days</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">R&amp;D Passed (Go)</div>
      <div class="kpi-val" style="color:var(--st-done)">${goSamples}<span class="kpi-sub">/${totalSamples}</span></div>
      <div class="mut">Total tracked RD codes</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <div>
        <h3>Product Progress Matrix Across 7 Stages</h3>
        <span class="mut">Click any product row to open its 13-month timeline and R&amp;D sample details.</span>
      </div>
    </div>
    ${
      products.length
        ? `<div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Product / Category</th>
                  <th class="num">Launch</th>
                  <th>RD Code · CVS / Sell</th>
                  <th class="num">Overall</th>
                  ${STAGE_SHORT.map((s) => `<th class="num">${esc(s)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>${matrixRows}</tbody>
            </table>
          </div>`
        : `<div class="empty-box">
            <p>No products found in ${esc(cycleLabel)}.</p>
            ${
              editMode
                ? `<div class="toolbar-group" style="justify-content:center;margin-top:12px">
                    <button type="button" class="btn-pri" data-action="new-product">+ New Product</button>
                    ${
                      allProducts.length === 0
                        ? `<button type="button" class="btn" data-action="load-demo">Load Sample Data (2026–2027)</button>`
                        : ''
                    }
                  </div>`
                : `<p class="mut">Switch to "Edit Mode" (if you have editor access) to add your first product.</p>`
            }
          </div>`
    }
  </div>

  <div class="panel">
    <div class="panel-head">
      <div>
        <h3>Overdue &amp; Upcoming Action Items</h3>
        <span class="mut">Consolidated across all products for quick review in team standups.</span>
      </div>
      <div class="toolbar-group no-print">
        <div class="segmented" role="group" aria-label="Action item filter">
          <button type="button" class="${filter.actionFilter === 'all_risk' ? 'active' : ''}" data-rep-act="all_risk">Overdue &amp; Due Soon</button>
          <button type="button" class="${filter.actionFilter === 'late' ? 'active' : ''}" data-rep-act="late">Overdue Only</button>
          <button type="button" class="${filter.actionFilter === 'milestone' ? 'active' : ''}" data-rep-act="milestone">Milestones (◆)</button>
        </div>
        <select id="repPicFilter" class="select-auto" aria-label="Filter by PIC">
          <option value="">All PICs</option>
          ${pics.map((pic) => `<option value="${esc(pic)}" ${filter.pic === pic ? 'selected' : ''}>${esc(pic)}</option>`).join('')}
        </select>
      </div>
    </div>
    ${
      filteredActions.length
        ? `<div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Stage</th>
                  <th>Task</th>
                  <th>PIC</th>
                  <th class="num">Due Date</th>
                  <th>Status</th>
                  ${editMode ? '<th class="no-print">Action</th>' : ''}
                </tr>
              </thead>
              <tbody>${actionRows}</tbody>
            </table>
          </div>`
        : `<div class="empty-box"><p>No overdue or upcoming tasks match the current filter.</p></div>`
    }
  </div>
  `;
}
