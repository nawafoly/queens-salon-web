import { DOCUMENT_BRANDING } from "../documents/core/documentBranding";

function certificateRoot() {
  return document.querySelector<HTMLElement>(".salary-certificate-print-root");
}

function currentStyleNodes() {
  return Array.from(document.head.querySelectorAll("link[rel='stylesheet'], style"))
    .map((node) => node.outerHTML)
    .join("\n");
}

function waitForImages(doc: Document) {
  return Promise.all(
    Array.from(doc.images).map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    })
  );
}

const PRINT_CSS = `
@page { size: A4 portrait; margin: 0; }
html, body {
  margin: 0 !important;
  padding: 0 !important;
  width: 210mm !important;
  min-height: 297mm !important;
  background: #fff !important;
  overflow: visible !important;
}
body { direction: rtl !important; display: block !important; }
.salary-certificate-print-root,
.document-a4-page {
  width: 210mm !important;
  min-height: 297mm !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 13mm 12mm 11mm !important;
  border: 0 !important;
  box-shadow: none !important;
  background: #fff !important;
  color: #000 !important;
  overflow: visible !important;
  transform: none !important;
  page-break-inside: avoid !important;
  break-inside: avoid-page !important;
}
.document-watermark {
  filter: brightness(0) contrast(100%) !important;
  opacity: ${DOCUMENT_BRANDING.watermarkOpacity} !important;
}
.leave-request-export-toolbar,
.employee-request-action-modal,
.dashboard-sidebar,
.navbar,
.bottom-nav { display: none !important; }
`;

export async function printSalaryCertificateDocument() {
  const source = certificateRoot();
  if (!source) throw new Error("لم يتم العثور على تعريف الراتب للطباعة.");

  const frame = document.createElement("iframe");
  frame.setAttribute("title", "طباعة تعريف الراتب");
  Object.assign(frame.style, {
    position: "fixed",
    width: "1px",
    height: "1px",
    right: "-10000px",
    bottom: "0",
    border: "0",
  });
  document.body.appendChild(frame);

  const printDoc = frame.contentDocument;
  if (!printDoc) {
    frame.remove();
    throw new Error("تعذر تجهيز نافذة الطباعة.");
  }

  const clone = source.cloneNode(true) as HTMLElement;
  printDoc.open();
  printDoc.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><base href="${document.baseURI}">${currentStyleNodes()}<style>${PRINT_CSS}</style></head><body>${clone.outerHTML}</body></html>`);
  printDoc.close();

  await waitForImages(printDoc);
  if ("fonts" in printDoc) {
    try { await printDoc.fonts.ready; } catch { /* Browser fallback is acceptable. */ }
  }

  const printWindow = frame.contentWindow;
  if (!printWindow) {
    frame.remove();
    throw new Error("تعذر فتح نافذة الطباعة.");
  }
  printWindow.focus();
  printWindow.print();
  window.setTimeout(() => frame.remove(), 1800);
}
