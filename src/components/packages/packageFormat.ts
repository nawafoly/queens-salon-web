export function packageDate(value: any) {
  const ms = typeof value?.toMillis === "function"
    ? value.toMillis()
    : typeof value?.seconds === "number"
      ? value.seconds * 1000
      : Number(value || 0);
  return ms ? new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(ms)) : "بدون انتهاء";
}

export function printPackageDocument(title: string, body: string) {
  const popup = window.open("", "_blank", "width=760,height=840");
  if (!popup) return false;
  popup.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#172033}h1{font-size:24px}.box{border:1px solid #ddd;border-radius:14px;padding:20px;line-height:2}.total{font-size:20px;font-weight:800}@media print{button{display:none}}</style></head><body><h1>${title}</h1><div class="box">${body}</div><button onclick="print()">طباعة</button></body></html>`);
  popup.document.close();
  return true;
}
