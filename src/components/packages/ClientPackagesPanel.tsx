import { useCallback, useEffect, useState } from "react";
import {
  ClientPackageService,
  type ClientPackage,
  type ClientPackageTransaction,
} from "../../services/ClientPackageService";
import { CoreBookingService } from "../../services/CoreBookingService";
import { CoreInvoiceService } from "../../services/CoreInvoiceService";
import { PackageOperationsService } from "../../services/PackageOperationsService";
import { packageDate, printPackageDocument } from "./packageFormat";
import { clientsText, type DashboardLanguage } from "../../helpers/dashboardClientsLanguage";
import "../../styles/SessionPackages.css";

const labels: Record<string, string> = {
  purchase: "شراء",
  reserve: "حجز",
  consume: "استخدام",
  restore: "إلغاء واسترجاع",
  cancel: "إلغاء باقة",
  admin_adjustment: "تعديل إداري",
  admin_restore: "استرجاع إداري",
};

type LinkedBooking = {
  id: string;
  publicId: string;
  serviceName: string;
  date: string;
  time: string;
  status: string;
  packageRedemptionState: string;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function halalasToMoney(value: unknown, language: DashboardLanguage): string {
  const amount = Number(value ?? 0);
  const formatted = new Intl.NumberFormat(language === "en" ? "en-US" : "ar-SA-u-nu-latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount / 100 : 0);
  return `${formatted} ${language === "en" ? "SAR" : "ر.س"}`;
}

export default function ClientPackagesPanel(props: {
  clientId?: string;
  canManage: boolean;
  language?: DashboardLanguage;
}) {
  const language = props.language ?? "ar";
  const t = (value: string) => clientsText(language, value);
  const clientId = text(props.clientId);
  const [packages, setPackages] = useState<ClientPackage[]>([]);
  const [transactions, setTransactions] = useState<
    Record<string, ClientPackageTransaction[]>
  >({});
  const [services, setServices] = useState<Record<string, string>>({});
  const [bookings, setBookings] = useState<Record<string, LinkedBooking[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!clientId) return;
    setBusy(true);
    setError("");
    try {
      const [wallet, coreBookings] = await Promise.all([
        ClientPackageService.getWalletByClient(clientId),
        CoreBookingService.list({ clientId }),
      ]);

      const rows = ClientPackageService.normalizePackages(wallet.packages ?? []);
      setPackages(rows);
      setServices(wallet.services ?? {});

      const txGroups: Record<string, ClientPackageTransaction[]> = {};
      for (const raw of wallet.transactions ?? []) {
        const packageId = text(raw.clientPackageId);
        if (!packageId) continue;
        const row: ClientPackageTransaction = {
          id: text(raw.id) || undefined,
          clientPackageId: packageId,
          clientId: text(
            (raw as Record<string, unknown>).canonicalClientId ??
              (raw as Record<string, unknown>).clientId ??
              wallet.canonicalClientId
          ),
          type: (text(raw.type) || "admin_adjustment") as ClientPackageTransaction["type"],
          bookingId: text(raw.bookingId) || undefined,
          invoiceId: text(
            (raw as Record<string, unknown>).invoiceId
          ) || undefined,
          serviceId: text(
            (raw as Record<string, unknown>).serviceId
          ) || undefined,
          sessionsDelta: Number(raw.sessionsDelta ?? 0),
          remainingBefore: Number(
            (raw as Record<string, unknown>).remainingBefore ?? 0
          ),
          remainingAfter: Number(
            (raw as Record<string, unknown>).remainingAfter ?? 0
          ),
          reservedBefore: Number(
            (raw as Record<string, unknown>).reservedBefore ?? 0
          ),
          reservedAfter: Number(
            (raw as Record<string, unknown>).reservedAfter ?? 0
          ),
          usedBefore: Number(
            (raw as Record<string, unknown>).usedBefore ?? 0
          ),
          usedAfter: Number(
            (raw as Record<string, unknown>).usedAfter ?? 0
          ),
          idempotencyKey:
            text((raw as Record<string, unknown>).idempotencyKey ?? raw.id) ||
            "core-d1",
          reason:
            text((raw as Record<string, unknown>).reason) || undefined,
          createdBy:
            text(
              (raw as Record<string, unknown>).createdByUid ??
                (raw as Record<string, unknown>).createdBy
            ) || "core-d1",
          createdAt: raw.createdAt ?? "",
        };
        (txGroups[packageId] ??= []).push(row);
      }
      setTransactions(txGroups);

      const bookingGroups: Record<string, LinkedBooking[]> = {};
      for (const booking of coreBookings) {
        for (const item of booking.items ?? []) {
          const packageId = text(item.clientPackageId);
          if (!packageId) continue;
          (bookingGroups[packageId] ??= []).push({
            id: booking.id,
            publicId: text(booking.publicId) || booking.id,
            serviceName: text(item.serviceNameSnapshot) || item.serviceId,
            date: text(item.bookingDate) || booking.bookingDate,
            time: text(item.startTime) || booking.startTime,
            status: booking.status,
            packageRedemptionState:
              booking.status === "completed"
                ? "consumed"
                : item.packageReservationId
                  ? "reserved"
                  : "",
          });
        }
      }
      setBookings(bookingGroups);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : t("تعذر تحميل الباقات والجلسات.");
      setError(message || t("تعذر تحميل الباقات والجلسات."));
    } finally {
      setBusy(false);
    }
  }, [clientId, language]);

  useEffect(() => {
    void load();
  }, [load]);

  async function adjust(pkg: ClientPackage) {
    const raw = window.prompt(
      t("عدد الجلسات المراد إضافتها أو خصمها (مثال: 1 أو -1)")
    );
    if (raw === null) return;
    const delta = Number(raw);
    const reason = window.prompt(t("سبب التعديل الإداري")) || "";
    if (!Number.isInteger(delta) || !delta || !reason.trim()) {
      setError(t("يلزم إدخال عدد صحيح وسبب واضح."));
      return;
    }
    setBusy(true);
    try {
      await PackageOperationsService.adjust(String(pkg.id), delta, reason);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("تعذر تعديل الرصيد."));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(pkg: ClientPackage) {
    const reason = window.prompt(t("سبب إلغاء الباقة"));
    if (!reason?.trim()) return;
    if (!window.confirm(language === "en" ? `${t("تأكيد إلغاء")} ${pkg.packageNameSnapshot}?` : `تأكيد إلغاء ${pkg.packageNameSnapshot}؟`)) return;
    setBusy(true);
    try {
      await PackageOperationsService.cancel(String(pkg.id), reason);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("تعذر إلغاء الباقة."));
    } finally {
      setBusy(false);
    }
  }

  async function restore(booking: LinkedBooking) {
    const reason = window.prompt(t("سبب استرجاع الجلسة المستخدمة"));
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await PackageOperationsService.restoreConsumed(booking.id, reason);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("تعذر استرجاع الجلسة.")
      );
    } finally {
      setBusy(false);
    }
  }

  async function invoice(pkg: ClientPackage) {
    const invoiceId = text(pkg.invoiceId || pkg.invoiceDocumentId);
    if (!invoiceId) {
      setError(t("لا يوجد مرجع فاتورة لهذه الباقة."));
      return;
    }
    try {
      const invoiceRow = await CoreInvoiceService.get(invoiceId);
      printPackageDocument(
        `${t("فاتورة")} ${invoiceRow.invoiceNumber || invoiceId}`,
        `<b>${t("الباقة")}:</b> ${pkg.packageNameSnapshot}<br>` +
          `<b>${t("الجلسات")}:</b> ${pkg.totalSessions}<br>` +
          `<b>${t("قبل الخصم")}:</b> ${halalasToMoney(invoiceRow.subtotalHalalas, language)}<br>` +
          `<b>${t("الخصم")}:</b> ${halalasToMoney(invoiceRow.discountHalalas, language)}<br>` +
          `<b>${t("الإجمالي")}:</b> ${halalasToMoney(invoiceRow.totalHalalas, language)}<br>` +
          `<b>${t("المدفوع")}:</b> ${halalasToMoney(invoiceRow.paidHalalas, language)}<br>` +
          `<b>${t("الحالة")}:</b> ${invoiceRow.status || "—"}<br>` +
          `<b>${t("تاريخ الانتهاء")}:</b> ${packageDate(pkg.expiresAt, language)}`,
        language
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("تعذر العثور على الفاتورة الأصلية في Core D1.")
      );
    }
  }

  if (!clientId) {
    return (
      <div className="session-packages__error">
        {t("لا يوجد clientId ثابت لهذا الملف؛ لا يمكن عرض الرصيد بالاعتماد على الهاتف فقط.")}
      </div>
    );
  }

  return (
    <section className="session-packages" aria-label={t("الباقات والجلسات")}>
      <div className="session-packages__head">
        <h3>{t("الباقات والجلسات")}</h3>
        <button
          type="button"
          className="session-packages__button secondary"
          onClick={() => void load()}
          disabled={busy}
        >
          {t("تحديث")}
        </button>
      </div>

      {error ? <div className="session-packages__error">{error}</div> : null}
      {!busy && !packages.length ? (
        <div className="session-packages__card">{t("لا توجد باقات مسجلة.")}</div>
      ) : null}

      {packages.map((pkg) => (
        <article key={pkg.id} className="session-packages__card">
          <div className="session-packages__head">
            <div>
              <strong>{pkg.packageNameSnapshot}</strong>
              <span className="session-packages__muted">
                {t("الحالة")}: {pkg.status}
              </span>
            </div>
            <span>{t("فاتورة")}: {pkg.invoiceNumber || pkg.invoiceId || "—"}</span>
          </div>

          <div className="session-packages__stats">
            <div className="session-packages__stat">
              <small>{t("الإجمالي")}</small>
              <strong>{pkg.totalSessions}</strong>
            </div>
            <div className="session-packages__stat">
              <small>{t("المتبقي")}</small>
              <strong>{pkg.remainingSessions}</strong>
            </div>
            <div className="session-packages__stat">
              <small>{t("المحجوز")}</small>
              <strong>{pkg.reservedSessions}</strong>
            </div>
            <div className="session-packages__stat">
              <small>{t("المستخدم")}</small>
              <strong>{pkg.usedSessions}</strong>
            </div>
          </div>

          <p className="session-packages__muted">
            {t("الشراء")}: {packageDate(pkg.purchasedAt, language)} · {t("الانتهاء")}:{" "}
            {packageDate(pkg.expiresAt, language)}
          </p>
          <p>
            {t("الخدمات")}:{" "}
            {pkg.allowedServiceIdsSnapshot
              .map((id) => services[id] || id)
              .join(language === "en" ? ", " : "، ")}
          </p>

          <details>
            <summary>
              {t("سجل الحركات")} ({transactions[String(pkg.id)]?.length || 0})
            </summary>
            {(transactions[String(pkg.id)] || []).map((transaction) => (
              <div key={transaction.id}>
                {t(labels[transaction.type] || transaction.type)}:{" "}
                {transaction.remainingBefore} {language === "en" ? "→" : "←"} {transaction.remainingAfter}{" "}
                {transaction.reason ? `· ${transaction.reason}` : ""}
              </div>
            ))}
          </details>

          <details>
            <summary>
              {t("الحجوزات المرتبطة")} ({bookings[String(pkg.id)]?.length || 0})
            </summary>
            {(bookings[String(pkg.id)] || []).map((booking) => (
              <div key={`${booking.id}_${booking.serviceName}`}>
                {booking.publicId} · {booking.serviceName} · {booking.date}{" "}
                {booking.time} · {booking.status}{" "}
                {props.canManage &&
                booking.packageRedemptionState === "consumed" ? (
                  <button
                    type="button"
                    onClick={() => void restore(booking)}
                  >
                    {t("استرجاع جلسة")}
                  </button>
                ) : null}
              </div>
            ))}
          </details>

          <div className="session-packages__actions">
            <button
              type="button"
              className="session-packages__button secondary"
              onClick={() => void invoice(pkg)}
            >
              {t("فتح الفاتورة الأصلية")}
            </button>
            {props.canManage ? (
              <>
                <button
                  type="button"
                  className="session-packages__button secondary"
                  onClick={() => void adjust(pkg)}
                  disabled={busy}
                >
                  {t("تعديل الرصيد")}
                </button>
                <button
                  type="button"
                  className="session-packages__button danger"
                  onClick={() => void cancel(pkg)}
                  disabled={busy || pkg.status === "cancelled"}
                >
                  {t("إلغاء الباقة")}
                </button>
              </>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}