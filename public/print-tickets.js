/* Ticket printing (single + multiple) - ventana nueva + window.print()
   - 1 ticket por página
   - Usa el mismo diseño del modal (misma construcción HTML)
*/
(function () {
  const PRINT_SEL = new Set();

  function safeFn(name) {
    return typeof window[name] === "function" ? window[name] : null;
  }

  const parseMoney = safeFn("parseMoney");
  const formatCLP = safeFn("formatCLP");
  const formatFechaISO = safeFn("formatFechaISO");
  const isAnuladoEstado = safeFn("isAnuladoEstado");

  function getMovRowById(id) {
    if (!window.MOV || !MOV.idx || MOV.idx.id < 0) return null;
    const rows = MOV.rows || [];
    return rows.find(r => String(r[MOV.idx.id] || "") === String(id || ""));
  }

  function getCell(row, colIdx) {
    return colIdx >= 0 ? (row[colIdx] ?? "") : "";
  }

  function buildTicketInnerHTMLFromRow(row) {
    if (!row || !window.MOV || !MOV.idx) return "<div class='text-sm text-gray-600'>No se pudo construir el ticket.</div>";

    const rawMonto = MOV.idx.monto >= 0 && parseMoney ? parseMoney(getCell(row, MOV.idx.monto)) : 0;
    const tipo = String(getCell(row, MOV.idx.tipo) || "");
    const estadoPagoRaw = String(getCell(row, MOV.idx.estadoPago) || "");
    const isAnulado = isAnuladoEstado ? isAnuladoEstado(estadoPagoRaw) : false;

    const montoBase = isAnulado ? 0 : Math.abs(rawMonto);
    const montoFmt = (tipo === "Egreso" ? "-" : "") + (formatCLP ? formatCLP(montoBase).replace("-", "") : String(montoBase));

    const fields = [
      { key: "ID", value: getCell(row, MOV.idx.id) },
      { key: "Fecha", value: formatFechaISO ? formatFechaISO(getCell(row, MOV.idx.fecha)) : getCell(row, MOV.idx.fecha) },
      { key: "Área", value: getCell(row, MOV.idx.area) },
      { key: "Tipo", value: getCell(row, MOV.idx.tipo) },
      { key: "Descripción", value: getCell(row, MOV.idx.descripcion) },
      { key: "Monto", value: montoFmt },
      { key: "Responsable", value: getCell(row, MOV.idx.responsable) },
      { key: "Periodo", value: getCell(row, MOV.idx.periodo) },
      { key: "Estado de Pago", value: getCell(row, MOV.idx.estadoPago) },
      { key: "Local", value: getCell(row, MOV.idx.local) },
      { key: "Empleado", value: getCell(row, MOV.idx.empleado) },
      { key: "Arrendatario / Propietario", value: getCell(row, MOV.idx.arrendatarioPropietario) },
      { key: "Proveedor / Empresa", value: getCell(row, MOV.idx.proveedorEmpresa) },
      { key: "RUT", value: getCell(row, MOV.idx.rut) },
      { key: "Método de Pago", value: getCell(row, MOV.idx.metodoPago) },
      { key: "Fecha Vencimiento", value: formatFechaISO ? formatFechaISO(getCell(row, MOV.idx.fechaVencimiento)) : getCell(row, MOV.idx.fechaVencimiento) },
      { key: "Número Comprobante", value: getCell(row, MOV.idx.numeroComprobante) },
      { key: "Concepto", value: getCell(row, MOV.idx.concepto) },
      { key: "Notas", value: getCell(row, MOV.idx.notas) },
    ].filter(f => String(f.value || "").trim() !== "");

    const area = String(getCell(row, MOV.idx.area) || "Sin área");
    const desc = String(getCell(row, MOV.idx.descripcion) || "");

    return `
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-sm text-gray-500">Movimiento</div>
          <div class="text-xl font-bold text-gray-900">${area}</div>
          <div class="mt-1 text-sm text-gray-600">${desc}</div>
        </div>
        <div class="text-right">
          <div class="text-sm text-gray-500">${String(getCell(row, MOV.idx.tipo) || "")}</div>
          <div class="text-2xl font-extrabold ${isAnulado ? "text-gray-500" : (tipo === "Ingreso" ? "text-green-600" : "text-red-600")}">${montoFmt}</div>
          ${isAnulado ? `<div class="mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-700">ANULADO</div>` : ``}
        </div>
      </div>

      <div class="border-t border-gray-200 pt-4 mt-4">
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          ${fields.map(f => `
            <div class="flex justify-between sm:block">
              <dt class="text-sm font-semibold text-gray-600">${f.key}</dt>
              <dd class="text-sm text-gray-900 sm:mt-1 break-words">${String(f.value)}</dd>
            </div>
          `).join("")}
        </dl>
      </div>
    `;
  }

  function wrapTicketPage(innerHtml) {
    return `
      <section class="print-page">
        <div class="max-w-2xl mx-auto">
          <div class="border border-gray-200 rounded-2xl p-6">
            ${innerHtml}
          </div>
        </div>
      </section>
    `;
  }

  function buildPrintDocumentHTML(pagesHtml, title) {
    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title || "Tickets"}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @page { size: A4; margin: 12mm; }
    body { background: #fff; }
    .print-page { page-break-after: always; }
    .print-page:last-child { page-break-after: auto; }
  </style>
</head>
<body class="p-0">
  ${pagesHtml}
</body>
</html>`;
  }

  function openPrintWindowWithHTML(docHtml) {
    const w = window.open("", "_blank");
    if (!w) {
      alert("No se pudo abrir la ventana de impresión (pop-up bloqueado).");
      return;
    }
    w.document.open();
    w.document.write(docHtml);
    w.document.close();
    w.focus();
    setTimeout(() => {
      try { w.print(); } catch (e) {}
    }, 700);
  }

  function syncCheckboxes() {
    const tbody = document.getElementById("movimientosBody");
    if (!tbody) return;
    const checks = Array.from(tbody.querySelectorAll("input.movRowSelect[data-id]"));
    checks.forEach(c => {
      const id = c.dataset.id;
      c.checked = PRINT_SEL.has(id);
    });
    updateSelectAllState();
    updatePrintSelectedUI();
  }

  function updateSelectAllState() {
    const all = document.getElementById("movSelectAll");
    const tbody = document.getElementById("movimientosBody");
    if (!all || !tbody) return;
    const checks = Array.from(tbody.querySelectorAll("input.movRowSelect[data-id]"));
    if (!checks.length) {
      all.checked = false;
      all.indeterminate = false;
      return;
    }
    const checkedCount = checks.filter(c => c.checked).length;
    all.checked = checkedCount === checks.length;
    all.indeterminate = checkedCount > 0 && checkedCount < checks.length;
  }

  function updatePrintSelectedUI() {
    const btn = document.getElementById("printSelectedButton");
    const badge = document.getElementById("printSelectedCount");
    if (!btn || !badge) return;
    const n = PRINT_SEL.size;
    if (n > 0) {
      btn.disabled = false;
      btn.classList.remove("opacity-50", "cursor-not-allowed");
      badge.textContent = String(n);
      badge.classList.remove("hidden");
    } else {
      btn.disabled = true;
      btn.classList.add("opacity-50", "cursor-not-allowed");
      badge.classList.add("hidden");
    }
  }

  function printTicketById(id) {
    const row = getMovRowById(id);
    if (!row) {
      alert("No encontré el movimiento.");
      return;
    }
    const inner = buildTicketInnerHTMLFromRow(row);
    const page = wrapTicketPage(inner);
    openPrintWindowWithHTML(buildPrintDocumentHTML(page, "Ticket"));
  }

  function printSelectedTickets() {
    const ids = Array.from(PRINT_SEL);
    if (!ids.length) {
      alert("Selecciona al menos un movimiento para imprimir.");
      return;
    }
    const pages = ids.map(id => {
      const row = getMovRowById(id);
      if (!row) return "";
      const inner = buildTicketInnerHTMLFromRow(row);
      return wrapTicketPage(inner);
    }).filter(Boolean).join("");
    openPrintWindowWithHTML(buildPrintDocumentHTML(pages, "Tickets"));
  }

  // Expose for action handler in index.html
  window.printTicketById = printTicketById;
  window.printSelectedTickets = printSelectedTickets;

  // Event handlers
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#printSelectedButton");
    if (btn) {
      e.preventDefault();
      printSelectedTickets();
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t && t.matches("input.movRowSelect[data-id]")) {
      const id = t.dataset.id;
      if (!id) return;
      if (t.checked) PRINT_SEL.add(id);
      else PRINT_SEL.delete(id);
      updateSelectAllState();
      updatePrintSelectedUI();
      return;
    }

    if (t && t.id === "movSelectAll") {
      const tbody = document.getElementById("movimientosBody");
      if (!tbody) return;
      const checks = Array.from(tbody.querySelectorAll("input.movRowSelect[data-id]"));
      checks.forEach(c => {
        c.checked = t.checked;
        const id = c.dataset.id;
        if (t.checked) PRINT_SEL.add(id);
        else PRINT_SEL.delete(id);
      });
      updateSelectAllState();
      updatePrintSelectedUI();
    }
  });

  // Observe table re-renders to keep selection
  window.addEventListener("DOMContentLoaded", () => {
    const tbody = document.getElementById("movimientosBody");
    if (tbody) {
      const obs = new MutationObserver(() => {
        syncCheckboxes();
      });
      obs.observe(tbody, { childList: true, subtree: true });
    }
    syncCheckboxes();
  });
})();
