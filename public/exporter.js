/**
 * Exporter (admin-only)
 * - Calls /.netlify/functions/export to fetch ALL sheets as JSON
 * - Generates XLSX / CSV / PDF / JSON in-browser (no extra backend deps)
 *
 * Notes:
 * - Robust token lookup across common keys.
 * - Shows helpful alerts on errors (403/401/etc) instead of failing silently.
 */
(function () {
  function getToken() {
    const keys = [
      // common
      "token", "authToken", "auth_token", "jwt",
      // anfiteatro variants
      "anfiteatro_token", "anfiteatroToken", "anf_token",
      "anfiteatro_session", "anf_session", "session"
    ];

    for (const k of keys) {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (!v) continue;

      // Some apps store raw token; others store JSON.
      if (typeof v === "string" && v.split(".").length === 3) return v;

      try {
        const obj = JSON.parse(v);
        const t =
          obj.token || obj.jwt || obj.authToken || obj.access_token ||
          (obj.session && (obj.session.token || obj.session.jwt));
        if (t && String(t).split(".").length === 3) return t;
      } catch {}
    }
    return null;
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some(s => (s.src || "").includes(src))) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("No se pudo cargar: " + src));
      document.head.appendChild(s);
    });
  }

  async function fetchAllSheets() {
    const token = getToken();
    if (!token) throw new Error("No se encontró sesión/token. Cierra sesión e ingresa de nuevo.");

    const res = await fetch("/.netlify/functions/export", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    let data = null;
    const text = await res.text().catch(() => "");
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text || "Respuesta no JSON" }; }

    if (!res.ok || !data.ok) {
      const msg = data && data.error ? data.error : ("No se pudo exportar (HTTP " + res.status + ")");
      throw new Error(msg);
    }
    return data;
  }

  function sanitizeSheetName(name) {
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
    const out = [];
    out.push((header || []).map(esc).join(","));
    for (const r of rows || []) out.push((r || []).map(esc).join(","));
    return out.join("\n");
  }

  async function exportAsXlsx(payload) {
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    if (!window.XLSX) throw new Error("Librería XLSX no disponible (bloqueo de red/CSP).");

    const wb = window.XLSX.utils.book_new();
    for (const sh of payload.sheets || []) {
      const title = sanitizeSheetName(sh.title);
      const data = [sh.header || [], ...(sh.rows || [])];
      const ws = window.XLSX.utils.aoa_to_sheet(data);
      window.XLSX.utils.book_append_sheet(wb, ws, title);
    }
    const blob = window.XLSX.write(wb, { bookType: "xlsx", type: "array" });
    downloadBlob(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Anfiteatro_Export_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  async function exportAsJson(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, `Anfiteatro_Export_${new Date().toISOString().slice(0,10)}.json`);
  }

  async function exportAsCsvZip(payload) {
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
    if (!window.JSZip) throw new Error("Librería JSZip no disponible (bloqueo de red/CSP).");

    const zip = new window.JSZip();
    for (const sh of payload.sheets || []) {
      const title = sanitizeSheetName(sh.title);
      const csv = toCSV(sh.header, sh.rows);
      zip.file(`${title}.csv`, csv);
    }
    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, `Anfiteatro_Export_${new Date().toISOString().slice(0,10)}_CSV.zip`);
  }

  async function exportAsPdf(payload) {
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
    const jspdf = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : null;
    if (!jspdf) throw new Error("Librería jsPDF no disponible (bloqueo de red/CSP).");

    const doc = new jspdf();
    let y = 10;
    doc.setFontSize(14);
    doc.text("Anfiteatro - Export PDF (resumen)", 10, y);
    y += 8;
    doc.setFontSize(10);
    doc.text("Generado: " + (payload.exportedAt || new Date().toISOString()), 10, y);
    y += 10;

    for (const sh of payload.sheets || []) {
      if (y > 270) { doc.addPage(); y = 10; }
      doc.setFontSize(12);
      doc.text(String(sh.title || "Hoja"), 10, y);
      y += 6;
      doc.setFontSize(9);

      const header = (sh.header || []).slice(0, 6);
      const rows = (sh.rows || []).slice(0, 12).map(r => (r || []).slice(0, 6));
      doc.text("Cols: " + header.join(" | "), 10, y);
      y += 5;
      for (const r of rows) {
        if (y > 275) { doc.addPage(); y = 10; }
        doc.text(r.join(" | "), 10, y);
        y += 4;
      }
      y += 6;
    }

    const blob = doc.output("blob");
    downloadBlob(blob, `Anfiteatro_Export_${new Date().toISOString().slice(0,10)}.pdf`);
  }

  async function runExport() {
    try {
      const fmt = (prompt("Formato exportación: xlsx / csv / pdf / json", "xlsx") || "xlsx").trim().toLowerCase();
      const allowed = ["xlsx", "csv", "pdf", "json"];
      if (!allowed.includes(fmt)) {
        alert("Formato no válido. Usa: xlsx, csv, pdf o json.");
        return;
      }

      // Fetch first so we can fail fast with a clear message (401/403/etc.)
      const payload = await fetchAllSheets();

      if (fmt === "xlsx") return await exportAsXlsx(payload);
      if (fmt === "json") return await exportAsJson(payload);
      if (fmt === "csv") return await exportAsCsvZip(payload);
      if (fmt === "pdf") return await exportAsPdf(payload);
    } catch (err) {
      console.error("Export error:", err);
      alert("No se pudo exportar:\n" + (err && err.message ? err.message : String(err)));
    }
  }

  window.ANF_EXPORT = { runExport };
})();
