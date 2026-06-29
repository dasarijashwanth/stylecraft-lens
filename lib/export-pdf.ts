// lib/export-pdf.ts

export async function downloadReportPDF(report: any) {
  // Create a print-ready HTML document
  const html = generatePrintHTML(report);

  const blob = new Blob([html], { type: "text/html" });
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

  const blob = new Blob([html], { type: "text/html" });
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

  return `<!DOCTYPE html>
<html>
<head>
  <title>${report.title}</title>
  <style>
    @media print { 
      body { margin: 15mm 15mm 15mm 15mm; background: #fff; color: #000; } 
      .no-print { display: none; } 
      .page-break { page-break-after: always; }
    }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
      font-size: 13px; 
      color: #111; 
      line-height: 1.6; 
      background: #fff;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    h1 { font-size: 24px; margin-bottom: 4px; font-weight: 800; color: #000; }
    h2 { font-size: 16px; margin-top: 24px; margin-bottom: 8px; border-bottom: 2px solid #eee; padding-bottom: 4px; font-weight: 700; color: #111; }
    h3 { font-size: 13px; margin-top: 16px; margin-bottom: 6px; font-weight: 700; color: #222; }
    p { margin: 0 0 10px; }
    ul { margin: 0 0 12px; padding-left: 20px; }
    li { margin-bottom: 6px; }
    .header { border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
    .meta { font-size: 11px; color: #666; margin-top: 4px; font-family: monospace; }
    .competitor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .comp-card { border: 1px solid #ddd; border-radius: 6px; padding: 10px; background: #fafafa; }
    .comp-name { font-weight: 700; font-size: 12px; color: #000; }
    .comp-meta { font-size: 11px; color: #555; margin-top: 2px; }
    .rec-card { border-left: 3px solid #6366F1; padding: 8px 12px; margin-bottom: 10px; background: #f9f9ff; }
    .priority-high { border-color: #EF4444; background: #fffcfc; }
    .priority-medium { border-color: #F59E0B; background: #fffdfa; }
    .priority-low { border-color: #6B7280; background: #fafafa; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
    th { background: #f5f5f5; font-weight: 700; color: #000; }
    .logo { font-weight: 800; font-size: 16px; letter-spacing: 0.05em; color: #000; }
    .logo span { color: #6366F1; }
    .badge { display: inline-block; padding: 2px 6px; font-size: 9px; font-weight: 700; border-radius: 3px; text-transform: uppercase; background: #eee; color: #333; }
    .badge-pro { background: #e0e7ff; color: #4338ca; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">STYLECRAFT <span>LENS</span></div>
    <h1>${report.title}</h1>
    <div class="meta">
      Report ID: ${report.id} · Generated: ${new Date(report.created_at || Date.now()).toLocaleDateString()}
    </div>
  </div>

  ${(showAll || activeTab === "competitive-analysis") ? `
    <h2>Market Analysis & Gaps</h2>
    <p><strong>Product Name:</strong> ${ca.product_name || report.title}</p>
    <p><strong>Overview:</strong> ${ca.market_snapshot?.overview_paragraph || "No snapshot available."}</p>
    
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

    <h2>Competitor Landscapes</h2>
    <h3>Large / Established Brands</h3>
    <div class="competitor-grid">
      ${(ca.large_brand_competitors || []).map((c: any) => `
        <div class="comp-card">
          <div class="comp-name">${c.name}</div>
          <div class="comp-meta"><strong>Brand:</strong> ${c.brand || c.name} · <strong>Price:</strong> ${c.price || "—"} · <strong>Rating:</strong> ★ ${c.rating || "—"}</div>
          <div class="comp-meta"><strong>ASIN:</strong> ${c.asin || "N/A"}</div>
        </div>
      `).join("")}
    </div>

    <h3>Indie & Emerging Brands</h3>
    <div class="competitor-grid">
      ${(ca.indie_emerging_competitors || []).map((c: any) => `
        <div class="comp-card">
          <div class="comp-name">${c.name}</div>
          <div class="comp-meta"><strong>Brand:</strong> ${c.brand || c.name} · <strong>Price:</strong> ${c.price || "—"} · <strong>Rating:</strong> ★ ${c.rating || "—"}</div>
          <div class="comp-meta"><strong>ASIN:</strong> ${c.asin || "N/A"}</div>
        </div>
      `).join("")}
    </div>

    <h3>Strategic Positioning Statement</h3>
    <p>${ca.positioning_recommendation || "No positioning recommendation specified."}</p>
  ` : ""}

  ${(showAll || activeTab === "pricing") ? `
    ${showAll ? '<div class="page-break"></div>' : ""}
    <h2>Pricing Analysis</h2>
    <p><strong>Price Positioning Index:</strong> ${pa.price_positioning || "N/A"}</p>
    
    <h3>Competitor Price Reference Grid</h3>
    <table>
      <thead>
        <tr>
          <th>Competitor Name</th>
          <th>Price Point</th>
          <th>Market Segment</th>
        </tr>
      </thead>
      <tbody>
        ${(pa.competitors_pricing || []).map((p: any) => `
          <tr>
            <td>${p.name}</td>
            <td>${p.price || "—"}</td>
            <td><span class="badge ${p.tier === "large" ? "badge-pro" : ""}">${p.tier}</span></td>
          </tr>
        `).join("")}
        ${(pa.competitors_pricing || []).length === 0 ? "<tr><td colspan='3'>No competitor pricing recorded.</td></tr>" : ""}
      </tbody>
    </table>

    ${pa.notes ? `
      <h3>Pricing Strategy Notes</h3>
      <p>${pa.notes}</p>
    ` : ""}
  ` : ""}

  ${(showAll || activeTab === "go-to-market") ? `
    ${showAll ? '<div class="page-break"></div>' : ""}
    <h2>Go-To-Market (GTM) Strategy</h2>
    <p><strong>Core Positioning Strategy:</strong> ${gtm.positioning || "No positioning statement recorded."}</p>

    <h3>Strategic Recommendations</h3>
    ${(gtm.recommendations || []).map((r: any) => `
      <div class="rec-card priority-${r.priority || "medium"}">
        <strong>${r.headline || r.title || "Recommendation"}</strong> <span class="badge">${r.priority}</span>
        <p style="margin-top: 4px; font-size: 11px;">${r.explanation || r.detail || ""}</p>
      </div>
    `).join("")}

    <h3>Tactical Quick Wins</h3>
    <ul>
      ${(gtm.quick_wins || []).map((w: any) => `<li>${w}</li>`).join("")}
      ${(gtm.quick_wins || []).length === 0 ? "<li>No quick wins recorded.</li>" : ""}
    </ul>

    ${gtm.notes ? `
      <h3>GTM Deployment Notes</h3>
      <p>${gtm.notes}</p>
    ` : ""}
  ` : ""}

  ${(showAll || activeTab === "content-form") ? `
    ${showAll ? '<div class="page-break"></div>' : ""}
    <h2>Creative Brief & Content Form</h2>
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
