// lib/export-pdf.ts
import { isPricingAnalysisEmpty } from "./pricing-analysis";

export async function downloadReportPDF(report: any) {
  // Create a print-ready HTML document
  const html = generatePrintHTML(report);

  // Blob's own type must declare a charset — without it, the print window
  // has no encoding signal at all and the browser falls back to a legacy
  // 8-bit codepage (commonly windows-1252) to decode this UTF-8 string,
  // turning e.g. "★" into "â˜…" and "—" into "â€”". This, plus the
  // <meta charset="utf-8"> in generatePrintHTML's own <head>, is the whole
  // fix — nothing in the underlying data was ever actually corrupted.
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const printWindow = window.open(url, "_blank");
  if (printWindow) {
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
        URL.revokeObjectURL(url);
      }, 500);
    };
  }
}

export async function downloadTabPDF(report: any, activeTab: string) {
  const tabTitles: Record<string, string> = {
    "competitive-analysis": "Competitive Analysis",
    "pricing": "Pricing Analysis",
    "go-to-market": "Go-To-Market Strategy",
    "content-form": "Content Form & Key Messaging"
  };
  
  const title = `${report.title} — ${tabTitles[activeTab] || activeTab}`;
  const html = generatePrintHTML(report, activeTab);

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const printWindow = window.open(url, "_blank");
  if (printWindow) {
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
        URL.revokeObjectURL(url);
      }, 500);
    };
  }
}

function parseTipTapNode(node: any): string {
  if (!node) return "";
  if (node.type === "text") {
    let text = node.text || "";
    if (node.marks) {
      node.marks.forEach((mark: any) => {
        if (mark.type === "bold") text = `<strong>${text}</strong>`;
        if (mark.type === "italic") text = `<em>${text}</em>`;
      });
    }
    return text;
  }

  const childrenHtml = (node.content || []).map(parseTipTapNode).join("");

  switch (node.type) {
    case "paragraph":
      return `<p>${childrenHtml}</p>`;
    case "heading":
      const level = node.attrs?.level || 1;
      return `<h${level}>${childrenHtml}</h${level}>`;
    case "bulletList":
      return `<ul>${childrenHtml}</ul>`;
    case "orderedList":
      return `<ol>${childrenHtml}</ol>`;
    case "listItem":
      return `<li>${childrenHtml}</li>`;
    case "blockquote":
      return `<blockquote>${childrenHtml}</blockquote>`;
    case "horizontalRule":
      return `<hr />`;
    default:
      return childrenHtml;
  }
}

// Renders a real gold/gray SVG star rating instead of the "★" glyph — immune
// to any print-engine font/encoding quirks, since it's drawn as vector shapes
// rather than relying on a Unicode glyph being decoded/rendered correctly.
function renderStarRating(rating: string | number | null | undefined, reviewCount?: string | number | null): string {
  const numRating = typeof rating === "number" ? rating : parseFloat(String(rating ?? ""));
  if (rating == null || rating === "" || isNaN(numRating)) return "";
  const clamped = Math.max(0, Math.min(5, numRating));
  const starPath = "M12 2l2.9 6.9 7.1.6-5.4 4.7 1.6 7-6.2-3.9-6.2 3.9 1.6-7L1.9 9.5l7.1-.6z";
  const stars = Array.from({ length: 5 }, (_, i) => {
    const fillPct = Math.round(Math.max(0, Math.min(1, clamped - i)) * 100);
    return `<span style="position:relative;display:inline-block;width:10px;height:10px;">
      <svg viewBox="0 0 24 24" width="10" height="10" style="position:absolute;top:0;left:0;" fill="#D1D5DB"><path d="${starPath}"/></svg>
      <span style="position:absolute;top:0;left:0;width:${fillPct}%;height:100%;overflow:hidden;">
        <svg viewBox="0 0 24 24" width="10" height="10" fill="#F59E0B"><path d="${starPath}"/></svg>
      </span>
    </span>`;
  }).join("");
  return `<span style="display:inline-flex;align-items:center;gap:2px;vertical-align:middle;">${stars}<span style="margin-left:3px;">${clamped.toFixed(1)}${reviewCount ? ` (${reviewCount})` : ""}</span></span>`;
}

function generatePrintHTML(report: any, activeTab?: string): string {
  const ca = report.competitive_analysis || {};
  const pa = report.pricing_analysis || {};
  const gtm = report.go_to_market || {};
  const cf = report.content_form || {};

  const showAll = !activeTab;

  // Handle TipTap format if there is a content field and no structured tabs
  if (report.content && (!ca.market_snapshot && !pa.price_positioning)) {
    const bodyHtml = Array.isArray(report.content.content) 
      ? report.content.content.map(parseTipTapNode).join("") 
      : typeof report.content === "string" ? report.content : "No content available.";
    
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${report.title}</title>
  <style>
    @media print {
      body { margin: 15mm; background: #fff; color: #000; }
    }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
      font-size: 13px; 
      color: #111; 
      line-height: 1.6; 
      padding: 40px; 
      max-width: 800px; 
      margin: 0 auto; 
    }
    h1 { font-size: 22px; margin-bottom: 4px; font-weight: 800; color: #000; }
    h2 { font-size: 16px; margin-top: 24px; margin-bottom: 8px; border-bottom: 2px solid #eee; padding-bottom: 4px; font-weight: 700; color: #111; }
    h3 { font-size: 13px; margin-top: 16px; margin-bottom: 6px; font-weight: 700; color: #222; }
    p { margin: 0 0 10px; }
    ul, ol { margin: 0 0 12px; padding-left: 20px; }
    li { margin-bottom: 6px; }
    blockquote { border-left: 3px solid #6366F1; padding-left: 12px; margin: 0 0 12px; color: #555; font-style: italic; }
    .header { border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
    .meta { font-size: 11px; color: #666; margin-top: 4px; font-family: monospace; }
    .logo { font-weight: 800; font-size: 16px; letter-spacing: 0.05em; color: #000; }
    .logo span { color: #6366F1; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">STYLECRAFT <span>LENS</span></div>
    <h1>${report.title}</h1>
    <div class="meta">Generated: ${new Date(report.created_at || Date.now()).toLocaleDateString()}</div>
  </div>
  <div class="report-body">
    ${bodyHtml}
  </div>
 </body>
</html>`;
  }

  const categoryName = ca.market_snapshot?.amazon_category || "Professional Barbering & Grooming";
  const dateStr = new Date(report.created_at || Date.now()).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${report.title}</title>
  <style>
    @media print {
      body { margin: 15mm 15mm 15mm 15mm; background: #fff; color: #000; }
      .no-print { display: none; } 
      .page-break { page-break-after: always; break-after: page; }
      .comp-card, tr, .rec-card { page-break-inside: avoid; break-inside: avoid; }
    }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
      font-size: 12px; 
      color: #1a1a1a; 
      line-height: 1.5; 
      background: #fff;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    .cover-page {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 80vh;
      border-left: 8px solid #6366F1;
      padding: 80px 40px;
      margin-bottom: 40px;
      page-break-after: always;
      break-after: page;
    }
    .cover-brand {
      font-weight: 900;
      font-size: 20px;
      letter-spacing: 0.05em;
      color: #111;
      margin-bottom: 24px;
    }
    .cover-brand span { color: #6366F1; }
    .cover-badge {
      display: inline-block;
      padding: 4px 10px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.1em;
      border-radius: 4px;
      background: #EEF2FF;
      color: #4F46E5;
      margin-bottom: 16px;
      text-transform: uppercase;
    }
    .cover-title {
      font-size: 34px;
      font-weight: 800;
      line-height: 1.1;
      color: #111;
      margin-bottom: 8px;
    }
    .cover-subtitle {
      font-size: 15px;
      color: #4B5563;
      margin-bottom: 40px;
    }
    .cover-divider {
      width: 120px;
      height: 4px;
      background: #6366F1;
      margin-bottom: 40px;
    }
    .cover-meta {
      font-size: 12px;
      color: #666;
      line-height: 1.8;
    }
    h2 { 
      font-size: 18px; 
      margin-top: 32px; 
      margin-bottom: 12px; 
      border-bottom: 2px solid #E5E7EB; 
      padding-bottom: 6px; 
      font-weight: 800; 
      color: #111; 
    }
    h3 { 
      font-size: 13px; 
      margin-top: 20px; 
      margin-bottom: 8px; 
      font-weight: 700; 
      color: #374151; 
    }
    p { margin: 0 0 10px; }
    ul { margin: 0 0 12px; padding-left: 20px; }
    li { margin-bottom: 6px; }
    .header { border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
    .meta { font-size: 11px; color: #666; margin-top: 4px; font-family: monospace; }
    .competitor-grid { 
      display: grid; 
      grid-template-columns: 1fr 1fr; 
      gap: 16px; 
      margin-bottom: 24px; 
    }
    .comp-card { 
      border: 1px solid #E5E7EB; 
      border-radius: 8px; 
      padding: 16px; 
      background: #F9FAFB; 
    }
    .comp-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .comp-name { 
      font-weight: 800; 
      font-size: 13px; 
      color: #111; 
    }
    .comp-brand {
      font-size: 10px;
      font-weight: 700;
      color: #6366F1;
      text-transform: uppercase;
    }
    .comp-price {
      font-weight: 800;
      color: #10B981;
      font-size: 12px;
    }
    .comp-metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      font-size: 10px;
      color: #4B5563;
      margin-bottom: 12px;
      background: #fff;
      padding: 8px;
      border-radius: 6px;
      border: 1px solid #F3F4F6;
    }
    .comp-bullet {
      margin-bottom: 4px;
      font-size: 11px;
    }
    .comp-specs {
      font-size: 10px;
      color: #6B7280;
      border-top: 1px solid #E5E7EB;
      padding-top: 8px;
      margin-top: 8px;
    }
    .comparison-table { 
      width: 100%; 
      border-collapse: collapse; 
      font-size: 10px; 
      margin-bottom: 32px; 
      margin-top: 10px;
    }
    .comparison-table th, .comparison-table td { 
      border: 1px solid #E5E7EB; 
      padding: 8px 10px; 
      text-align: left; 
    }
    .comparison-table th { 
      background: #F3F4F6; 
      font-weight: 700; 
      color: #374151; 
    }
    .rec-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 24px;
    }
    .rec-card { 
      border-left: 4px solid #6366F1; 
      padding: 12px 16px; 
      border-radius: 0 8px 8px 0; 
      background: #F9FAFB; 
    }
    .rec-card.priority-high { 
      border-color: #EF4444; 
      background: #FEF2F2; 
    }
    .rec-card.priority-medium { 
      border-color: #F59E0B; 
      background: #FFFBEB; 
    }
    .rec-card.priority-low { 
      border-color: #10B981; 
      background: #ECFDF5; 
    }
    .rec-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .rec-title {
      font-weight: 800;
      font-size: 12px;
      color: #111;
    }
    .rec-badge {
      font-size: 9px;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .rec-badge.high { background: #FCA5A5; color: #991B1B; }
    .rec-badge.medium { background: #FCD34D; color: #92400E; }
    .rec-badge.low { background: #6EE7B7; color: #065F46; }
    .logo { font-weight: 800; font-size: 16px; letter-spacing: 0.05em; color: #000; }
    .logo span { color: #6366F1; }
    .badge { display: inline-block; padding: 2px 6px; font-size: 9px; font-weight: 700; border-radius: 3px; text-transform: uppercase; background: #eee; color: #333; }
    .badge-pro { background: #e0e7ff; color: #4338ca; }
  </style>
</head>
<body>
  
  <!-- COVER PAGE -->
  <div class="cover-page">
    <div class="cover-brand">STYLECRAFT <span>LENS</span></div>
    <div class="cover-badge">Competitive Intelligence Report</div>
    <h1 class="cover-title">${ca.product_name || report.title || "Apex Cordless Clipper"}</h1>
    <p class="cover-subtitle">Target Category: ${categoryName}</p>
    <div class="cover-divider"></div>
    <div class="cover-meta">
      <div><strong>Prepared For:</strong> StyleCraft B2B Dashboard</div>
      <div><strong>Date Compiled:</strong> ${dateStr}</div>
      <div style="font-family: monospace; font-size: 9px; margin-top: 20px; opacity: 0.5;">REPORT ID: ${report.id || "TEMP_ID"}</div>
    </div>
  </div>

  ${(showAll || activeTab === "competitive-analysis") ? `
    <h2>1. Market Analysis & Gaps</h2>
    <p><strong>Product Name:</strong> ${ca.product_name || report.title}</p>
    <p><strong>Market Overview:</strong> ${ca.market_snapshot?.overview_paragraph || "No snapshot available."}</p>
    
    <h3>Key Industry Trends</h3>
    <ul>
      ${(ca.key_trends || []).map((t: any) => `<li><strong>${t.trend_name}:</strong> ${t.description}</li>`).join("")}
      ${(ca.key_trends || []).length === 0 ? "<li>No trends recorded.</li>" : ""}
    </ul>

    <h3>Market Gaps Identified</h3>
    <ul>
      ${(ca.market_gaps || []).map((g: any) => `<li>${g}</li>`).join("")}
      ${(ca.market_gaps || []).length === 0 ? "<li>No market gaps recorded.</li>" : ""}
    </ul>

    <div class="page-break"></div>

    <h2>2. Competitor Landscape</h2>
    
    <h3>Established Legacy Brands</h3>
    <div class="competitor-grid">
      ${(ca.large_brand_competitors || []).map((c: any) => `
        <div class="comp-card">
          <div class="comp-header">
            <div>
              <div class="comp-name">${c.name}</div>
              <div class="comp-brand">${c.brand}</div>
            </div>
            <div class="comp-price">${c.price || "—"}</div>
          </div>
          <div class="comp-metrics">
            <div><strong>ASIN:</strong> ${c.asin}</div>
            ${c.rating ? `<div><strong>Rating:</strong> ${renderStarRating(c.rating, c.review_count)}</div>` : ""}
            <div><strong>Sales:</strong> ${c.monthly_sales || "—"}</div>
            ${c.bsr_rank ? `<div><strong>Rank:</strong> ${c.bsr_rank}</div>` : ""}
          </div>
          ${c.top_feature_summary ? `<div class="comp-bullet"><strong>Differentiator:</strong> ${c.top_feature_summary}</div>` : ""}
          <div class="comp-specs">
            <strong>Specs:</strong> Motor: ${c.confirmed_technical_specs?.motor_type || "—"} | RPM: ${c.confirmed_technical_specs?.rpm || "—"} | Run: ${c.confirmed_technical_specs?.run_time || "—"}
          </div>
        </div>
      `).join("")}
    </div>

    <h3>Legacy Brand Comparison Table</h3>
    <table class="comparison-table">
      <thead>
        <tr>
          <th style="width: 25%">Model</th>
          <th style="width: 10%">Price</th>
          <th style="width: 10%">Rating</th>
          <th style="width: 12%">Review Count</th>
          <th style="width: 15%">Monthly Sales</th>
          <th style="width: 15%">Motor Type</th>
          <th style="width: 13%">RPM</th>
        </tr>
      </thead>
      <tbody>
        ${(ca.large_brand_competitors || []).map((c: any) => `
          <tr>
            <td><strong>${c.name}</strong></td>
            <td>${c.price || "—"}</td>
            <td>${renderStarRating(c.rating) || "—"}</td>
            <td>${c.review_count || "—"}</td>
            <td>${c.monthly_sales || "—"}</td>
            <td>${c.confirmed_technical_specs?.motor_type || "—"}</td>
            <td>${c.confirmed_technical_specs?.rpm || "—"}</td>
          </tr>
        `).join("")}
        ${(ca.large_brand_competitors || []).length === 0 ? "<tr><td colspan='7'>No legacy competitors analyzed.</td></tr>" : ""}
      </tbody>
    </table>

    <div class="page-break"></div>

    <h3>Indie & Emerging Brands</h3>
    <div class="competitor-grid">
      ${(ca.indie_emerging_competitors || []).map((c: any) => `
        <div class="comp-card">
          <div class="comp-header">
            <div>
              <div class="comp-name">${c.name}</div>
              <div class="comp-brand">${c.brand}</div>
            </div>
            <div class="comp-price">${c.price || "—"}</div>
          </div>
          <div class="comp-metrics">
            <div><strong>ASIN:</strong> ${c.asin}</div>
            ${c.rating ? `<div><strong>Rating:</strong> ${renderStarRating(c.rating, c.review_count)}</div>` : ""}
            <div><strong>Sales:</strong> ${c.monthly_sales || "—"}</div>
            ${c.bsr_rank ? `<div><strong>Rank:</strong> ${c.bsr_rank}</div>` : ""}
          </div>
          ${c.top_feature_summary ? `<div class="comp-bullet"><strong>Differentiator:</strong> ${c.top_feature_summary}</div>` : ""}
          <div class="comp-specs">
            <strong>Specs:</strong> Motor: ${c.confirmed_technical_specs?.motor_type || "—"} | RPM: ${c.confirmed_technical_specs?.rpm || "—"} | Run: ${c.confirmed_technical_specs?.run_time || "—"}
          </div>
        </div>
      `).join("")}
    </div>

    <h3>Indie Brand Comparison Table</h3>
    <table class="comparison-table">
      <thead>
        <tr>
          <th style="width: 25%">Model</th>
          <th style="width: 10%">Price</th>
          <th style="width: 10%">Rating</th>
          <th style="width: 12%">Review Count</th>
          <th style="width: 15%">Monthly Sales</th>
          <th style="width: 15%">Motor Type</th>
          <th style="width: 13%">RPM</th>
        </tr>
      </thead>
      <tbody>
        ${(ca.indie_emerging_competitors || []).map((c: any) => `
          <tr>
            <td><strong>${c.name}</strong></td>
            <td>${c.price || "—"}</td>
            <td>${renderStarRating(c.rating) || "—"}</td>
            <td>${c.review_count || "—"}</td>
            <td>${c.monthly_sales || "—"}</td>
            <td>${c.confirmed_technical_specs?.motor_type || "—"}</td>
            <td>${c.confirmed_technical_specs?.rpm || "—"}</td>
          </tr>
        `).join("")}
        ${(ca.indie_emerging_competitors || []).length === 0 ? "<tr><td colspan='7'>No indie competitors analyzed.</td></tr>" : ""}
      </tbody>
    </table>

    <div class="page-break"></div>

    <h3>Strategic Positioning Statement</h3>
    <p>${ca.positioning_recommendation || "No positioning recommendation specified."}</p>
  ` : ""}

  ${(showAll || activeTab === "pricing") && !isPricingAnalysisEmpty(pa) ? `
    ${showAll ? "" : '<div class="page-break"></div>'}
    <h2>3. Pricing Analysis & Benchmarks</h2>
    ${pa.target_price ? `<p><strong>Target Price:</strong> ${pa.target_price}</p>` : ""}
    ${pa.price_positioning ? `<p><strong>Price Positioning:</strong> ${pa.price_positioning}</p>` : ""}

    <h3>Pricing Benchmarks</h3>
    <table class="comparison-table">
      <thead>
        <tr>
          <th>Competitor Name</th>
          <th>Brand</th>
          <th>Tier</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        ${(pa.competitor_prices || []).map((p: any) => `
          <tr>
            <td>${p.name}${p.source_url ? ` <a href="${p.source_url}" style="font-size:9px;">[source]</a>` : ""}</td>
            <td>${p.brand || ""}</td>
            <td>${p.tier ? `<span class="badge ${p.tier === "Best" ? "badge-pro" : ""}">${p.tier}</span>` : ""}</td>
            <td>${p.price || ""}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    ${pa.notes ? `
      <h3>Pricing Strategy Notes</h3>
      <p>${pa.notes}</p>
    ` : ""}
  ` : ""}
  ${activeTab === "pricing" && !showAll && isPricingAnalysisEmpty(pa) ? `
    <h2>3. Pricing Analysis & Benchmarks</h2>
    <p>No pricing data available for this report.</p>
  ` : ""}

  ${(showAll || activeTab === "go-to-market") ? `
    ${showAll ? '<div class="page-break"></div>' : ""}
    <h2>4. Strategic Recommendations & GTM</h2>
    <p><strong>Core Positioning Strategy:</strong> ${gtm.positioning || "No positioning statement recorded."}</p>

    <h3>Strategic Recommendations</h3>
    <div class="rec-grid">
      ${(gtm.recommendations || []).map((r: any) => `
        <div class="rec-card priority-${r.priority || "medium"}">
          <div class="rec-header">
            <span class="rec-title">${r.headline || r.title || "Recommendation"}</span>
            <span class="rec-badge ${r.priority}">${r.priority} Priority</span>
          </div>
          <p style="margin-top: 4px; font-size: 11px; color: #4B5563;">${r.explanation || r.detail || ""}</p>
        </div>
      `).join("")}
    </div>

    <h3>Tactical Quick Wins</h3>
    <ul>
      ${(gtm.quick_wins || []).map((w: any) => `<li>${w}</li>`).join("")}
      ${(gtm.quick_wins || []).length === 0 ? "<li>No quick wins recorded.</li>" : ""}
    </ul>
  ` : ""}

  ${(showAll || activeTab === "content-form") ? `
    ${showAll ? '<div class="page-break"></div>' : ""}
    <h2>5. Creative Brief & Content Specs</h2>
    <p><strong>Product / Initiative:</strong> ${cf.product_name || "Stylecraft Lens Tooling"}</p>
    <p><strong>Target Audience Persona:</strong> ${cf.target_audience || "Professional barbers and hair stylists."}</p>

    <h3>Core Creative Messages</h3>
    <ul>
      ${(cf.key_messages || []).map((m: any) => `<li>${m}</li>`).join("")}
      ${(cf.key_messages || []).length === 0 ? "<li>No key messages listed.</li>" : ""}
    </ul>

    ${cf.notes ? `
      <h3>Content Creation Notes</h3>
      <p>${cf.notes}</p>
    ` : ""}
  ` : ""}

</body>
</html>`;
}
