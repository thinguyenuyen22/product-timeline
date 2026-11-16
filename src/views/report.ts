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
  ).sort((a, b) => a.localeCompare(b, 'vi'));

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
  const pics = Array.from(picSet).sort((a, b) => a.localeCompare(b, 'vi'));

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
    filter.cycleMode === 'all' ? 'Tất cả chu kỳ' : `Chu kỳ ${formatCycleLabel(currentCycle)}`;

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
        return `<td class="num stage-cell ${cls}" title="${esc(STAGES[si])}: ${done}/${ts.length}${late ? `, ${late} trễ` : ''}">
          <div class="stage-ratio">${done}/${ts.length}${late ? `<span class="stage-late-mark"> !${late}</span>` : ''}</div>
          <div class="mini-bar"><i style="width:${pct}%"></i></div>
        </td>`;
      }).join('');

      const rdSummary = primarySample
        ? `<div class="mono-sm"><strong>${esc(primarySample.rdCode)}</strong>${
            primarySample.isApproved ? ' · Chốt' : ''
          }</div>
           <div class="mut mono-sm">${fmtMoney(primarySample.cvsPrice)} / ${fmtMoney(primarySample.sellPrice)}</div>`
        : `<span class="mut">Chưa có mẫu</span>`;

      const rowStatus =
        stats.counts.late > 0
          ? `<span class="status-txt status-late">Trễ ${stats.counts.late} việc</span>`
          : stats.pct === 100 && stats.total > 0
          ? `<span class="status-txt status-done">Hoàn tất</span>`
          : `<span class="status-txt status-prog">Đúng tiến độ</span>`;

      return `<tr class="clickable-row" data-open-product="${esc(p.id)}">
        <td class="col-prod">
          <div class="prod-name">${esc(p.name)}</div>
          <div class="mut">${esc(p.category || 'Chưa phân nhóm')} · ${formatCycleLabel(p.cycleStartYear)}</div>
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
        ? `<span class="status-txt status-late">Trễ ${Math.abs(item.diffDays)} ngày</span>`
        : item.task.end
        ? item.diffDays === 0
          ? `<span class="status-txt status-prog">Hôm nay</span>`
          : `<span class="status-txt status-prog">Còn ${item.diffDays} ngày</span>`
        : `<span class="mut">Chưa gán hạn</span>`;

      return `<tr>
        <td>
          <button type="button" class="link-btn" data-open-product="${esc(item.productId)}">${esc(
        item.productName
      )}</button>
          <div class="mut">${formatCycleLabel(item.cycleStartYear)}</div>
        </td>
        <td class="mut">${esc(item.stageName)}</td>
        <td>
          <div>${item.task.isMilestone ? '<span class="milestone-mark" title="Mốc chốt">◆</span> ' : ''}${esc(
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
              )}">Hoàn thành</button>
              </td>`
            : ''
        }
      </tr>`;
    })
    .join('');

  const legacyBanner =
    editMode && legacyLocalCount > 0 && allProducts.length === 0
      ? `<div class="pick-banner no-print" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <span>Phát hiện <strong>${legacyLocalCount}</strong> sản phẩm đã lưu trước đây trên trình duyệt này. Đồng bộ lên Cloud SQL để Sếp và team R&amp;D cùng xem được.</span>
          <button type="button" class="btn-sm btn-pri" data-action="sync-legacy">Đồng bộ lên Cloud SQL</button>
        </div>`
      : '';

  return `
  <section class="print-header">
    <div>
      <h1>BÁO CÁO TỔNG QUAN TIẾN ĐỘ SẢN PHẨM</h1>
      <div class="mut">${esc(cycleLabel)}${filter.category ? ` · Nhóm: ${esc(filter.category)}` : ''} · Ngày lập: ${fmtDate(today, true)}</div>
    </div>
  </section>

  ${legacyBanner}

  <div class="section-head no-print">
    <div>
      <h2>Tổng quan tiến độ</h2>
      <p class="mut">Báo cáo dùng chung cho Ban Giám đốc, team R&amp;D và các phòng ban theo dõi.</p>
    </div>
    <div class="toolbar-group">
      <div class="segmented" role="group" aria-label="Phạm vi chu kỳ">
        <button type="button" class="${filter.cycleMode === 'current' ? 'active' : ''}" data-rep-cycle="current">Chu kỳ ${formatCycleLabel(currentCycle)}</button>
        <button type="button" class="${filter.cycleMode === 'all' ? 'active' : ''}" data-rep-cycle="all">Tất cả chu kỳ</button>
      </div>
      <select id="repCatFilter" class="select-auto" aria-label="Lọc nhóm sản phẩm">
        <option value="">Tất cả nhóm SP</option>
        ${categories
          .map((c) => `<option value="${esc(c)}" ${filter.category === c ? 'selected' : ''}>${esc(c)}</option>`)
          .join('')}
      </select>
      <button type="button" id="repPrintBtn" class="btn">In báo cáo / PDF</button>
    </div>
  </div>

  <div class="kpi-strip">
    <div class="kpi-cell">
      <div class="kpi-label">Sản phẩm theo dõi</div>
      <div class="kpi-val">${products.length}</div>
      <div class="mut">${approvedProducts} SP đã chốt mẫu RD</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Tiến độ hoàn thành</div>
      <div class="kpi-val">${overallPct}%</div>
      <div class="mut tabular">${totalDone}/${totalTasks} công việc xong</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Đang thực hiện</div>
      <div class="kpi-val" style="color:var(--st-prog)">${totalProg}</div>
      <div class="mut tabular">${totalNot} việc chưa bắt đầu</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Việc trễ hạn</div>
      <div class="kpi-val" style="color:${totalLate > 0 ? 'var(--st-late)' : 'inherit'}">${totalLate}</div>
      <div class="mut tabular">${dueSoonCount} việc đến hạn trong 14 ngày</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-label">Mẫu R&amp;D đạt (Go)</div>
      <div class="kpi-val" style="color:var(--st-done)">${goSamples}<span class="kpi-sub">/${totalSamples}</span></div>
      <div class="mut">Tổng số mã RD đang theo dõi</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <div>
        <h3>Ma trận tiến độ sản phẩm theo 7 giai đoạn</h3>
        <span class="mut">Bấm vào từng sản phẩm để xem timeline 13 tháng và mẫu R&amp;D chi tiết.</span>
      </div>
    </div>
    ${
      products.length
        ? `<div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Sản phẩm / Nhóm</th>
                  <th class="num">Ra mắt</th>
                  <th>Mã RD · Giá CVS / Bán</th>
                  <th class="num">Tổng thể</th>
                  ${STAGE_SHORT.map((s) => `<th class="num">${esc(s)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>${matrixRows}</tbody>
            </table>
          </div>`
        : `<div class="empty-box">
            <p>Chưa có sản phẩm nào trong ${esc(cycleLabel)}.</p>
            ${
              editMode
                ? `<div class="toolbar-group" style="justify-content:center;margin-top:12px">
                    <button type="button" class="btn-pri" data-action="new-product">+ Sản phẩm mới</button>
                    ${
                      allProducts.length === 0
                        ? `<button type="button" class="btn" data-action="load-demo">Tải dữ liệu mẫu (2026–2027)</button>`
                        : ''
                    }
                  </div>`
                : `<p class="mut">Chuyển sang "Chế độ Nhập liệu" (nếu bạn có quyền chỉnh sửa) để thêm sản phẩm đầu tiên.</p>`
            }
          </div>`
    }
  </div>

  <div class="panel">
    <div class="panel-head">
      <div>
        <h3>Việc trễ hạn &amp; sắp đến hạn</h3>
        <span class="mut">Tổng hợp từ tất cả sản phẩm để rà soát nhanh trong buổi họp.</span>
      </div>
      <div class="toolbar-group no-print">
        <div class="segmented" role="group" aria-label="Bộ lọc công việc cảnh báo">
          <button type="button" class="${filter.actionFilter === 'all_risk' ? 'active' : ''}" data-rep-act="all_risk">Trễ &amp; Sắp hạn</button>
          <button type="button" class="${filter.actionFilter === 'late' ? 'active' : ''}" data-rep-act="late">Chỉ việc trễ</button>
          <button type="button" class="${filter.actionFilter === 'milestone' ? 'active' : ''}" data-rep-act="milestone">Mốc chốt (◆)</button>
        </div>
        <select id="repPicFilter" class="select-auto" aria-label="Lọc theo PIC">
          <option value="">Tất cả PIC</option>
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
                  <th>Sản phẩm</th>
                  <th>Giai đoạn</th>
                  <th>Công việc</th>
                  <th>PIC</th>
                  <th class="num">Hạn</th>
                  <th>Tình trạng</th>
                  ${editMode ? '<th class="no-print">Thao tác</th>' : ''}
                </tr>
              </thead>
              <tbody>${actionRows}</tbody>
            </table>
          </div>`
        : `<div class="empty-box"><p>Không có công việc trễ hoặc sắp đến hạn theo bộ lọc hiện tại.</p></div>`
    }
  </div>
  `;
}
