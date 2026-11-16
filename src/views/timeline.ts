import { STAGES } from '../data/template';
import type { CycleMonth, Product } from '../types';
import {
  buildCycleMonths,
  effectiveStatus,
  esc,
  fmtDate,
  fmtMoney,
  formatCycleLabel,
  formatMonthCellText,
  getPrimarySample,
  getProductStats,
  getTaskMonthSpan,
  getTodayStr,
  SAMPLE_RESULT_META,
  STATUS_META,
} from '../utils';

export interface TimelineFilterState {
  stage: number | 'all';
  status: 'all' | 'late' | 'prog' | 'not' | 'done';
  pic: string;
  milestoneOnly: boolean;
  search: string;
}

export interface MonthPickState {
  taskId: string;
  anchorMonth: number;
  hoverMonth: number;
  isDragging: boolean;
}

export function renderTimelineView(
  product: Product,
  displayCycleYear: number,
  filter: TimelineFilterState,
  collapsedStages: Set<number>,
  pendingMonthPick: MonthPickState | null,
  editMode: boolean
): { html: string; months: CycleMonth[] } {
  const today = getTodayStr();
  const stats = getProductStats(product, today);
  const months = buildCycleMonths(displayCycleYear);
  const primarySample = getPrimarySample(product);

  const nowMonthKey = today.slice(0, 7);
  const launchMonthKey = product.launch ? product.launch.slice(0, 7) : '';

  const picList = Array.from(
    new Set((product.tasks || []).map((t) => t.pic.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'en'));

  const q = filter.search.trim().toLowerCase();

  let rowsHtml = '';
  STAGES.forEach((stageName, stageIdx) => {
    if (filter.stage !== 'all' && filter.stage !== stageIdx) return;

    const stageTasksAll = (product.tasks || []).filter((t) => t.stage === stageIdx);
    const stageDone = stageTasksAll.filter((t) => t.status === 'done').length;
    const stageLate = stageTasksAll.filter((t) => effectiveStatus(t, today) === 'late').length;

    const visibleTasks = stageTasksAll
      .filter((t) => {
        if (filter.milestoneOnly && !t.isMilestone) return false;
        if (filter.pic && t.pic.trim() !== filter.pic) return false;
        const eff = effectiveStatus(t, today);
        if (filter.status !== 'all' && eff !== filter.status) return false;
        if (
          q &&
          !t.name.toLowerCase().includes(q) &&
          !t.pic.toLowerCase().includes(q) &&
          !t.note.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.start || a.end || '9999').localeCompare(b.start || b.end || '9999'));

    const hasActiveFilter =
      filter.status !== 'all' ||
      filter.milestoneOnly ||
      Boolean(filter.pic) ||
      Boolean(q) ||
      filter.stage !== 'all';
    if (!visibleTasks.length && hasActiveFilter && filter.stage !== stageIdx) return;

    const isCollapsed = collapsedStages.has(stageIdx);

    rowsHtml += `<tr class="stage-row">
      <td class="col-task-slim sticky-1" colspan="2">
        <div class="stage-head-cell">
          <button type="button" class="stage-toggle-btn" data-toggle-stage="${stageIdx}">
            <span class="chevron">${isCollapsed ? '▸' : '▾'}</span>
            <span>${esc(stageName)}</span>
          </button>
          <div class="toolbar-group">
            <span class="mut mono-sm">${stageDone}/${stageTasksAll.length}${
      stageLate ? ` · <span class="status-txt status-late">${stageLate} overdue</span>` : ''
    }</span>
            ${
              editMode
                ? `<button type="button" class="btn-inline-add" data-quick-stage="${stageIdx}" title="Quick-add task to this stage">+ Add</button>`
                : ''
            }
          </div>
        </div>
      </td>
      <td colspan="${months.length}"></td>
    </tr>`;

    if (!isCollapsed) {
      for (const t of visibleTasks) {
        const eff = effectiveStatus(t, today);
        const span = getTaskMonthSpan(t, months);
        const isPickingThis = pendingMonthPick && pendingMonthPick.taskId === t.id;
        const pickMin = isPickingThis
          ? Math.min(pendingMonthPick.anchorMonth, pendingMonthPick.hoverMonth)
          : -1;
        const pickMax = isPickingThis
          ? Math.max(pendingMonthPick.anchorMonth, pendingMonthPick.hoverMonth)
          : -1;

        const monthCells = months
          .map((m) => {
            const inSpan = span ? m.index >= span.startIdx && m.index <= span.endIdx : false;
            const inPreview = isPickingThis && m.index >= pickMin && m.index <= pickMax;
            const classes = ['mo-cell'];
            if (editMode) classes.push('editable-mo');
            if (inSpan) classes.push('on', `st-${eff}`);
            if (inPreview) classes.push('preview');
            if (m.key === nowMonthKey) classes.push('now');
            if (m.key === launchMonthKey) classes.push('launch-mo');

            const cellText = inSpan && span ? formatMonthCellText(m, span) : '';

            return `<td class="${classes.join(' ')}" ${
              editMode ? `data-mo-task="${esc(t.id)}" data-mo-idx="${m.index}"` : ''
            } title="${esc(m.label)}${
              t.start || t.end ? ` · ${fmtDate(t.start)} → ${fmtDate(t.end, true)}` : ''
            }">${cellText}</td>`;
          })
          .join('');

        const metaSubline = editMode
          ? `<div class="task-subline">
              <span class="inline-text-sm mut" data-inline-field="pic" data-task-id="${esc(
                t.id
              )}" title="Click to edit PIC">${esc(t.pic) || '+ PIC'}</span>
              <span>·</span>
              <button type="button" class="inline-date-btn ${
                eff === 'late' ? 'status-late' : ''
              }" data-inline-due="${esc(t.id)}" title="Click to change due date">${
              t.end ? `Due ${fmtDate(t.end)}` : '+ Due'
            }</button>
              ${
                t.start || t.end
                  ? `<button type="button" class="clear-dates-btn" data-clear-dates="${esc(
                      t.id
                    )}" title="Clear month schedule">×</button>`
                  : ''
              }
            </div>`
          : `<div class="task-subline mut">
              <span>${esc(t.pic || 'Unassigned PIC')}</span>
              ${t.end ? `<span>·</span><span class="num ${eff === 'late' ? 'status-late' : ''}">Due ${fmtDate(t.end, true)}</span>` : ''}
            </div>`;

        const statusControl = editMode
          ? `<div class="status-cell-wrap">
              <select class="inline-status st-${eff}" data-inline-status="${esc(
              t.id
            )}" aria-label="Task Status">
                <option value="not" ${t.status === 'not' ? 'selected' : ''}>Not Started</option>
                <option value="prog" ${t.status === 'prog' ? 'selected' : ''}>In Progress</option>
                <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
              </select>
              ${eff === 'late' ? '<span class="late-tag">Overdue</span>' : ''}
            </div>`
          : `<span class="status-txt ${
              eff === 'done'
                ? 'status-done'
                : eff === 'prog'
                ? 'status-prog'
                : eff === 'late'
                ? 'status-late'
                : 'mut'
            }">${STATUS_META[eff].label}</span>`;

        rowsHtml += `<tr class="task-row" data-task-row="${esc(t.id)}">
          <td class="col-task-slim sticky-1">
            <div class="task-cell-wrap">
              ${
                t.isMilestone
                  ? '<span class="milestone-mark" title="Key Milestone">◆</span>'
                  : ''
              }
              ${t.priority === 'high' ? '<span class="prio-mark" title="High Priority">!</span>' : ''}
              ${
                editMode
                  ? `<span class="inline-text" data-inline-field="name" data-task-id="${esc(
                      t.id
                    )}" title="Click to edit task name">${esc(t.name)}</span>
                     <button type="button" class="row-detail-btn" data-open-task="${esc(
                       t.id
                     )}" title="Edit details, notes & delete">⋯</button>`
                  : `<span class="task-title-readonly" title="${esc(t.note || t.name)}">${esc(
                      t.name
                    )}</span>`
              }
            </div>
            ${metaSubline}
          </td>
          <td class="col-status-slim sticky-2">${statusControl}</td>
          ${monthCells}
        </tr>`;
      }

      if (editMode) {
        rowsHtml += `<tr class="quick-add-row" data-quick-row="${stageIdx}" hidden>
          <td class="col-task-slim sticky-1">
            <div style="display:flex;gap:6px">
              <input type="text" class="quick-add-input" data-quick-input="${stageIdx}" placeholder="New task name (Enter)...">
              <input type="text" class="quick-add-input" style="width:110px" data-quick-pic="${stageIdx}" placeholder="PIC...">
            </div>
          </td>
          <td class="col-status-slim sticky-2">
            <div class="toolbar-group">
              <button type="button" class="btn-sm btn-pri" data-quick-save="${stageIdx}">Add</button>
              <button type="button" class="btn-sm" data-quick-cancel="${stageIdx}">Cancel</button>
            </div>
          </td>
          <td colspan="${months.length}"></td>
        </tr>`;
      }
    }
  });

  const legendItems = (['done', 'prog', 'not', 'late'] as const)
    .map(
      (k) =>
        `<span class="legend-item"><i style="background:${STATUS_META[k].color}"></i>${STATUS_META[k].label} (${stats.counts[k]})</span>`
    )
    .join('');

  const pickHint =
    editMode && pendingMonthPick
      ? `<div class="pick-banner">Start month selected — click or drag to the end month (click the same month again for a 1-month span, or press Esc to cancel).</div>`
      : '';

  // Compact R&D Sample & Photos strip right inside Product View so Boss/R&D sees samples immediately
  const samples = product.samples || [];
  const samplePreviewHtml = samples.length
    ? `<div class="panel" style="margin-top:18px">
        <div class="panel-head">
          <div>
            <h3>R&amp;D Samples &amp; Evaluation Photos (${samples.length})</h3>
            <span class="mut">Click any thumbnail to zoom, or open the R&amp;D Samples dashboard for full price history.</span>
          </div>
          <button type="button" class="btn-sm" data-open-samples="${esc(product.id)}">Open Samples Dashboard</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>RD Code</th>
                <th>Version / Notes</th>
                <th>Result</th>
                <th class="num">CVS / Sell Price</th>
                <th>Sample Photos</th>
              </tr>
            </thead>
            <tbody>
              ${samples
                .map((s) => {
                  const resMeta = SAMPLE_RESULT_META[s.testResult];
                  const imgs = s.images || [];
                  const thumbs = imgs
                    .slice(0, 4)
                    .map(
                      (img) =>
                        `<button type="button" class="thumb-btn" data-open-lightbox="${esc(
                          product.id
                        )}:${esc(s.id)}:${esc(img.id)}" title="${esc(
                          img.caption || s.rdCode
                        )}"><img src="${esc(img.dataUrl)}" alt="${esc(
                          img.caption || s.rdCode
                        )}" referrerpolicy="no-referrer"></button>`
                    )
                    .join('');
                  const moreCount = imgs.length > 4 ? `<span class="mut mono-sm">+${imgs.length - 4}</span>` : '';
                  return `<tr class="${s.isApproved ? 'row-approved' : ''}">
                    <td>
                      <div class="mono-code">${esc(s.rdCode)}</div>
                      ${s.isApproved ? '<div class="status-txt status-done">Approved for Prod</div>' : ''}
                    </td>
                    <td>
                      <div>${esc(s.version || '—')}</div>
                      ${s.note ? `<div class="mut">${esc(s.note)}</div>` : ''}
                    </td>
                    <td><span class="status-txt" style="color:${resMeta.color}">${resMeta.label}</span></td>
                    <td class="num mono-sm">${fmtMoney(s.cvsPrice)} / ${fmtMoney(s.sellPrice)}</td>
                    <td>
                      <div class="thumb-strip">
                        ${thumbs || '<span class="mut">No photos</span>'}
                        ${moreCount}
                        ${
                          editMode
                            ? `<button type="button" class="btn-sm" data-trigger-upload="${esc(
                                product.id
                              )}:${esc(s.id)}">+ Photos</button>`
                            : ''
                        }
                      </div>
                    </td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>`
    : '';

  const html = `
  <div class="section-head">
    <div class="breadcrumb-block">
      <div class="breadcrumb">
        <button type="button" class="link-btn" data-nav-back="products">← All Products</button>
        <span aria-hidden="true">/</span>
        <span>Cycle ${formatCycleLabel(displayCycleYear)}</span>
      </div>
      <h2 style="margin-top:4px">${esc(product.name)}</h2>
      <div class="mut">
        ${esc(product.category || 'Uncategorized')}
        ${product.launch ? ` · Target Launch ${fmtDate(product.launch, true)}` : ''}
        · ${stats.pct}% completed (${stats.counts.done}/${stats.total} tasks)
        ${
          primarySample
            ? ` · Primary Sample: <strong>${esc(primarySample.rdCode)}</strong> (CVS ${fmtMoney(
                primarySample.cvsPrice
              )} / Sell ${fmtMoney(primarySample.sellPrice)})`
            : ''
        }
      </div>
    </div>
    <div class="toolbar-group">
      <button type="button" class="btn" data-open-samples="${esc(product.id)}">R&amp;D Samples &amp; Pricing (${
    samples.length
  })</button>
      ${
        editMode
          ? `<button type="button" class="btn" data-action="edit-product">Edit Product</button>
             <button type="button" class="btn-pri" data-action="add-task">+ Add Task</button>`
          : ''
      }
    </div>
  </div>

  <div class="timeline-controls">
    <div class="legend-row">${legendItems}</div>
    <div class="toolbar-group">
      <button type="button" class="btn-sm" data-collapse-done>Collapse Done</button>
      <button type="button" class="btn-sm" data-expand-all>Expand All</button>
      <select id="tlStageFilter" class="select-auto" aria-label="Filter by stage">
        <option value="all">All Stages</option>
        ${STAGES.map(
          (s, i) => `<option value="${i}" ${filter.stage === i ? 'selected' : ''}>${esc(s)}</option>`
        ).join('')}
      </select>
      <select id="tlPicFilter" class="select-auto" aria-label="Filter by Team / PIC">
        <option value="">All Teams / PIC</option>
        ${picList
          .map((p) => `<option value="${esc(p)}" ${filter.pic === p ? 'selected' : ''}>${esc(p)}</option>`)
          .join('')}
      </select>
      <select id="tlStatusFilter" class="select-auto" aria-label="Filter by status">
        <option value="all" ${filter.status === 'all' ? 'selected' : ''}>All Statuses</option>
        <option value="late" ${filter.status === 'late' ? 'selected' : ''}>Overdue</option>
        <option value="prog" ${filter.status === 'prog' ? 'selected' : ''}>In Progress</option>
        <option value="not" ${filter.status === 'not' ? 'selected' : ''}>Not Started</option>
        <option value="done" ${filter.status === 'done' ? 'selected' : ''}>Done</option>
      </select>
      <label class="check-inline">
        <input type="checkbox" id="tlMilestoneFilter" ${filter.milestoneOnly ? 'checked' : ''}>
        Milestones (◆)
      </label>
      <input type="search" id="tlSearchInput" class="input-search" value="${esc(
        filter.search
      )}" placeholder="Search tasks...">
    </div>
  </div>

  ${pickHint}

  ${
    rowsHtml
      ? `<div class="gantt-wrap" id="ganttScrollWrap">
          <table class="gantt-table gantt-monthly">
            <thead>
              <tr>
                <th class="col-task-slim sticky-1">${
                  editMode ? 'Task · PIC · Due (click to edit)' : 'Task · PIC · Due'
                }</th>
                <th class="col-status-slim sticky-2">Status</th>
                ${months
                  .map((m) => {
                    const cls = ['mo-hdr'];
                    if (m.key === nowMonthKey) cls.push('now');
                    if (m.key === launchMonthKey) cls.push('launch-mo');
                    return `<th class="${cls.join(' ')}" title="${esc(m.label)}${
                      m.key === nowMonthKey ? ' (Current Month)' : ''
                    }${m.key === launchMonthKey ? ' (Target Launch Month)' : ''}">${esc(
                      m.label
                    )}</th>`;
                  })
                  .join('')}
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`
      : `<div class="empty-box"><p>No tasks match the current filter.</p></div>`
  }

  ${
    editMode
      ? `<p class="mut" style="margin-top:10px">Edit Mode: Click any task name, PIC, due date, or status to edit inline. On the 13-month grid, click two month cells (or drag horizontally) to set the task schedule.</p>`
      : ''
  }

  ${samplePreviewHtml}
  `;

  return { html, months };
}
