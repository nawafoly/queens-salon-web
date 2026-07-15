import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query as firestoreQuery,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../../services/firebase";
import { PackageService, type Package } from "../../services/PackageService";
import type { ClientPackage } from "../../services/ClientPackageService";
import {
  PackageOperationsService,
  type PackageClientWalletResult,
  type PackagePurchaseResult,
  type PackageRedemptionResult,
} from "../../services/PackageOperationsService";
import {
  buildPackageCartEligibility,
  type PackageCartEligibility,
} from "../../helpers/packageCartEligibility";
import { packageWalletDisplayState } from "../../helpers/packageWalletDiagnostics";
import { packageDate } from "./packageFormat";
import "../../styles/SessionPackages.css";

type BookingItem = {
  id?: string;
  serviceId?: string;
  serviceName?: string;
  employeeId?: string;
  employeeName?: string;
  date?: string;
  time?: string;
  locked?: boolean;
  basePrice?: number;
  serviceBasePrice?: number;
  finalPrice?: number;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function millis(value: any) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return Number(value || 0);
}

function stableClientId(client: any) {
  const canonical = cleanText(client?.canonicalClientId);
  if (canonical) return canonical;
  const explicit = cleanText(client?.clientId);
  if (explicit) return explicit;
  const id = cleanText(client?.id);
  const source = cleanText(client?.source);
  if (
    id &&
    (source === "client_profile" ||
      source === "booking_internal" ||
      source === "user_profile" ||
      source === "root_user")
  ) {
    return id;
  }
  return "";
}

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ر.س`;
}

function normalizePhone(value: unknown) {
  const raw = cleanText(value);
  if (!raw || /[A-Za-z]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return "";
}

function phoneLookupValues(value: unknown) {
  const normalized = normalizePhone(value);
  if (!normalized) return [];
  const values = new Set([normalized]);
  if (/^05\d{8}$/.test(normalized)) {
    values.add(`966${normalized.slice(1)}`);
    values.add(`+966${normalized.slice(1)}`);
  }
  return [...values];
}

function clientLookupPayload(client: any, fallbackPhone: string) {
  const id = cleanText(client?.id);
  const uid = cleanText(client?.uid || client?.authUid || client?.firebaseUid);
  const clientId = cleanText(client?.clientId || client?.canonicalClientId);
  const customerId = cleanText(client?.customerId);
  const authUid = cleanText(client?.authUid || client?.uid || client?.firebaseUid);
  const phone = normalizePhone(
    client?.phone ?? client?.mobile ?? client?.clientPhone ?? client?.phoneNumber ?? fallbackPhone
  );
  return {
    ...(id ? { id, docId: id } : {}),
    ...(uid ? { uid, userId: uid, firebaseUid: uid } : {}),
    ...(clientId ? { clientId } : {}),
    ...(customerId ? { customerId } : {}),
    ...(authUid ? { authUid } : {}),
    ...(phone ? { phone, mobile: phone, clientPhone: phone, phoneNumber: phone } : {}),
  };
}

function itemPrice(item: BookingItem) {
  return Math.max(0, Number(item.finalPrice ?? item.basePrice ?? item.serviceBasePrice ?? 0) || 0);
}

export default function AdminPackageFlow(props: {
  client: any;
  bookingItem?: BookingItem | null;
  bookingItems?: BookingItem[] | null;
  onRedeemed?: (result: PackageRedemptionResult) => void;
  onClientCreated?: (client: any) => void;
}) {
  const clientId = stableClientId(props.client);
  const clientName = cleanText(props.client?.name || props.client?.fullName || props.client?.clientName);
  const clientPhone = cleanText(props.client?.phone || props.client?.mobile || props.client?.clientPhone);
  const isDev = Boolean((import.meta as any).env?.DEV);
  const buildId = cleanText(
    (import.meta as any).env?.VITE_BUILD_ID ||
      (import.meta as any).env?.VITE_VERCEL_GIT_COMMIT_SHA ||
      (import.meta as any).env?.VITE_COMMIT_SHA ||
      "dev"
  );

  const [wallet, setWallet] = useState<ClientPackage[]>([]);
  const [walletSummary, setWalletSummary] = useState<PackageClientWalletResult | null>(null);
  const [walletStatus, setWalletStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [walletCanonicalClientId, setWalletCanonicalClientId] = useState("");
  const [lastWalletRequestAt, setLastWalletRequestAt] = useState("");
  const [selectedPackageByItemId, setSelectedPackageByItemId] = useState<Record<string, string>>({});
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [catalog, setCatalog] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saleOpen, setSaleOpen] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer" | "">("");
  const [taxRate, setTaxRate] = useState(0);
  const [receipt, setReceipt] = useState<{
    result: PackagePurchaseResult;
    pkg: Package;
    expiresAt?: any;
    paymentMethod: string;
    taxAmount: number;
  } | null>(null);
  const [redeemResult, setRedeemResult] = useState<PackageRedemptionResult | null>(null);
  const onClientCreatedRef = useRef(props.onClientCreated);

  useEffect(() => {
    onClientCreatedRef.current = props.onClientCreated;
  }, [props.onClientCreated]);

  const bookingItems = useMemo(() => {
    const rows = props.bookingItems?.length ? props.bookingItems : props.bookingItem ? [props.bookingItem] : [];
    return rows
      .filter((item) => cleanText(item?.serviceId))
      .map((item, index) => ({
        ...item,
        id: cleanText(item.id) || `draft_${index}_${cleanText(item.serviceId) || "service"}`,
      }));
  }, [props.bookingItems, props.bookingItem]);

  const refresh = useCallback(async (): Promise<PackageClientWalletResult | null> => {
    if (!clientId) {
      setWallet([]);
      setWalletSummary(null);
      setWalletStatus("idle");
      setWalletCanonicalClientId("");
      setSelectedPackageByItemId({});
      return null;
    }

    setLoading(true);
    setError("");
    setWallet([]);
    setWalletSummary(null);
    setWalletStatus("loading");
    setWalletCanonicalClientId("");
    setSelectedPackageByItemId({});
    setRedeemResult(null);
    const requestedAt = new Date().toISOString();
    setLastWalletRequestAt(requestedAt);
    try {
      const summary = await PackageOperationsService.clientWallet({
        clientId,
        clientLookup: clientLookupPayload(props.client, clientPhone),
      });
      const canonicalClientId = cleanText(summary.canonicalClientId || summary.clientId);
      setWalletCanonicalClientId(canonicalClientId);
      setWalletStatus("success");
      if (isDev) {
        console.info("[packages:client-wallet]", {
          origin: window.location.origin,
          buildId,
          selectedClientLocalId: clientId,
          canonicalClientId,
          walletRequestStatus: "success",
          walletResponseWarnings: summary.warnings || [],
          lastRequestAt: requestedAt,
        });
      }
      if (canonicalClientId && canonicalClientId !== clientId) {
        onClientCreatedRef.current?.({
          ...props.client,
          clientId: canonicalClientId,
          canonicalClientId,
          legacyClientDocId: clientId,
          name: clientName,
          fullName: clientName,
          phone: clientPhone,
          mobile: clientPhone,
        });
      }
      setWallet((summary.packages || []) as ClientPackage[]);
      setWalletSummary(summary);
      if (summary.warnings?.length) {
        setError(
          `تم تحميل الرصيد مع تحذيرات: ${summary.warnings
            .map((warning) => warning.reason || warning.packageId)
            .filter(Boolean)
            .join("، ")}`
        );
      }
      return summary;
    } catch (e: any) {
      setWallet([]);
      setWalletSummary(null);
      setWalletStatus("error");
      const message = cleanText(e?.message);
      if (isDev) {
        console.warn("[packages:client-wallet]", {
          origin: window.location.origin,
          buildId,
          selectedClientLocalId: clientId,
          canonicalClientId: "",
          walletRequestStatus: "error",
          walletResponseWarnings: [],
          errorCode: cleanText(e?.code),
          errorStatus: Number(e?.status || 0) || undefined,
          errorMessage: message,
          lastRequestAt: requestedAt,
        });
      }
      setError(message ? `تعذر تحميل رصيد الباقات: ${message}` : "تعذر تحميل رصيد الباقات");
      return null;
    } finally {
      setLoading(false);
    }
  }, [clientId, props.client, clientPhone, clientName, isDev, buildId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    Promise.all([
      PackageService.getActive(),
      getDoc(doc(db, "salons", "main", "settings", "finance")),
    ])
      .then(([rows, finance]) => {
        setCatalog(rows);
        const raw = finance.data() || {};
        setTaxRate(Math.max(0, Math.min(100, Number(raw.taxRate ?? raw.vatRate ?? 0) || 0)));
      })
      .catch(() => setCatalog([]));
  }, []);

  const active = useMemo(() => {
    const now = Date.now();
    return wallet.filter((pkg) => {
      const allowed = Array.isArray((pkg as any).allowedServiceIdsSnapshot)
        ? (pkg as any).allowedServiceIdsSnapshot
        : [];
      return (
        pkg.status === "active" &&
        Number(pkg.remainingSessions || 0) > 0 &&
        allowed.length > 0 &&
        (!millis(pkg.expiresAt) || millis(pkg.expiresAt) >= now)
      );
    });
  }, [wallet]);

  const cartEligibility = useMemo(
    () =>
      buildPackageCartEligibility({
        items: bookingItems.map((item) => ({ id: item.id, serviceId: item.serviceId })),
        packages: active,
        selectedPackageByItemId,
      }),
    [active, bookingItems, selectedPackageByItemId]
  );

  const eligibilityByItemId = useMemo(() => {
    const map = new Map<string, PackageCartEligibility>();
    cartEligibility.forEach((entry) => map.set(entry.cartItemId, entry));
    return map;
  }, [cartEligibility]);

  const redeemableItems = cartEligibility.filter((item) => item.isPackageEligible);
  const selectedCatalog = catalog.find((pkg) => pkg.id === selectedCatalogId);
  const totalRemaining = Number(
    walletSummary?.totalRemainingSessions ?? active.reduce((sum, pkg) => sum + Number(pkg.remainingSessions || 0), 0)
  );
  const totalReserved = Number(
    walletSummary?.totalReservedSessions ?? active.reduce((sum, pkg) => sum + Number(pkg.reservedSessions || 0), 0)
  );
  const totalUsed = Number(
    walletSummary?.totalUsedSessions ?? active.reduce((sum, pkg) => sum + Number(pkg.usedSessions || 0), 0)
  );
  const activePackageCount = Number(
    walletSummary?.activePackageCount ??
      (Array.isArray(walletSummary?.activePackages) ? walletSummary.activePackages.length : active.length)
  );
  const nearestExpiry = walletSummary?.nearestExpiryAt
    ? millis(walletSummary.nearestExpiryAt)
    : active.map((pkg) => millis(pkg.expiresAt)).filter(Boolean).sort((a, b) => a - b)[0];
  const taxAmount =
    selectedCatalog && taxRate > 0
      ? Math.round((selectedCatalog.price - selectedCatalog.price / (1 + taxRate / 100)) * 100) / 100
      : 0;
  const walletLoadFailed = walletStatus === "error";
  const walletLoading = walletStatus === "loading";
  const walletDisplayState = packageWalletDisplayState({
    status: walletStatus,
    activePackages: activePackageCount,
    totalRemainingSessions: totalRemaining,
  });
  const coveredCartTotal = bookingItems.reduce((sum, item) => {
    const entry = eligibilityByItemId.get(cleanText(item.id));
    return entry?.canRedeem ? sum + itemPrice(item) : sum;
  }, 0);
  const cartTotal = bookingItems.reduce((sum, item) => sum + itemPrice(item), 0);
  const remainingCartTotal = Math.max(0, cartTotal - coveredCartTotal);
  const diagnostics = {
    origin: typeof window !== "undefined" ? window.location.origin : "",
    buildId,
    selectedClientLocalId: clientId,
    canonicalClientId: walletCanonicalClientId || cleanText(walletSummary?.canonicalClientId),
    walletStatus,
    activePackages: activePackageCount,
    lastRequestAt: lastWalletRequestAt,
  };
  const hasAnyClientData = Boolean(props.client || clientName || clientPhone);

  async function purchase() {
    if (!clientId || !selectedCatalog?.id || !paymentMethod) return;
    setLoading(true);
    setError("");
    try {
      const result = await PackageOperationsService.purchase({
        clientId,
        clientLookup: clientLookupPayload(props.client, clientPhone),
        packageCatalogId: selectedCatalog.id,
        paymentMethod,
      });
      const canonicalClientId = cleanText(result.clientId) || clientId;
      if (canonicalClientId !== clientId) {
        onClientCreatedRef.current?.({
          ...props.client,
          clientId: canonicalClientId,
          canonicalClientId,
          legacyClientDocId: clientId,
          name: clientName,
          fullName: clientName,
          phone: clientPhone,
          mobile: clientPhone,
        });
      }
      const refreshed = await refresh();
      const purchased = ((refreshed?.packages || []) as ClientPackage[]).find(
        (pkg) => pkg.id === result.clientPackageId
      );
      setReceipt({
        result,
        pkg: selectedCatalog,
        expiresAt: purchased?.expiresAt,
        paymentMethod,
        taxAmount,
      });
      setSelectedCatalogId("");
      setPaymentMethod("");
      setSaleOpen(false);
    } catch (e: any) {
      setError(cleanText(e?.message) || "تعذر بيع الباقة.");
    } finally {
      setLoading(false);
    }
  }

  async function createClientProfile() {
    if (!clientName || !clientPhone) {
      setError("أدخلي اسم العميلة ورقم الجوال أولًا.");
      return;
    }
    const normalizedPhone = normalizePhone(clientPhone);
    if (!normalizedPhone) {
      setError("رقم الجوال غير صالح.");
      return;
    }

    const id = globalThis.crypto?.randomUUID?.() || `client_${Date.now()}`;
    setLoading(true);
    setError("");
    try {
      const phoneMatches = new Map<string, { id: string; data: any }>();
      const values = phoneLookupValues(clientPhone);
      for (const field of ["phone", "mobile", "clientPhone", "phoneNumber"]) {
        for (const value of values) {
          const snap = await getDocs(
            firestoreQuery(collection(db, "salons", "main", "clients"), where(field, "==", value), limit(3))
          );
          snap.docs.forEach((row) => phoneMatches.set(row.ref.path, { id: row.id, data: row.data() || {} }));
        }
      }
      if (phoneMatches.size > 1) {
        setError("يوجد أكثر من ملف عميلة بنفس رقم الجوال. افتحي تقرير تدقيق الهويات أولًا.");
        return;
      }
      if (phoneMatches.size === 1) {
        const existing = [...phoneMatches.values()][0];
        const existingClientId = cleanText(existing.data.clientId || existing.id);
        props.onClientCreated?.({
          ...props.client,
          id: existing.id,
          clientId: existingClientId,
          canonicalClientId: existingClientId,
          name: cleanText(existing.data.name || existing.data.fullName || clientName),
          fullName: cleanText(existing.data.fullName || existing.data.name || clientName),
          phone: cleanText(existing.data.phone || existing.data.mobile || normalizedPhone),
          mobile: cleanText(existing.data.mobile || existing.data.phone || normalizedPhone),
          source: "client_profile",
        });
        await refresh();
        return;
      }

      await setDoc(doc(db, "salons", "main", "clients", id), {
        clientId: id,
        name: clientName,
        phone: normalizedPhone,
        mobile: normalizedPhone,
        source: "booking_internal",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      props.onClientCreated?.({
        ...props.client,
        id,
        clientId: id,
        canonicalClientId: id,
        name: clientName,
        fullName: clientName,
        phone: normalizedPhone,
        mobile: normalizedPhone,
        source: "client_profile",
      });
    } catch {
      setError("تعذر إنشاء ملف العميلة.");
    } finally {
      setLoading(false);
    }
  }

  async function redeem(target: PackageCartEligibility) {
    const item = bookingItems.find((entry) => cleanText(entry.id) === cleanText(target.cartItemId));
    const clientIdForRedeem = cleanText(walletCanonicalClientId || walletSummary?.canonicalClientId || walletSummary?.clientId || clientId);
    const selectedPackageId = cleanText(target.eligiblePackageId);
    if (!clientIdForRedeem) {
      setError("تعذر تحديد canonicalClientId للعميلة.");
      return;
    }
    if (!selectedPackageId || !target.canRedeem) {
      setError("لا يوجد رصيد باقة صالح لهذه الخدمة.");
      return;
    }
    if (!item?.serviceId || !item.employeeId || !item.date || !item.time) {
      setError("أكملي اختيار الخدمة والموظفة والتاريخ والوقت أولًا.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await PackageOperationsService.redeem({
        clientId: clientIdForRedeem,
        clientLookup: clientLookupPayload(props.client, clientPhone),
        clientPackageId: selectedPackageId,
        serviceId: item.serviceId,
        employeeId: item.employeeId,
        date: item.date,
        time: item.time,
        cartItemId: target.cartItemId,
      });
      setRedeemResult(result);
      await refresh();
      props.onRedeemed?.(result);
    } catch (e: any) {
      setError(cleanText(e?.message) || "تعذر حجز الجلسة من رصيد الباقة.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="session-packages" aria-label="ملخص العميلة والباقات">
      <div className="session-packages__card session-packages__card--hero">
        <div className="session-packages__head">
          <div>
            <span className="session-packages__eyebrow">ملخص العميلة والباقات</span>
            <strong>{clientName || "اختاري العميلة أولًا"}</strong>
            <span className="session-packages__muted">{clientPhone || "لا يوجد رقم جوال محدد"}</span>
          </div>
          {hasAnyClientData ? (
            <button
              type="button"
              className="session-packages__button secondary"
              onClick={() => setSaleOpen((value) => !value)}
              disabled={!clientId}
            >
              بيع باقة جلسات
            </button>
          ) : null}
        </div>

        {isDev ? (
          <div className="session-packages__actions">
            <button
              type="button"
              className="session-packages__button secondary"
              onClick={() => setDiagnosticsOpen((value) => !value)}
            >
              تشخيص الباقات
            </button>
            {diagnosticsOpen ? (
              <pre className="session-packages__muted mb-0">{JSON.stringify(diagnostics, null, 2)}</pre>
            ) : null}
          </div>
        ) : null}

        {!hasAnyClientData ? (
          <p className="session-packages__muted mb-0">
            سيظهر ملخص الرصيد بعد اختيار العميلة أو إدخال اسمها ورقمها.
          </p>
        ) : !clientId ? (
          <div className="session-packages__error">
            لا يوجد clientId ثابت لهذه العميلة حتى الآن.
            <button type="button" onClick={() => void createClientProfile()} disabled={loading}>
              إنشاء ملف عميلة جديد
            </button>
          </div>
        ) : walletLoadFailed ? (
          <div className="session-packages__error">تعذر تحميل رصيد الباقات</div>
        ) : (
          <div className="session-packages__stats">
            <div className="session-packages__stat">
              <small>الباقات الفعالة</small>
              <strong>{walletDisplayState.activePackages ?? activePackageCount}</strong>
            </div>
            <div className="session-packages__stat">
              <small>الجلسات المتبقية</small>
              <strong>{walletDisplayState.totalRemainingSessions ?? totalRemaining}</strong>
            </div>
            <div className="session-packages__stat">
              <small>الجلسات المحجوزة</small>
              <strong>{totalReserved}</strong>
            </div>
            <div className="session-packages__stat">
              <small>الجلسات المستخدمة</small>
              <strong>{totalUsed}</strong>
            </div>
            <div className="session-packages__stat">
              <small>أقرب انتهاء</small>
              <strong>{nearestExpiry ? packageDate(nearestExpiry) : "-"}</strong>
            </div>
          </div>
        )}

        {!loading && clientId && !active.length && !walletLoading && !walletLoadFailed ? (
          <div className="session-packages__empty">
            <span>لا توجد باقات فعالة لهذه العميلة</span>
            <button type="button" onClick={() => setSaleOpen(true)}>
              بيع باقة جديدة
            </button>
          </div>
        ) : null}
      </div>

      {saleOpen ? (
        <div className="session-packages__card">
          <h3>بيع باقة جلسات</h3>
          {catalog.length ? (
            <div className="session-packages__choices">
              {catalog.map((pkg) => (
                <button
                  type="button"
                  key={pkg.id}
                  className={`session-packages__choice ${selectedCatalogId === pkg.id ? "is-selected" : ""}`}
                  onClick={() => setSelectedCatalogId(cleanText(pkg.id))}
                >
                  <strong>{pkg.name}</strong>
                  <span className="session-packages__muted">
                    {pkg.sessionsCount} جلسة · {money(pkg.price)} · {pkg.serviceIds.length} خدمات ·{" "}
                    {pkg.validityDays ? `${pkg.validityDays} يوم` : "بدون انتهاء"}
                  </span>
                  {pkg.description ? <span className="session-packages__muted">{pkg.description}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="session-packages__muted">لا توجد باقات جلسات مفعلة للبيع.</p>
          )}

          {selectedCatalog ? (
            <div className="session-packages__grid">
              <div className="session-packages__stat">
                <small>السعر قبل الضريبة</small>
                <strong>{money(selectedCatalog.price - taxAmount)}</strong>
              </div>
              <div className="session-packages__stat">
                <small>الضريبة ({taxRate}%)</small>
                <strong>{money(taxAmount)}</strong>
              </div>
              <div className="session-packages__stat">
                <small>الإجمالي</small>
                <strong>{money(selectedCatalog.price)}</strong>
              </div>
              <label className="session-packages__field">
                طريقة الدفع
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as any)}>
                  <option value="">اختاري</option>
                  <option value="cash">كاش</option>
                  <option value="card">شبكة</option>
                  <option value="transfer">تحويل</option>
                </select>
              </label>
            </div>
          ) : null}

          <div className="session-packages__actions">
            <button
              type="button"
              className="session-packages__button"
              disabled={loading || !selectedCatalog || !paymentMethod || !clientId}
              onClick={() => void purchase()}
            >
              {loading ? "جاري التنفيذ..." : "تأكيد بيع الباقة"}
            </button>
          </div>
        </div>
      ) : null}

      {bookingItems.length ? (
        <div className="session-packages__card">
          <h3>الدفع من رصيد الباقة</h3>
          {walletLoading ? (
            <p className="session-packages__muted mb-0">جاري تحميل رصيد الباقات...</p>
          ) : walletLoadFailed ? (
            <div className="session-packages__error">تعذر تحميل رصيد الباقات</div>
          ) : redeemableItems.length ? (
            <>
              <div className="session-packages__grid">
                <div className="session-packages__stat">
                  <small>مغطى بالجلسات</small>
                  <strong>{money(coveredCartTotal)}</strong>
                </div>
                <div className="session-packages__stat">
                  <small>متبقي للدفع العادي</small>
                  <strong>{money(remainingCartTotal)}</strong>
                </div>
              </div>
              <div className="session-packages__choices">
                {redeemableItems.map((entry) => {
                  const item = bookingItems.find((row) => cleanText(row.id) === cleanText(entry.cartItemId));
                  const selectedPackage = active.find((pkg) => cleanText(pkg.id) === cleanText(entry.eligiblePackageId));
                  const missingSlot = !item?.employeeId || !item.date || !item.time;
                  return (
                    <div className="session-packages__choice" key={entry.cartItemId}>
                      <strong>{item?.serviceName || entry.serviceId}</strong>
                      <span className="session-packages__muted">
                        الباقة: {selectedPackage?.packageNameSnapshot || "-"} · المتبقي: {entry.remainingSessions}
                        {" · "}بعد الخصم: {Math.max(0, entry.remainingSessions - 1)}
                      </span>
                      {entry.eligiblePackages.length > 1 ? (
                        <div className="session-packages__choices">
                          {entry.eligiblePackages.map((pkg) => {
                            const packageId = cleanText(pkg.id);
                            return (
                              <button
                                type="button"
                                key={packageId}
                                className={`session-packages__choice ${entry.eligiblePackageId === packageId ? "is-selected" : ""}`}
                                onClick={() =>
                                  setSelectedPackageByItemId((prev) => ({
                                    ...prev,
                                    [entry.cartItemId]: packageId,
                                  }))
                                }
                              >
                                <strong>{pkg.packageNameSnapshot}</strong>
                                <span className="session-packages__muted">
                                  {pkg.remainingSessions} جلسة · {packageDate(pkg.expiresAt)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <div className="session-packages__grid">
                        <div className="session-packages__stat">
                          <small>الموظفة</small>
                          <strong>{item?.employeeName || "لم تحدد"}</strong>
                        </div>
                        <div className="session-packages__stat">
                          <small>الموعد</small>
                          <strong>
                            {item?.date || "-"} {item?.time || ""}
                          </strong>
                        </div>
                        <div className="session-packages__stat">
                          <small>طريقة الدفع</small>
                          <strong>{entry.paymentMode}</strong>
                        </div>
                      </div>
                      <div className="session-packages__actions">
                        <button
                          type="button"
                          className="session-packages__button"
                          disabled={loading || missingSlot || !entry.canRedeem}
                          onClick={() => void redeem(entry)}
                        >
                          تأكيد الحجز من الرصيد
                        </button>
                        {missingSlot ? (
                          <span className="session-packages__muted">
                            اختاري الموظفة والوقت من السلة قبل تأكيد خصم الجلسة.
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="session-packages__empty">
              <span>لا يوجد رصيد باقة صالح لهذه الخدمة</span>
              <button type="button" onClick={() => setSaleOpen(true)}>
                بيع باقة جديدة
              </button>
            </div>
          )}
        </div>
      ) : null}

      {error ? <div className="session-packages__error">{error}</div> : null}

      {receipt ? (
        <div className="session-packages__success">
          تم بيع {receipt.pkg.name}. الرصيد الجديد: {receipt.pkg.sessionsCount} جلسة. رقم الفاتورة:{" "}
          {receipt.result.invoiceNumber}. تاريخ الانتهاء: {packageDate(receipt.expiresAt)}
        </div>
      ) : null}

      {redeemResult ? (
        <div className="session-packages__success">
          تم إنشاء الحجز {redeemResult.publicId} وتسويته من رصيد الباقة. الرصيد:{" "}
          {redeemResult.beforeRemaining ?? "-"} → {redeemResult.afterRemaining ?? "-"}
        </div>
      ) : null}
    </section>
  );
}
