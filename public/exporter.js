/**
 * Exporter (admin-only)
 * - Calls /.netlify/functions/export to fetch ALL sheets as JSON
 * - Generates XLSX / CSV / JSON in-browser (no extra backend deps)
 *
 * Requirements:
 * - User must be logged in (token in localStorage/sessionStorage)
 * - Netlify env var AUTH_JWT_SECRET set (same used by login)
 */

(function () {
  function getToken() {
    // Try common keys
    const keys = ["token", "authToken", "auth_token", "jwt", "anfiteatro_token"];
    for (const k of keys) {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (v) return v;
    }
    // Some apps store a "session" JSON
    const sess = localStorage.getItem("session") || sessionStorage.getItem("session");
    if (sess) {
      try {
        const obj = JSON.parse(sess);
        return obj.token || obj.jwt || obj.authToken || null;
      } catch {}
    }
    return null;
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some(s => s.src && s.src.includes(src))) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function fetchAllSheets() {
    const token = getToken();
    if (!token) throw new Error("No hay sesión/token. Inicia sesión nuevamente.");
    const res = await fetch("/.netlify/functions/export", {
      headers: { Authorization: "Bearer " + token }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo exportar");
    return data;
  }

  function sanitizeSheetName(name) {
    // Excel limits: 31 chars, no : \ / ? * [ ]
    const cleaned = String(name || "Hoja").replace(/[:\\/?*\[\]]/g, " ").trim();
    return cleaned.slice(0, 31) || "Hoja";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function toCSV(header, rows) {
    const esc = (v) => {
      const s = (v === null || v === undefined) ? "" : String(v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [];
    lines.push((header || []).map(esc).join(","));
    for (const r of (rows || [])) lines.push((r || []).map(esc).join(","));
    return lines.join("\n");
  }

  async function exportAsXlsx(payload) {
    // SheetJS (CDN)
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();

    for (const s of payload.sheets) {
      const aoa = [s.header || [], ...(s.rows || [])];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(s.title));
    }

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    downloadBlob(new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Anfiteatro_Export_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  async function exportAsJson(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, `Anfiteatro_Export_${new Date().toISOString().slice(0,10)}.json`);
  }

  async function exportAsCsvZip(payload) {
    // Zip all sheets as CSV files
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
    const JSZip = window.JSZip;
    const zip = new JSZip();
    for (const s of payload.sheets) {
      const csv = toCSV(s.header, s.rows);
      zip.file(`${sanitizeSheetName(s.title)}.csv`, csv);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `Anfiteatro_Export_CSV_${new Date().toISOString().slice(0,10)}.zip`);
  }

  async function exportAsPdf(payload) {
    // Simple PDF summary per sheet (first 25 rows)
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const margin = 40;
    let y = margin;

    doc.setFontSize(14);
    doc.text("Anfiteatro - Export", margin, y);
    y += 18;
    doc.setFontSize(10);
    doc.text(`Generado: ${new Date().toLocaleString()}`, margin, y);
    y += 20;

    for (const s of payload.sheets) {
      doc.setFontSize(12);
      doc.text(String(s.title), margin, y);
      y += 14;

      doc.setFontSize(9);
      const header = (s.header || []).join(" | ");
      doc.text(header.slice(0, 110), margin, y);
      y += 12;

      const rows = (s.rows || []).slice(0, 25);
      for (const r of rows) {
        const line = (r || []).join(" | ");
        doc.text(line.slice(0, 110), margin, y);
        y += 11;
        if (y > 780) { doc.addPage(); y = margin; }
      }

      y += 14;
      if (y > 780) { doc.addPage(); y = margin; }
    }

    const blob = doc.output("blob");
    downloadBlob(blob, `Anfiteatro_Export_${new Date().toISOString().slice(0,10)}.pdf`);
  }

  async function runExport() {
    // Ask format
    const fmt = (prompt("Formato exportación: xlsx / csv / pdf / json", "xlsx") || "xlsx").trim().toLowerCase();
    const payload = await fetchAllSheets();
    if (fmt === "xlsx") return exportAsXlsx(payload);
    if (fmt === "json") return exportAsJson(payload);
    if (fmt === "csv") return exportAsCsvZip(payload);
    if (fmt === "pdf") return exportAsPdf(payload);
    alert("Formato no válido. Usa: xlsx, csv, pdf o json.");
  }

  // Expose
  window.ANF_EXPORT = { runExport };
})();
