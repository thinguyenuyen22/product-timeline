import type { Product } from '../types';
import {
  esc,
  fmtDate,
  fmtMoney,
  formatCycleLabel,
  getPrimarySample,
  getProductStats,
  getTodayStr,
} from '../utils';

export function renderProductsView(
  allProducts: Product[],
  currentCycle: number,
  searchQuery: string,
  editMode: boolean
): string {
  const today = getTodayStr();
  const q = searchQuery.trim().toLowerCase();

  const cycleProducts = allProducts
    .filter((p) => p.cycleStartYear === currentCycle)
    .filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.samples || []).some((s) => s.rdCode.toLowerCase().includes(q))
    )
    .sort((a, b) => (a.launch || '9999').localeCompare(b.launch || '9999'));

  let totDone = 0;
  let totProg = 0;
  let totNot = 0;
  let totLate = 0;

  const cards = cycleProducts
    .map((p) => {
      const s = getProductStats(p, today);
      totDone += s.counts.done;
      totProg += s.counts.prog;
      totNot += s.counts.not;
      totLate += s.counts.late;

      const primarySample = getPrimarySample(p);
      const totalImgs = (p.samples || []).reduce((sum, samp) => sum + (samp.images || []).length, 0);
      const nextTask = (p.tasks || [])
        .filter((t) => t.status !== 'done' && t.end)
        .sort((a, b) => a.end.localeCompare(b.end))[0];

      const barSegments = (['done', 'prog', 'not', 'late'] as const)
        .map((k) => {
          const w = s.total ? (s.counts[k] / s.total) * 100 : 0;
          return `<i style="width:${w}%;background:var(--st-${k})"></i>`;
        })
        .join('');

      return `<article class="prod-card" data-open-product="${esc(p.id)}">
        <div class="prod-card-top">
          <div>
            <h3 class="prod-card-title">${esc(p.name)}</h3>
            <div class="mut">${esc(p.category || 'Chưa phân nhóm')}${
        p.launch ? ` · Ra mắt ${fmtDate(p.launch, true)}` : ''
      }</div>
          </div>
          <span class="mono-pct">${s.pct}%</span>
        </div>

        <div class="seg-bar" aria-label="Tiến độ ${s.pct}%">${barSegments}</div>

        <div class="mut tabular">
          ${s.counts.done}/${s.total} việc xong${
        s.counts.late ? ` · <span class="status-txt status-late">${s.counts.late} trễ</span>` : ''
      }
        </div>

        <div class="prod-card-meta">
          ${
            primarySample
              ? `<div class="mono-sm">Mẫu: <strong>${esc(primarySample.rdCode)}</strong> · CVS ${fmtMoney(
                  primarySample.cvsPrice
                )} · Bán ${fmtMoney(primarySample.sellPrice)}</div>`
              : `<div class="mut">Chưa có mã mẫu R&amp;D</div>`
          }
          ${
            nextTask
              ? `<div class="mut">Tiếp theo: ${esc(nextTask.name)} (${fmtDate(nextTask.end)})</div>`
              : ''
          }
        </div>

        <div class="prod-card-actions">
          <button type="button" class="btn-sm" data-open-product="${esc(p.id)}">Xem Timeline</button>
          <button type="button" class="btn-sm" data-open-samples="${esc(p.id)}">Mẫu R&amp;D (${
        (p.samples || []).length
      }${totalImgs ? ` · ${totalImgs} ảnh` : ''})</button>
        </div>
      </article>`;
    })
    .join('');

  return `
  <div class="section-head">
    <div>
      <h2>Sản phẩm chu kỳ ${formatCycleLabel(currentCycle)}</h2>
      <p class="mut">Theo dõi các sản phẩm triển khai từ tháng 03/${currentCycle} đến hết tháng 03/${currentCycle + 1}.</p>
    </div>
    <div class="toolbar-group">
      <input type="search" id="prodSearchInput" class="input-search" value="${esc(
        searchQuery
      )}" placeholder="Tìm tên SP, nhóm, mã RD..." aria-label="Tìm kiếm sản phẩm">
    </div>
  </div>

  <div class="kpi-strip">
    <div class="kpi-cell"><div class="kpi-label">Sản phẩm</div><div class="kpi-val">${cycleProducts.length}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Hoàn thành</div><div class="kpi-val" style="color:var(--st-done)">${totDone}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Đang làm</div><div class="kpi-val" style="color:var(--st-prog)">${totProg}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Chưa làm</div><div class="kpi-val">${totNot}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Trễ hạn</div><div class="kpi-val" style="color:${totLate ? 'var(--st-late)' : 'inherit'}">${totLate}</div></div>
  </div>

  ${
    cycleProducts.length
      ? `<div class="prod-grid">${cards}</div>`
      : `<div class="empty-box">
          <p>${
            q
              ? 'Không tìm thấy sản phẩm nào khớp từ khóa tìm kiếm.'
              : `Chưa có sản phẩm nào cho chu kỳ ${formatCycleLabel(currentCycle)}.`
          }</p>
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
              : ''
          }
        </div>`
  }
  `;
}
