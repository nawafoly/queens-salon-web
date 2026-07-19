import { useRef, useState } from "react";
import { FiUpload, FiX } from "react-icons/fi";
import * as XLSX from "xlsx";
import Modal from "../../components/Modal";
import { CoreClientService } from "../../services/CoreClientService";
import type { CoreClient } from "../../types/coreApi";
import {
  customerPhoneDigits,
  formatCustomerPhone,
  normalizeCustomerName,
  UNNAMED_CUSTOMER_LABEL,
} from "./customerFormatters";

type PreviewRow = {
  rawName: string;
  name: string;
  phone: string;
  digits: string;
  vip: boolean;
  note: string;
};

function normalizeHeaderKey(value: string): string {
  return String(value || "").trim().toLocaleLowerCase("ar").replace(/\s+/g, " ");
}

function getField(row: Record<string, unknown>, candidates: string[]): unknown {
  const fields: Record<string, unknown> = {};
  Object.keys(row || {}).forEach((key) => { fields[normalizeHeaderKey(key)] = row[key]; });
  for (const candidate of candidates) {
    const value = fields[normalizeHeaderKey(candidate)];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return "";
}

function parseVip(value: unknown): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "vip", "نعم", "صح"].includes(text);
}

type Props = {
  open: boolean;
  existingClients: CoreClient[];
  onClose: () => void;
  onImported: (clients: CoreClient[]) => void;
};

export default function CustomersImportModal({ open, existingClients, onClose, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);

  const resetAndClose = () => {
    if (importing) return;
    setPreview([]);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    onClose();
  };

  const pickFile = (file: File) => {
    setError("");
    setPreview([]);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target?.result, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error("الملف لا يحتوي على ورقة بيانات.");
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "" });
        if (!rows.length) throw new Error("ملف Excel فارغ.");

        const seen = new Set<string>();
        const next: PreviewRow[] = [];
        rows.forEach((row) => {
          const rawName = String(getField(row, ["name", "الاسم", "اسم", "العميلة", "client", "clientName"]) || "").trim();
          const rawPhone = String(getField(row, ["phone", "الجوال", "رقم", "mobile", "clientPhone"]) || "").trim();
          const digits = customerPhoneDigits(rawPhone);
          if (!digits || seen.has(digits)) return;
          seen.add(digits);
          next.push({
            rawName: rawName.replace(/\s+/g, " ").trim(),
            name: normalizeCustomerName(rawName),
            phone: formatCustomerPhone(rawPhone),
            digits,
            vip: parseVip(getField(row, ["vip", "VIP", "مميزة", "عميلة مميزة"])),
            note: String(getField(row, ["note", "ملاحظة", "ملاحظات", "notes", "remark"]) || "").trim(),
          });
        });
        if (!next.length) throw new Error("لم نجد صفوفًا صالحة. يجب أن يحتوي كل صف على رقم جوال.");
        setPreview(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "تعذر قراءة ملف Excel.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const commitImport = async () => {
    if (!preview.length) {
      setError("لا توجد بيانات جاهزة للحفظ.");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const existingByPhone = new Map(existingClients.map((client) => [customerPhoneDigits(client.phoneNormalized), client]));
      for (const row of preview) {
        const existing = existingByPhone.get(row.digits);
        const persistedName = row.rawName || UNNAMED_CUSTOMER_LABEL;
        if (existing?.id) {
          await CoreClientService.patch(existing.id, { name: persistedName, phone: row.phone, vip: row.vip, notes: row.note });
        } else {
          await CoreClientService.create({ id: crypto.randomUUID(), name: persistedName, phone: row.phone, vip: row.vip, notes: row.note });
        }
      }
      onImported(await CoreClientService.list());
      setPreview([]);
      setError("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "حدث خطأ أثناء حفظ بيانات العميلات.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal open={open} onClose={resetAndClose} ariaLabel="استيراد عميلات من Excel" panelClassName="customers-import-modal" size="lg">
      <header className="customers-modal-header">
        <div><p className="customers-eyebrow">دمج آمن</p><h2>استيراد عميلات من Excel</h2><p>تتم المطابقة برقم الجوال من دون حذف أي سجل.</p></div>
        <button type="button" onClick={resetAndClose} disabled={importing} aria-label="إغلاق"><FiX /></button>
      </header>
      <div className="customers-modal-body">
        {error ? <div className="customers-inline-error">{error}</div> : null}
        <label className="customers-file-picker">
          <FiUpload />
          <span><strong>اختاري ملف Excel</strong><small>الأعمدة المدعومة: الاسم، الجوال، VIP، ملاحظة.</small></span>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) pickFile(file); }} disabled={importing} />
        </label>
        {preview.length ? (
          <section className="customers-import-preview">
            <header><div><h3>معاينة البيانات</h3><p>سيتم دمج {preview.length.toLocaleString("ar-SA")} عميلة اعتمادًا على رقم الجوال.</p></div></header>
            <div><table><thead><tr><th>الاسم</th><th>الجوال</th><th>VIP</th><th>ملاحظة</th></tr></thead><tbody>{preview.slice(0, 80).map((row) => <tr key={row.digits}><td>{row.name}</td><td><bdi dir="ltr">{row.phone}</bdi></td><td>{row.vip ? "VIP" : "عادية"}</td><td>{row.note || "—"}</td></tr>)}</tbody></table></div>
            {preview.length > 80 ? <p>تم عرض أول 80 صفًا من {preview.length.toLocaleString("ar-SA")}.</p> : null}
          </section>
        ) : null}
        <footer className="customers-modal-actions">
          <button type="button" className="customers-button is-secondary" onClick={resetAndClose} disabled={importing}>إلغاء</button>
          <button type="button" className="customers-button is-primary" onClick={() => void commitImport()} disabled={importing || !preview.length}>{importing ? "جارٍ الحفظ والدمج" : "حفظ ودمج"}</button>
        </footer>
      </div>
    </Modal>
  );
}
