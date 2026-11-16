import type { Product, RDSample, SampleTestResult } from '../types';
import {
  calcMarginPct,
  esc,
  fmtDate,
  fmtMoney,
  formatCycleLabel,
  SAMPLE_RESULT_META,
} from '../utils';

export interface SamplesFilterState {
  productId: string;
  cycleMode: 'current' | 'all';
  result: 'all' | SampleTestResult;
  search: string;
}

export function renderSamplesView(
  allProducts: Product[],
  currentCycle: number,
  filter: SamplesFilterState
): string {
  const scopedProducts =
    filter.cycleMode === 'all'
      ? allProducts
      : allProducts.filter((p) => p.cycleStartYear === currentCycle);

  interface FlatSample {
    product: Product;
    sample: RDSample;
  }

  const allSamples: FlatSample[] = [];
  for (const p of scopedProducts) {
    for (const s of p.samples || []) {
      allSamples.push({ product: p, sample: s });
    }
  }

  const q = filter.search.trim().toLowerCase();
  const filteredSamples = allSamples
    .filter((item) => !filter.productId || item.product.id === filter.productId)
    .filter((item) => filter.result === 'all' || item.sample.testResult === filter.result)
    .filter(
      (item) =>
        !q ||
        item.sample.rdCode.toLowerCase().includes(q) ||
        item.sample.version.toLowerCase().includes(q) ||
        item.sample.pic.toLowerCase().includes(q) ||
        item.product.name.toLowerCase().includes(q)
    )
    .sort((a, b) => {
      if (a.sample.isApproved !== b.sample.isApproved) return a.sample.isApproved ? -1 : 1;
      return (b.sample.updatedAt || b.sample.testDate || '').localeCompare(
        a.sample.updatedAt || a.sample.testDate || ''
      );
    });

  const goCount = allSamples.filter((x) => x.sample.testResult === 'go').length;
  const pendingCount = allSamples.filter(
    (x) => x.sample.testResult === 'pending' || x.sample.testResult === 'revise'
  ).length;
  const approvedCount = allSamples.filter((x) => x.sample.isApproved).length;

  const rowsHtml = filteredSamples
    .map(({ product, sample }) => {
      const margin = calcMarginPct(sample.cvsPrice, sample.sellPrice);
      const historyCount = (sample.priceHistory || []).length;

      return `<tr class="${sample.isApproved ? 'row-approved' : ''}">
        <td>
          <div class="mono-code">${esc(sample.rdCode)}</div>
          <div class="mut">${sample.isApproved ? '<span class="status-txt status-done">Đã chốt SX</span>' : 'Mẫu thử'}</div>
        </td>
        <td>
          <button type="button" class="link-btn" data-open-product="${esc(product.id)}">${esc(
        product.name
      )}</button>
          <div class="mut">${esc(product.category || '—')} · ${formatCycleLabel(product.cycleStartYear)}</div>
        </td>
        <td>
          <div>${esc(sample.version || '—')}</div>
          ${sample.note ? `<div class="mut">${esc(sample.note)}</div>` : ''}
        </td>
        <td>
          <div>${esc(sample.pic || '—')}</div>
          <div class="mut num">${sample.testDate ? `Test: ${fmtDate(sample.testDate, true)}` : 'Chưa test'}</div>
        </td>
        <td>
          <select class="inline-status samp-${sample.testResult}" data-sample-result="${esc(
        product.id
      )}:${esc(sample.id)}" aria-label="Kết quả test mẫu">
            <option value="pending" ${sample.testResult === 'pending' ? 'selected' : ''}>Chờ test</option>
            <option value="go" ${sample.testResult === 'go' ? 'selected' : ''}>Đạt (Go)</option>
            <option value="revise" ${sample.testResult === 'revise' ? 'selected' : ''}>Chỉnh sửa</option>
            <option value="nogo" ${sample.testResult === 'nogo' ? 'selected' : ''}>Không đạt</option>
          </select>
        </td>
        <td class="num">
          <div class="mono-sm"><strong>${fmtMoney(sample.cvsPrice)}</strong></div>
          ${sample.updatedAt ? `<div class="mut mono-sm">${fmtDate(sample.updatedAt, true)}</div>` : ''}
        </td>
        <td class="num mono-sm">${fmtMoney(sample.packagingCost)}</td>
        <td class="num mono-sm"><strong>${fmtMoney(sample.sellPrice)}</strong></td>
        <td class="num mono-sm">${margin !== null ? `${margin}%` : '—'}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-sm ${sample.isApproved ? 'btn-active' : ''}" data-sample-approve="${esc(
        product.id
      )}:${esc(sample.id)}" title="Đánh dấu mẫu chốt sản xuất">${
        sample.isApproved ? 'Đã chốt' : 'Chốt mẫu'
      }</button>
            <button type="button" class="btn-sm" data-sample-price="${esc(product.id)}:${esc(
        sample.id
      )}">Cập nhật giá</button>
            <button type="button" class="btn-sm" data-sample-history="${esc(product.id)}:${esc(
        sample.id
      )}">Lịch sử (${historyCount})</button>
            <button type="button" class="btn-sm" data-sample-edit="${esc(product.id)}:${esc(
        sample.id
      )}">Sửa</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  const selectedProductObj = filter.productId
    ? allProducts.find((p) => p.id === filter.productId)
    : null;

  return `
  <div class="section-head">
    <div>
      <h2>Dashboard Mẫu R&amp;D &amp; Lịch sử Giá${
        selectedProductObj ? ` — ${esc(selectedProductObj.name)}` : ''
      }</h2>
      <p class="mut">Theo dõi các mã RD theo từng phiên bản công thức, kết quả test cảm quan và lịch sử điều chỉnh giá CVS / giá bán.</p>
    </div>
    <div class="toolbar-group">
      ${
        selectedProductObj
          ? `<button type="button" class="btn" data-clear-sample-prod>Xem tất cả SP</button>`
          : ''
      }
      <button type="button" class="btn-pri" data-action="new-sample">+ Thêm mã RD</button>
    </div>
  </div>

  <div class="kpi-strip">
    <div class="kpi-cell"><div class="kpi-label">Tổng số mã RD</div><div class="kpi-val">${allSamples.length}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Mẫu Đạt (Go)</div><div class="kpi-val" style="color:var(--st-done)">${goCount}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Chờ test / Chỉnh sửa</div><div class="kpi-val" style="color:var(--st-prog)">${pendingCount}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Mẫu đã chốt SX</div><div class="kpi-val">${approvedCount}</div></div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <div class="toolbar-group">
        <div class="segmented" role="group" aria-label="Chu kỳ mẫu">
          <button type="button" class="${filter.cycleMode === 'current' ? 'active' : ''}" data-samp-cycle="current">Chu kỳ ${formatCycleLabel(
    currentCycle
  )}</button>
          <button type="button" class="${filter.cycleMode === 'all' ? 'active' : ''}" data-samp-cycle="all">Tất cả chu kỳ</button>
        </div>
        <select id="sampProdFilter" class="select-auto" aria-label="Lọc theo sản phẩm">
          <option value="">Tất cả sản phẩm</option>
          ${scopedProducts
            .map(
              (p) =>
                `<option value="${esc(p.id)}" ${filter.productId === p.id ? 'selected' : ''}>${esc(
                  p.name
                )}</option>`
            )
            .join('')}
        </select>
        <select id="sampResultFilter" class="select-auto" aria-label="Lọc kết quả test">
          <option value="all" ${filter.result === 'all' ? 'selected' : ''}>Mọi kết quả</option>
          ${(['go', 'pending', 'revise', 'nogo'] as const)
            .map(
              (k) =>
                `<option value="${k}" ${filter.result === k ? 'selected' : ''}>${
                  SAMPLE_RESULT_META[k].label
                }</option>`
            )
            .join('')}
        </select>
      </div>
      <input type="search" id="sampSearchInput" class="input-search" value="${esc(
        filter.search
      )}" placeholder="Tìm mã RD, công thức, PIC...">
    </div>

    ${
      filteredSamples.length
        ? `<div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Mã RD</th>
                  <th>Sản phẩm</th>
                  <th>Phiên bản / Công thức</th>
                  <th>PIC · Ngày test</th>
                  <th>Kết quả test</th>
                  <th class="num">Giá CVS</th>
                  <th class="num">Bao bì / NL</th>
                  <th class="num">Giá bán DK</th>
                  <th class="num">Biên LN</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>`
        : `<div class="empty-box">
            <p>${
              allProducts.length === 0
                ? 'Chưa có sản phẩm nào. Hãy tạo sản phẩm trước hoặc tải dữ liệu mẫu để quản lý mã RD.'
                : 'Chưa có mã mẫu R&D nào khớp bộ lọc hiện tại.'
            }</p>
            <div class="toolbar-group" style="justify-content:center;margin-top:12px">
              ${
                allProducts.length > 0
                  ? `<button type="button" class="btn-pri" data-action="new-sample">+ Thêm mã RD đầu tiên</button>`
                  : `<button type="button" class="btn-pri" data-action="new-product">+ Sản phẩm mới</button>
                     <button type="button" class="btn" data-action="load-demo">Tải dữ liệu mẫu (2026–2027)</button>`
              }
            </div>
          </div>`
    }
  </div>
  `;
}
