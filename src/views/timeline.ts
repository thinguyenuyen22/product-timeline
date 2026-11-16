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
  ).sort((a, b) => a.localeCompare(b, 'vi'));

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
      stageLate ? ` · <span class="status-txt status-late">${stageLate} trễ</span>` : ''
    }</span>
            ${
              editMode
                ? `<button type="button" class="btn-inline-add" data-quick-stage="${stageIdx}" title="Thêm nhanh công việc vào giai đoạn này">+ Thêm</button>`
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
              )}" title="Bấm để sửa PIC">${esc(t.pic) || '+ PIC'}</span>
              <span>·</span>
              <button type="button" class="inline-date-btn ${
                eff === 'late' ? 'status-late' : ''
              }" data-inline-due="${esc(t.id)}" title="Bấm để đổi hạn">${
              t.end ? `Hạn ${fmtDate(t.end)}` : '+ Hạn'
            }</button>
              ${
                t.start || t.end
                  ? `<button type="button" class="clear-dates-btn" data-clear-dates="${esc(
                      t.id
                    )}" title="Xóa lịch tháng">×</button>`
                  : ''
              }
            </div>`
          : `<div class="task-subline mut">
              <span>${esc(t.pic || 'Chưa gán PIC')}</span>
              ${t.end ? `<span>·</span><span class="num ${eff === 'late' ? 'status-late' : ''}">Hạn ${fmtDate(t.end, true)}</span>` : ''}
            </div>`;

        const statusControl = editMode
          ? `<div class="status-cell-wrap">
              <select class="inline-status st-${eff}" data-inline-status="${esc(
              t.id
            )}" aria-label="Trạng thái công việc">
                <option value="not" ${t.status === 'not' ? 'selected' : ''}>Chưa làm</option>
                <option value="prog" ${t.status === 'prog' ? 'selected' : ''}>Đang làm</option>
                <option value="done" ${t.status === 'done' ? 'selected' : ''}>Hoàn thành</option>
              </select>
              ${eff === 'late' ? '<span class="late-tag">Trễ</span>' : ''}
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
                  ? '<span class="milestone-mark" title="Mốc chốt quan trọng">◆</span>'
                  : ''
              }
              ${t.priority === 'high' ? '<span class="prio-mark" title="Ưu tiên cao">!</span>' : ''}
              ${
                editMode
                  ? `<span class="inline-text" data-inline-field="name" data-task-id="${esc(
                      t.id
                    )}" title="Bấm để sửa tên công việc">${esc(t.name)}</span>
                     <button type="button" class="row-detail-btn" data-open-task="${esc(
                       t.id
                     )}" title="Sửa chi tiết, ghi chú & xóa">⋯</button>`
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
              <input type="text" class="quick-add-input" data-quick-input="${stageIdx}" placeholder="Tên công việc mới (Enter)...">
              <input type="text" class="quick-add-input" style="width:110px" data-quick-pic="${stageIdx}" placeholder="PIC...">
            </div>
          </td>
          <td class="col-status-slim sticky-2">
            <div class="toolbar-group">
              <button type="button" class="btn-sm btn-pri" data-quick-save="${stageIdx}">Thêm</button>
              <button type="button" class="btn-sm" data-quick-cancel="${stageIdx}">Hủy</button>
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
      ? `<div class="pick-banner">Đang chọn tháng bắt đầu — bấm hoặc kéo tới tháng kết thúc (bấm lại cùng tháng để chọn 1 tháng, nhấn Esc để hủy).</div>`
      : '';

  // Compact R&D Sample & Photos strip right inside Product View so Boss/R&D sees samples immediately
  const samples = product.samples || [];
  const samplePreviewHtml = samples.length
    ? `<div class="panel" style="margin-top:18px">
        <div class="panel-head">
          <div>
            <h3>Mẫu R&amp;D &amp; Hình ảnh đánh giá (${samples.length})</h3>
            <span class="mut">Bấm vào ảnh thu nhỏ để phóng to, hoặc chuyển sang tab Mẫu R&amp;D để xem chi tiết lịch sử giá.</span>
          </div>
          <button type="button" class="btn-sm" data-open-samples="${esc(product.id)}">Mở Dashboard Mẫu R&amp;D</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Mã RD</th>
                <th>Phiên bản / Đánh giá</th>
                <th>Kết quả</th>
                <th class="num">Giá CVS / Bán</th>
                <th>Hình ảnh mẫu</th>
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
                      ${s.isApproved ? '<div class="status-txt status-done">Đã chốt SX</div>' : ''}
                    </td>
                    <td>
                      <div>${esc(s.version || '—')}</div>
                      ${s.note ? `<div class="mut">${esc(s.note)}</div>` : ''}
                    </td>
                    <td><span class="status-txt" style="color:${resMeta.color}">${resMeta.label}</span></td>
                    <td class="num mono-sm">${fmtMoney(s.cvsPrice)} / ${fmtMoney(s.sellPrice)}</td>
                    <td>
                      <div class="thumb-strip">
                        ${thumbs || '<span class="mut">Chưa có ảnh</span>'}
                        ${moreCount}
                        ${
                          editMode
                            ? `<button type="button" class="btn-sm" data-trigger-upload="${esc(
                                product.id
                              )}:${esc(s.id)}">+ Ảnh</button>`
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
            ? ` · Mẫu chốt: <strong>${esc(primarySample.rdCode)}</strong> (CVS ${fmtMoney(
                primarySample.cvsPrice
              )} / Bán ${fmtMoney(primarySample.sellPrice)})`
            : ''
        }
      </div>
    </div>
    <div class="toolbar-group">
      <button type="button" class="btn" data-open-samples="${esc(product.id)}">Mẫu R&amp;D &amp; Giá (${
    samples.length
  })</button>
      ${
        editMode
          ? `<button type="button" class="btn" data-action="edit-product">Sửa SP</button>
             <button type="button" class="btn-pri" data-action="add-task">+ Thêm công việc</button>`
          : ''
      }
    </div>
  </div>

  <div class="timeline-controls">
    <div class="legend-row">${legendItems}</div>
    <div class="toolbar-group">
      <button type="button" class="btn-sm" data-collapse-done>Thu gọn GĐ xong</button>
      <button type="button" class="btn-sm" data-expand-all>Mở tất cả</button>
      <select id="tlStageFilter" class="select-auto" aria-label="Lọc theo giai đoạn">
        <option value="all">Tất cả giai đoạn</option>
        ${STAGES.map(
          (s, i) => `<option value="${i}" ${filter.stage === i ? 'selected' : ''}>${esc(s)}</option>`
        ).join('')}
      </select>
      <select id="tlPicFilter" class="select-auto" aria-label="Lọc theo Team / PIC">
        <option value="">Tất cả Team / PIC</option>
        ${picList
          .map((p) => `<option value="${esc(p)}" ${filter.pic === p ? 'selected' : ''}>${esc(p)}</option>`)
          .join('')}
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
        Mốc chốt (◆)
      </label>
      <input type="search" id="tlSearchInput" class="input-search" value="${esc(
        filter.search
      )}" placeholder="Tìm công việc...">
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
                  editMode ? 'Công việc · PIC · Hạn (bấm để sửa)' : 'Công việc · PIC · Hạn'
                }</th>
                <th class="col-status-slim sticky-2">Trạng thái</th>
                ${months
                  .map((m) => {
                    const cls = ['mo-hdr'];
                    if (m.key === nowMonthKey) cls.push('now');
                    if (m.key === launchMonthKey) cls.push('launch-mo');
                    return `<th class="${cls.join(' ')}" title="${esc(m.label)}${
                      m.key === nowMonthKey ? ' (Tháng hiện tại)' : ''
                    }${m.key === launchMonthKey ? ' (Tháng ra mắt dự kiến)' : ''}">${esc(
                      m.label
                    )}</th>`;
                  })
                  .join('')}
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`
      : `<div class="empty-box"><p>Không có công việc nào khớp bộ lọc.</p></div>`
  }

  ${
    editMode
      ? `<p class="mut" style="margin-top:10px">Chế độ Nhập liệu: Bấm vào tên việc, PIC, hạn hoặc trạng thái để sửa trực tiếp. Trên lưới 13 tháng, bấm 2 ô tháng (hoặc kéo ngang) để gán khoảng thời gian.</p>`
      : ''
  }

  ${samplePreviewHtml}
  `;

  return { html, months };
}
