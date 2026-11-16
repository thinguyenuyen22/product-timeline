import { STAGES } from '../data/template';
import type { CycleWeek, Product, Task } from '../types';
import {
  buildCycleCalendar,
  effectiveStatus,
  esc,
  fmtDate,
  fmtMoney,
  formatCycleLabel,
  getPrimarySample,
  getProductStats,
  getTaskWeekSpan,
  getTodayStr,
  STATUS_META,
} from '../utils';

export interface TimelineFilterState {
  stage: number | 'all';
  status: 'all' | 'late' | 'prog' | 'not' | 'done';
  milestoneOnly: boolean;
  search: string;
}

export interface WeekPickState {
  taskId: string;
  anchorWeek: number;
  hoverWeek: number;
  isDragging: boolean;
}

export function renderTimelineView(
  product: Product,
  displayCycleYear: number,
  filter: TimelineFilterState,
  pendingWeekPick: WeekPickState | null
): { html: string; weeks: CycleWeek[] } {
  const today = getTodayStr();
  const stats = getProductStats(product, today);
  const { weeks, months } = buildCycleCalendar(displayCycleYear);
  const primarySample = getPrimarySample(product);

  // Locate current week & launch week
  let nowWeekIdx = -1;
  let launchWeekIdx = -1;
  for (const w of weeks) {
    if (today >= w.startDate && today <= w.endDate) nowWeekIdx = w.index;
    if (product.launch && product.launch >= w.startDate && product.launch <= w.endDate) {
      launchWeekIdx = w.index;
    }
  }

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
      filter.status !== 'all' || filter.milestoneOnly || Boolean(q) || filter.stage !== 'all';
    if (!visibleTasks.length && hasActiveFilter && filter.stage !== stageIdx) return;

    rowsHtml += `<tr class="stage-row">
      <td class="col-task sticky-1">
        <div class="stage-head-cell">
          <span>${esc(stageName)}</span>
          <span class="mut mono-sm">${stageDone}/${stageTasksAll.length}${
      stageLate ? ` · <span class="status-txt status-late">${stageLate} trễ</span>` : ''
    }</span>
        </div>
      </td>
      <td class="sticky-2"></td>
      <td class="sticky-3"></td>
      <td class="sticky-4">
        <button type="button" class="btn-inline-add" data-quick-stage="${stageIdx}" title="Thêm nhanh công việc vào giai đoạn này">+ Thêm</button>
      </td>
      <td colspan="${weeks.length}"></td>
    </tr>`;

    for (const t of visibleTasks) {
      const eff = effectiveStatus(t, today);
      const span = getTaskWeekSpan(t, weeks);
      const isPickingThis = pendingWeekPick && pendingWeekPick.taskId === t.id;
      const pickMin = isPickingThis
        ? Math.min(pendingWeekPick.anchorWeek, pendingWeekPick.hoverWeek)
        : -1;
      const pickMax = isPickingThis
        ? Math.max(pendingWeekPick.anchorWeek, pendingWeekPick.hoverWeek)
        : -1;

      const weekCells = weeks
        .map((w) => {
          const inSpan = span ? w.index >= span.startIdx && w.index <= span.endIdx : false;
          const inPreview = isPickingThis && w.index >= pickMin && w.index <= pickMax;
          const classes = ['wk-cell'];
          if (inSpan) classes.push('on', `st-${eff}`);
          if (inPreview) classes.push('preview');
          if (w.index === nowWeekIdx) classes.push('now');
          if (w.index === launchWeekIdx) classes.push('launch-wk');

          let marker = '';
          if (span && w.index === span.startIdx && span.clipsBefore) marker = '‹';
          else if (span && w.index === span.endIdx && span.clipsAfter) marker = '›';
          else if (inSpan && t.isMilestone && w.index === span.endIdx) marker = '◆';

          return `<td class="${classes.join(' ')}" data-wk-task="${esc(t.id)}" data-wk-idx="${
            w.index
          }" title="W${w.index} (${fmtDate(w.startDate)} – ${fmtDate(w.endDate, true)})${
            t.start || t.end ? ` · Việc: ${fmtDate(t.start)} → ${fmtDate(t.end)}` : ''
          }">${marker}</td>`;
        })
        .join('');

      const statusSelectClass = `inline-status st-${eff}`;

      rowsHtml += `<tr class="task-row" data-task-row="${esc(t.id)}">
        <td class="col-task sticky-1">
          <div class="task-cell-wrap">
            ${
              t.isMilestone
                ? '<span class="milestone-mark" title="Mốc chốt quan trọng">◆</span>'
                : ''
            }
            ${t.priority === 'high' ? '<span class="prio-mark" title="Ưu tiên cao">!</span>' : ''}
            <span class="inline-text" contenteditable="false" data-inline-field="name" data-task-id="${esc(
              t.id
            )}" title="Bấm để sửa tên công việc${t.note ? ` · Ghi chú: ${esc(t.note)}` : ''}">${esc(
        t.name
      )}</span>
            <button type="button" class="row-detail-btn" data-open-task="${esc(
              t.id
            )}" title="Mở chi tiết, ghi chú & xóa">⋯</button>
          </div>
        </td>
        <td class="col-pic sticky-2">
          <span class="inline-text mut-if-empty" data-inline-field="pic" data-task-id="${esc(
            t.id
          )}" title="Bấm để sửa PIC">${esc(t.pic) || '—'}</span>
        </td>
        <td class="col-status sticky-3">
          <div class="status-cell-wrap">
            <select class="${statusSelectClass}" data-inline-status="${esc(
        t.id
      )}" aria-label="Trạng thái công việc">
              <option value="not" ${t.status === 'not' ? 'selected' : ''}>Chưa làm</option>
              <option value="prog" ${t.status === 'prog' ? 'selected' : ''}>Đang làm</option>
              <option value="done" ${t.status === 'done' ? 'selected' : ''}>Hoàn thành</option>
            </select>
            ${eff === 'late' ? '<span class="late-tag" title="Quá hạn chưa hoàn thành">Trễ</span>' : ''}
          </div>
        </td>
        <td class="col-due sticky-4">
          <div class="due-cell-wrap">
            <button type="button" class="inline-date-btn ${
              eff === 'late' ? 'status-late' : ''
            }" data-inline-due="${esc(t.id)}" title="Bấm để đổi ngày hạn">${
        t.end ? fmtDate(t.end) : '+ Hạn'
      }</button>
            ${
              t.start || t.end
                ? `<button type="button" class="clear-dates-btn" data-clear-dates="${esc(
                    t.id
                  )}" title="Xóa lịch tuần">×</button>`
                : ''
            }
          </div>
        </td>
        ${weekCells}
      </tr>`;
    }

    // Inline quick-add placeholder row (hidden unless activated or shown via button)
    rowsHtml += `<tr class="quick-add-row" data-quick-row="${stageIdx}" hidden>
      <td class="col-task sticky-1">
        <input type="text" class="quick-add-input" data-quick-input="${stageIdx}" placeholder="Nhập tên công việc mới rồi nhấn Enter...">
      </td>
      <td class="col-pic sticky-2">
        <input type="text" class="quick-add-input" data-quick-pic="${stageIdx}" placeholder="PIC...">
      </td>
      <td class="sticky-3" colspan="2">
        <div class="toolbar-group">
          <button type="button" class="btn-sm btn-pri" data-quick-save="${stageIdx}">Thêm</button>
          <button type="button" class="btn-sm" data-quick-cancel="${stageIdx}">Hủy</button>
        </div>
      </td>
      <td colspan="${weeks.length}"></td>
    </tr>`;
  });

  const legendItems = (['done', 'prog', 'not', 'late'] as const)
    .map(
      (k) =>
        `<span class="legend-item"><i style="background:${STATUS_META[k].color}"></i>${STATUS_META[k].label} (${stats.counts[k]})</span>`
    )
    .join('');

  const pickHint = pendingWeekPick
    ? `<div class="pick-banner">Đang chọn tuần bắt đầu <strong>W${pendingWeekPick.anchorWeek}</strong> — bấm hoặc kéo tới tuần kết thúc (bấm lại W${pendingWeekPick.anchorWeek} để chọn 1 tuần, nhấn Esc để hủy).</div>`
    : '';

  const html = `
  <div class="section-head">
    <div class="breadcrumb-block">
      <div class="breadcrumb">
        <button type="button" class="link-btn" data-nav-back="products">← Danh sách sản phẩm</button>
        <span aria-hidden="true">/</span>
        <span>Chu kỳ ${formatCycleLabel(displayCycleYear)}</span>
      </div>
      <h2 style="margin-top:4px">${esc(product.name)}</h2>
      <div class="mut">
        ${esc(product.category || 'Chưa phân nhóm')}
        ${product.launch ? ` · Ra mắt dự kiến ${fmtDate(product.launch, true)}` : ''}
        · ${stats.pct}% hoàn thành (${stats.counts.done}/${stats.total} việc)
        ${
          primarySample
            ? ` · Mẫu: <strong>${esc(primarySample.rdCode)}</strong> (CVS ${fmtMoney(
                primarySample.cvsPrice
              )} / Bán ${fmtMoney(primarySample.sellPrice)})`
            : ''
        }
      </div>
    </div>
    <div class="toolbar-group">
      <button type="button" class="btn" data-open-samples="${esc(product.id)}">Mẫu R&amp;D &amp; Giá (${
    (product.samples || []).length
  })</button>
      <button type="button" class="btn" data-action="edit-product">Sửa sản phẩm</button>
      <button type="button" class="btn-pri" data-action="add-task">+ Thêm công việc</button>
    </div>
  </div>

  <div class="timeline-controls">
    <div class="legend-row">${legendItems}</div>
    <div class="toolbar-group">
      <select id="tlStageFilter" class="select-auto" aria-label="Lọc theo giai đoạn">
        <option value="all">Tất cả giai đoạn</option>
        ${STAGES.map(
          (s, i) => `<option value="${i}" ${filter.stage === i ? 'selected' : ''}>${esc(s)}</option>`
        ).join('')}
      </select>
      <select id="tlStatusFilter" class="select-auto" aria-label="Lọc theo trạng thái">
        <option value="all" ${filter.status === 'all' ? 'selected' : ''}>Mọi trạng thái</option>
        <option value="late" ${filter.status === 'late' ? 'selected' : ''}>Trễ hạn</option>
        <option value="prog" ${filter.status === 'prog' ? 'selected' : ''}>Đang làm</option>
        <option value="not" ${filter.status === 'not' ? 'selected' : ''}>Chưa làm</option>
        <option value="done" ${filter.status === 'done' ? 'selected' : ''}>Hoàn thành</option>
      </select>
      <label class="check-inline">
        <input type="checkbox" id="tlMilestoneFilter" ${filter.milestoneOnly ? 'checked' : ''}>
        Chỉ mốc chốt (◆)
      </label>
      <input type="search" id="tlSearchInput" class="input-search" value="${esc(
        filter.search
      )}" placeholder="Lọc công việc, PIC...">
    </div>
  </div>

  ${pickHint}

  ${
    rowsHtml
      ? `<div class="gantt-wrap" id="ganttScrollWrap">
          <table class="gantt-table">
            <thead>
              <tr>
                <th class="col-task sticky-1">Công việc (bấm để sửa)</th>
                <th class="col-pic sticky-2">PIC</th>
                <th class="col-status sticky-3">Trạng thái</th>
                <th class="col-due sticky-4">Hạn</th>
                ${months
                  .map((m) => `<th class="wk-month" colspan="${m.span}">${esc(m.label)}</th>`)
                  .join('')}
              </tr>
              <tr>
                <th class="col-task sticky-1"></th>
                <th class="col-pic sticky-2"></th>
                <th class="col-status sticky-3"></th>
                <th class="col-due sticky-4"></th>
                ${weeks
                  .map((w) => {
                    const cls = ['wk-hdr'];
                    if (w.index === nowWeekIdx) cls.push('now');
                    if (w.index === launchWeekIdx) cls.push('launch-wk');
                    return `<th class="${cls.join(' ')}" title="W${w.index}: ${fmtDate(
                      w.startDate
                    )} – ${fmtDate(w.endDate, true)}${
                      w.index === nowWeekIdx ? ' (Tuần hiện tại)' : ''
                    }${w.index === launchWeekIdx ? ' (Tuần ra mắt dự kiến)' : ''}">${w.index}</th>`;
                  })
                  .join('')}
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`
      : `<div class="empty-box"><p>Chưa có công việc nào khớp bộ lọc. Hãy bấm "+ Thêm công việc" hoặc "+ Thêm" tại từng giai đoạn.</p></div>`
  }

  <p class="mut" style="margin-top:10px">
    Mẹo thao tác nhanh: Bấm vào tên công việc, PIC, trạng thái hoặc hạn để sửa trực tiếp. Trên lưới tuần (W1–W${weeks.length}), bấm 2 điểm hoặc kéo chuột ngang để gán tuần bắt đầu–kết thúc; bấm ⋯ ở cuối tên việc để mở ghi chú dài và đánh dấu mốc chốt (◆).
  </p>
  `;

  return { html, weeks };
}
