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
  filter: SamplesFilterState,
  editMode: boolean
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
      const imgs = sample.images || [];
      const resMeta = SAMPLE_RESULT_META[sample.testResult];

      const thumbsHtml = imgs
        .slice(0, 4)
        .map(
          (img) =>
            `<button type="button" class="thumb-btn" data-open-lightbox="${esc(product.id)}:${esc(
              sample.id
            )}:${esc(img.id)}" title="${esc(img.caption || sample.rdCode)}"><img src="${esc(
              img.dataUrl
            )}" alt="${esc(img.caption || sample.rdCode)}" referrerpolicy="no-referrer"></button>`
        )
        .join('');
      const moreImgs = imgs.length > 4 ? `<span class="mut mono-sm">+${imgs.length - 4}</span>` : '';

      const resultCell = editMode
        ? `<select class="inline-status samp-${sample.testResult}" data-sample-result="${esc(
            product.id
          )}:${esc(sample.id)}" aria-label="Kết quả test mẫu">
            <option value="pending" ${sample.testResult === 'pending' ? 'selected' : ''}>Chờ test</option>
            <option value="go" ${sample.testResult === 'go' ? 'selected' : ''}>Đạt (Go)</option>
            <option value="revise" ${sample.testResult === 'revise' ? 'selected' : ''}>Chỉnh sửa</option>
            <option value="nogo" ${sample.testResult === 'nogo' ? 'selected' : ''}>Không đạt</option>
          </select>`
        : `<span class="status-txt" style="color:${resMeta.color}">${resMeta.label}</span>`;

      const actionsCell = editMode
        ? `<div class="row-actions">
            <button type="button" class="btn-sm ${sample.isApproved ? 'btn-active' : ''}" data-sample-approve="${esc(
            product.id
          )}:${esc(sample.id)}" title="Đánh dấu mẫu chốt sản xuất">${
            sample.isApproved ? 'Đã chốt' : 'Chốt'
          }</button>
            <button type="button" class="btn-sm" data-sample-price="${esc(product.id)}:${esc(
            sample.id
          )}">Giá</button>
            <button type="button" class="btn-sm" data-sample-history="${esc(product.id)}:${esc(
            sample.id
          )}">Lịch sử (${historyCount})</button>
            <button type="button" class="btn-sm" data-sample-edit="${esc(product.id)}:${esc(
            sample.id
          )}">Sửa</button>
          </div>`
        : `<div class="row-actions">
            <button type="button" class="btn-sm" data-sample-history="${esc(product.id)}:${esc(
            sample.id
          )}">Lịch sử giá (${historyCount})</button>
          </div>`;

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
          <div class="mut">${esc(sample.pic || '—')}${sample.testDate ? ` · Test ${fmtDate(sample.testDate, true)}` : ''}</div>
        </td>
        <td>
          <div class="thumb-strip">
            ${thumbsHtml || (!editMode ? '<span class="mut">Chưa có ảnh</span>' : '')}
            ${moreImgs}
            ${
              editMode
                ? `<button type="button" class="btn-sm" data-trigger-upload="${esc(
                    product.id
                  )}:${esc(sample.id)}" title="Tải nhiều ảnh đánh giá mẫu">+ Ảnh</button>`
                : ''
            }
          </div>
        </td>
        <td>${resultCell}</td>
        <td class="num">
          <div class="mono-sm"><strong>${fmtMoney(sample.cvsPrice)}</strong></div>
          ${sample.updatedAt ? `<div class="mut mono-sm">${fmtDate(sample.updatedAt, true)}</div>` : ''}
        </td>
        <td class="num mono-sm">${fmtMoney(sample.packagingCost)}</td>
        <td class="num mono-sm"><strong>${fmtMoney(sample.sellPrice)}</strong></td>
        <td class="num mono-sm">${margin !== null ? `${margin}%` : '—'}</td>
        <td>${actionsCell}</td>
      </tr>`;
    })
    .join('');

  const selectedProductObj = filter.productId
    ? allProducts.find((p) => p.id === filter.productId)
    : null;

  return `
  <div class="section-head">
    <div>
      <h2>Đánh giá Mẫu R&amp;D &amp; Giá${
        selectedProductObj ? ` — ${esc(selectedProductObj.name)}` : ''
      }</h2>
      <p class="mut">Theo dõi các mã RD, hình ảnh đánh giá mẫu thực tế (bấm ảnh để phóng to), kết quả test và lịch sử cập nhật giá.</p>
    </div>
    <div class="toolbar-group">
      ${
        selectedProductObj
          ? `<button type="button" class="btn" data-clear-sample-prod>Xem tất cả SP</button>`
          : ''
      }
      ${
        editMode
          ? `<button type="button" class="btn-pri" data-action="new-sample">+ Thêm mã RD</button>`
          : ''
      }
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
                  <th>Phiên bản / Đánh giá · PIC</th>
                  <th>Hình ảnh mẫu</th>
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
                ? 'Chưa có sản phẩm nào.'
                : 'Chưa có mã mẫu R&D nào khớp bộ lọc hiện tại.'
            }</p>
            ${
              editMode && allProducts.length > 0
                ? `<div class="toolbar-group" style="justify-content:center;margin-top:12px">
                    <button type="button" class="btn-pri" data-action="new-sample">+ Thêm mã RD đầu tiên</button>
                  </div>`
                : ''
            }
          </div>`
    }
  </div>
  `;
}
