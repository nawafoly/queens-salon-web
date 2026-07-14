import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { PackageService, type Package } from "../../services/PackageService";
import { ClientPackageService, type ClientPackage } from "../../services/ClientPackageService";
import { PackageOperationsService, type PackagePurchaseResult, type PackageRedemptionResult } from "../../services/PackageOperationsService";
import { packageDate, printPackageDocument } from "./packageFormat";
import "../../styles/SessionPackages.css";

type BookingItem = {
  serviceId?: string; serviceName?: string; employeeId?: string; employeeName?: string;
  date?: string; time?: string; locked?: boolean;
};

function millis(value: any) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return Number(value || 0);
}

function stableClientId(client: any) {
  const explicit = String(client?.clientId || "").trim();
  if (explicit) return explicit;
  const id = String(client?.id || "").trim();
  return id && String(client?.source || "") === "client_profile" ? id : "";
}

export default function AdminPackageFlow(props: {
  client: any;
  bookingItem?: BookingItem | null;
  onRedeemed?: (result: PackageRedemptionResult) => void;
  onClientCreated?: (client: any) => void;
}) {
  const clientId = stableClientId(props.client);
  const clientName = String(props.client?.name || props.client?.fullName || "").trim();
  const clientPhone = String(props.client?.phone || props.client?.mobile || "").trim();
  const [wallet, setWallet] = useState<ClientPackage[]>([]);
  const [catalog, setCatalog] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saleOpen, setSaleOpen] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer" | "">("");
  const [taxRate, setTaxRate] = useState(0);
  const [receipt, setReceipt] = useState<{ result: PackagePurchaseResult; pkg: Package; expiresAt?: any; paymentMethod: string; taxAmount: number } | null>(null);
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [redeemResult, setRedeemResult] = useState<PackageRedemptionResult | null>(null);

  const refresh = useCallback(async () => {
    if (!clientId) { setWallet([]); return; }
    setLoading(true); setError("");
    try { setWallet(await ClientPackageService.getByClient(clientId)); }
    catch { setError("تعذر تحميل باقات العميلة."); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    Promise.all([
      PackageService.getActive(),
      getDoc(doc(db, "salons", "main", "settings", "finance")),
    ]).then(([rows, finance]) => {
      setCatalog(rows);
      const raw = finance.data() || {};
      setTaxRate(Math.max(0, Math.min(100, Number(raw.taxRate ?? raw.vatRate ?? 0) || 0)));
    }).catch(() => setCatalog([]));
  }, []);

  const now = Date.now();
  const active = wallet.filter((p) => p.status === "active" && p.remainingSessions > 0 && (!millis(p.expiresAt) || millis(p.expiresAt) >= now));
  const eligible = useMemo(() => {
    const serviceId = String(props.bookingItem?.serviceId || "").trim();
    if (!serviceId) return [];
    return active.filter((p) => p.allowedServiceIdsSnapshot.includes(serviceId))
      .sort((a, b) => (millis(a.expiresAt) || Number.MAX_SAFE_INTEGER) - (millis(b.expiresAt) || Number.MAX_SAFE_INTEGER));
  }, [wallet, props.bookingItem?.serviceId]);

  useEffect(() => {
    if (!eligible.length) { setSelectedWalletId(""); return; }
    if (!eligible.some((p) => p.id === selectedWalletId)) setSelectedWalletId(String(eligible[0].id || ""));
  }, [eligible, selectedWalletId]);

  const selectedCatalog = catalog.find((p) => p.id === selectedCatalogId);
  const selectedWallet = eligible.find((p) => p.id === selectedWalletId);
  const totalRemaining = active.reduce((sum, p) => sum + p.remainingSessions, 0);
  const totalReserved = active.reduce((sum, p) => sum + p.reservedSessions, 0);
  const nearestExpiry = active.map((p) => millis(p.expiresAt)).filter(Boolean).sort((a,b) => a-b)[0];
  const taxAmount = selectedCatalog && taxRate > 0
    ? Math.round((selectedCatalog.price - selectedCatalog.price / (1 + taxRate / 100)) * 100) / 100 : 0;

  async function purchase() {
    if (!clientId || !selectedCatalog?.id || !paymentMethod) return;
    setLoading(true); setError("");
    try {
      const result = await PackageOperationsService.purchase({ clientId, packageCatalogId: selectedCatalog.id, paymentMethod });
      await refresh();
      const purchased = (await ClientPackageService.getByClient(clientId)).find((p) => p.id === result.clientPackageId);
      setReceipt({ result, pkg: selectedCatalog, expiresAt: purchased?.expiresAt, paymentMethod, taxAmount });
      setSelectedCatalogId(""); setPaymentMethod(""); setSaleOpen(false);
    } catch (e: any) { setError(String(e?.message || "تعذر بيع الباقة.")); }
    finally { setLoading(false); }
  }

  async function createClientProfile() {
    if (!clientName || !clientPhone) return setError("أدخلي اسم العميلة ورقم الجوال أولًا.");
    const id = globalThis.crypto?.randomUUID?.() || `client_${Date.now()}`;
    setLoading(true); setError("");
    try {
      await setDoc(doc(db, "salons", "main", "clients", id), {
        clientId: id, name: clientName, phone: clientPhone, source: "booking_internal",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      props.onClientCreated?.({ ...props.client, id, clientId: id, name: clientName, phone: clientPhone });
    } catch { setError("تعذر إنشاء ملف العميلة."); }
    finally { setLoading(false); }
  }

  async function redeem() {
    const item = props.bookingItem;
    if (!clientId) return setError("تعذر تحديد العميلة. اختاري ملف عميلة حقيقيًا.");
    if (!selectedWallet?.id) return setError("لا يوجد رصيد باقة صالح لهذه الخدمة.");
    if (!item?.serviceId || !item.employeeId || !item.date || !item.time) return setError("أكملي اختيار الخدمة والموظفة والتاريخ والوقت أولًا.");
    setLoading(true); setError("");
    try {
      const result = await PackageOperationsService.redeem({
        clientId, clientPackageId: selectedWallet.id, serviceId: item.serviceId,
        employeeId: item.employeeId, date: item.date, time: item.time,
      });
      setRedeemResult(result); await refresh(); props.onRedeemed?.(result);
    } catch (e: any) { setError(String(e?.message || "تعذر حجز الجلسة.")); }
    finally { setLoading(false); }
  }

  if (!props.client) return null;
  return <section className="session-packages" aria-label="باقات العميلة">
    <div className="session-packages__card">
      <div className="session-packages__head"><div><strong>{clientName || "العميلة"}</strong><span className="session-packages__muted">{clientPhone || "لا يوجد جوال"}</span></div><button type="button" className="session-packages__button secondary" onClick={() => setSaleOpen((v) => !v)} disabled={!clientId}>بيع باقة جديدة</button></div>
      {!clientId ? <div className="session-packages__error">تعذر تحديد clientId ثابت. <button type="button" onClick={() => void createClientProfile()} disabled={loading}>إنشاء ملف عميلة جديد من الاسم والجوال</button></div> : <div className="session-packages__stats">
        <div className="session-packages__stat"><small>الباقات الفعالة</small><strong>{active.length}</strong></div>
        <div className="session-packages__stat"><small>الجلسات المتبقية</small><strong>{totalRemaining}</strong></div>
        <div className="session-packages__stat"><small>الجلسات المحجوزة</small><strong>{totalReserved}</strong></div>
        <div className="session-packages__stat"><small>أقرب انتهاء</small><strong>{nearestExpiry ? packageDate(nearestExpiry) : "—"}</strong></div>
      </div>}
      {!loading && clientId && !active.length ? <p className="session-packages__muted">لا توجد باقات فعالة لهذه العميلة.</p> : null}
    </div>

    {saleOpen ? <div className="session-packages__card">
      <h3>بيع باقة جلسات</h3><div className="session-packages__choices">{catalog.map((p) => <button type="button" key={p.id} className={`session-packages__choice ${selectedCatalogId === p.id ? "is-selected" : ""}`} onClick={() => setSelectedCatalogId(String(p.id))}><strong>{p.name}</strong><span className="session-packages__muted">{p.sessionsCount} جلسة · {p.price} ر.س · {p.serviceIds.length} خدمات · {p.validityDays ? `${p.validityDays} يومًا` : "بدون انتهاء"}</span>{p.description ? <span className="session-packages__muted">{p.description}</span> : null}</button>)}</div>
      {selectedCatalog ? <div className="session-packages__grid"><div className="session-packages__stat"><small>السعر قبل الضريبة</small><strong>{(selectedCatalog.price - taxAmount).toFixed(2)} ر.س</strong></div><div className="session-packages__stat"><small>الضريبة ({taxRate}%)</small><strong>{taxAmount.toFixed(2)} ر.س</strong></div><div className="session-packages__stat"><small>الإجمالي</small><strong>{selectedCatalog.price.toFixed(2)} ر.س</strong></div><label className="session-packages__field">طريقة الدفع<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)}><option value="">اختاري</option><option value="cash">كاش</option><option value="card">شبكة</option><option value="transfer">تحويل</option></select></label></div> : null}
      <div className="session-packages__actions"><button type="button" className="session-packages__button" disabled={loading || !selectedCatalog || !paymentMethod} onClick={() => void purchase()}>{loading ? "جاري التنفيذ..." : "تأكيد بيع الباقة"}</button></div>
    </div> : null}

    {props.bookingItem?.serviceId ? <div className="session-packages__card">
      <h3>الدفع من رصيد الباقة</h3>
      {eligible.length ? <><p className="session-packages__muted">تم اختيار الباقة الأقرب انتهاءً تلقائيًا، ويمكن تغييرها.</p><div className="session-packages__choices">{eligible.map((p) => <button type="button" key={p.id} className={`session-packages__choice ${selectedWalletId === p.id ? "is-selected" : ""}`} onClick={() => setSelectedWalletId(String(p.id))}><strong>{p.packageNameSnapshot}</strong><span className="session-packages__muted">المتبقي الآن: {p.remainingSessions} · بعد الحجز: {p.remainingSessions - 1} · المحجوز: {p.reservedSessions} · تنتهي: {packageDate(p.expiresAt)}</span></button>)}</div>
      {selectedWallet ? <div className="session-packages__grid"><div className="session-packages__stat"><small>الخدمة</small><strong>{props.bookingItem.serviceName}</strong></div><div className="session-packages__stat"><small>الموظفة</small><strong>{props.bookingItem.employeeName || "لم تحدد"}</strong></div><div className="session-packages__stat"><small>الموعد</small><strong>{props.bookingItem.date || "—"} {props.bookingItem.time || ""}</strong></div><div className="session-packages__stat"><small>القيمة المستحقة</small><strong>صفر · رصيد باقة</strong></div></div> : null}
      <div className="session-packages__actions"><button type="button" className="session-packages__button" disabled={loading || !props.bookingItem.employeeId || !props.bookingItem.date || !props.bookingItem.time} onClick={() => void redeem()}>تأكيد الحجز من الرصيد</button></div></> : <p className="session-packages__muted">لا يوجد رصيد باقة صالح لهذه الخدمة.</p>}
    </div> : null}

    {error ? <div className="session-packages__error">{error}</div> : null}
    {receipt ? <div className="session-packages__success">تم بيع {receipt.pkg.name}. الرصيد الجديد: {receipt.pkg.sessionsCount} جلسة. رقم الفاتورة: {receipt.result.invoiceNumber}. <button type="button" onClick={() => printPackageDocument(`فاتورة ${receipt.result.invoiceNumber}`, `<b>العميلة:</b> ${clientName}<br><b>الباقة:</b> ${receipt.pkg.name}<br><b>عدد الجلسات:</b> ${receipt.pkg.sessionsCount}<br><b>السعر:</b> ${(receipt.pkg.price-receipt.taxAmount).toFixed(2)} ر.س<br><b>الضريبة:</b> ${receipt.taxAmount.toFixed(2)} ر.س<br><b>الإجمالي:</b> ${receipt.pkg.price.toFixed(2)} ر.س<br><b>طريقة الدفع:</b> ${receipt.paymentMethod}<br><b>تاريخ الانتهاء:</b> ${packageDate(receipt.expiresAt)}`)}>طباعة الفاتورة</button></div> : null}
    {redeemResult ? <div className="session-packages__success">تم إنشاء الحجز {redeemResult.publicId} وتسويته من رصيد الباقة. <button type="button" onClick={() => printPackageDocument(`إيصال ${redeemResult.publicId}`, `<b>العميلة:</b> ${clientName}<br><b>الخدمة:</b> ${props.bookingItem?.serviceName}<br><b>الموظفة:</b> ${props.bookingItem?.employeeName}<br><b>الموعد:</b> ${props.bookingItem?.date} ${props.bookingItem?.time}<br><b>الباقة:</b> ${selectedWallet?.packageNameSnapshot || "باقة جلسات"}<br><b>الرصيد قبل:</b> ${selectedWallet ? selectedWallet.remainingSessions + 1 : "—"}<br><b>الرصيد بعد:</b> ${selectedWallet?.remainingSessions ?? "—"}<br><b>القيمة المدفوعة:</b> صفر<br>تمت التسوية من رصيد الباقة`)}>طباعة الإيصال الصفري</button></div> : null}
  </section>;
}
