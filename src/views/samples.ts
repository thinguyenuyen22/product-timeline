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
          )}:${esc(sample.id)}" aria-label="Sample Test Result">
            <option value="pending" ${sample.testResult === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="go" ${sample.testResult === 'go' ? 'selected' : ''}>Pass (Go)</option>
            <option value="revise" ${sample.testResult === 'revise' ? 'selected' : ''}>Revise</option>
            <option value="nogo" ${sample.testResult === 'nogo' ? 'selected' : ''}>Fail (No-Go)</option>
          </select>`
        : `<span class="status-txt" style="color:${resMeta.color}">${resMeta.label}</span>`;

      const actionsCell = editMode
        ? `<div class="row-actions">
            <button type="button" class="btn-sm ${sample.isApproved ? 'btn-active' : ''}" data-sample-approve="${esc(
            product.id
          )}:${esc(sample.id)}" title="Mark as approved production formula">${
            sample.isApproved ? 'Approved' : 'Approve'
          }</button>
            <button type="button" class="btn-sm" data-sample-price="${esc(product.id)}:${esc(
            sample.id
          )}">Price</button>
            <button type="button" class="btn-sm" data-sample-history="${esc(product.id)}:${esc(
            sample.id
          )}">History (${historyCount})</button>
            <button type="button" class="btn-sm" data-sample-edit="${esc(product.id)}:${esc(
            sample.id
          )}">Edit</button>
          </div>`
        : `<div class="row-actions">
            <button type="button" class="btn-sm" data-sample-history="${esc(product.id)}:${esc(
            sample.id
          )}">Price History (${historyCount})</button>
          </div>`;

      return `<tr class="${sample.isApproved ? 'row-approved' : ''}">
        <td>
          <div class="mono-code">${esc(sample.rdCode)}</div>
          <div class="mut">${sample.isApproved ? '<span class="status-txt status-done">Approved for Prod</span>' : 'Trial Sample'}</div>
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
          <div class="mut">${esc(sample.pic || '—')}${sample.testDate ? ` · Tested ${fmtDate(sample.testDate, true)}` : ''}</div>
        </td>
        <td>
          <div class="thumb-strip">
            ${thumbsHtml || (!editMode ? '<span class="mut">No photos</span>' : '')}
            ${moreImgs}
            ${
              editMode
                ? `<button type="button" class="btn-sm" data-trigger-upload="${esc(
                    product.id
                  )}:${esc(sample.id)}" title="Upload multiple evaluation photos">+ Photos</button>`
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
      <h2>R&amp;D Sample Evaluation &amp; Pricing${
        selectedProductObj ? ` — ${esc(selectedProductObj.name)}` : ''
      }</h2>
      <p class="mut">Track RD sample codes, evaluation photos (click to zoom), test outcomes, and pricing update history.</p>
    </div>
    <div class="toolbar-group">
      ${
        selectedProductObj
          ? `<button type="button" class="btn" data-clear-sample-prod>View All Products</button>`
          : ''
      }
      ${
        editMode
          ? `<button type="button" class="btn-pri" data-action="new-sample">+ Add RD Sample</button>`
          : ''
      }
    </div>
  </div>

  <div class="kpi-strip">
    <div class="kpi-cell"><div class="kpi-label">Total RD Codes</div><div class="kpi-val">${allSamples.length}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Passed (Go)</div><div class="kpi-val" style="color:var(--st-done)">${goCount}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Pending / Revise</div><div class="kpi-val" style="color:var(--st-prog)">${pendingCount}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Approved for Prod</div><div class="kpi-val">${approvedCount}</div></div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <div class="toolbar-group">
        <div class="segmented" role="group" aria-label="Sample Cycle">
          <button type="button" class="${filter.cycleMode === 'current' ? 'active' : ''}" data-samp-cycle="current">Cycle ${formatCycleLabel(
    currentCycle
  )}</button>
          <button type="button" class="${filter.cycleMode === 'all' ? 'active' : ''}" data-samp-cycle="all">All Cycles</button>
        </div>
        <select id="sampProdFilter" class="select-auto" aria-label="Filter by product">
          <option value="">All Products</option>
          ${scopedProducts
            .map(
              (p) =>
                `<option value="${esc(p.id)}" ${filter.productId === p.id ? 'selected' : ''}>${esc(
                  p.name
                )}</option>`
            )
            .join('')}
        </select>
        <select id="sampResultFilter" class="select-auto" aria-label="Filter by test result">
          <option value="all" ${filter.result === 'all' ? 'selected' : ''}>All Results</option>
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
      )}" placeholder="Search RD code, formula, PIC...">
    </div>

    ${
      filteredSamples.length
        ? `<div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>RD Code</th>
                  <th>Product</th>
                  <th>Version / Evaluation · PIC</th>
                  <th>Sample Photos</th>
                  <th>Test Result</th>
                  <th class="num">CVS Cost</th>
                  <th class="num">Pack / Ingred.</th>
                  <th class="num">Est. Sell Price</th>
                  <th class="num">Margin</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>`
        : `<div class="empty-box">
            <p>${
              allProducts.length === 0
                ? 'No products found.'
                : 'No R&D samples match the current filter.'
            }</p>
            ${
              editMode && allProducts.length > 0
                ? `<div class="toolbar-group" style="justify-content:center;margin-top:12px">
                    <button type="button" class="btn-pri" data-action="new-sample">+ Add First RD Sample</button>
                  </div>`
                : ''
            }
          </div>`
    }
  </div>
  `;
}
