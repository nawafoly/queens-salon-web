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

function halalasToMoney(value: unknown): string {
  const amount = Number(value ?? 0);
  return `${(Number.isFinite(amount) ? amount / 100 : 0).toFixed(2)} ر.س`;
}

export default function ClientPackagesPanel(props: {
  clientId?: string;
  canManage: boolean;
}) {
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
        cause instanceof Error ? cause.message : "تعذر تحميل الباقات والجلسات.";
      setError(message || "تعذر تحميل الباقات والجلسات.");
    } finally {
      setBusy(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function adjust(pkg: ClientPackage) {
    const raw = window.prompt(
      "عدد الجلسات المراد إضافتها أو خصمها (مثال: 1 أو -1)"
    );
    if (raw === null) return;
    const delta = Number(raw);
    const reason = window.prompt("سبب التعديل الإداري") || "";
    if (!Number.isInteger(delta) || !delta || !reason.trim()) {
      setError("يلزم إدخال عدد صحيح وسبب واضح.");
      return;
    }
    setBusy(true);
    try {
      await PackageOperationsService.adjust(String(pkg.id), delta, reason);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تعديل الرصيد.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(pkg: ClientPackage) {
    const reason = window.prompt("سبب إلغاء الباقة");
    if (!reason?.trim()) return;
    if (!window.confirm(`تأكيد إلغاء ${pkg.packageNameSnapshot}؟`)) return;
    setBusy(true);
    try {
      await PackageOperationsService.cancel(String(pkg.id), reason);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إلغاء الباقة.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(booking: LinkedBooking) {
    const reason = window.prompt("سبب استرجاع الجلسة المستخدمة");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await PackageOperationsService.restoreConsumed(booking.id, reason);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر استرجاع الجلسة."
      );
    } finally {
      setBusy(false);
    }
  }

  async function invoice(pkg: ClientPackage) {
    const invoiceId = text(pkg.invoiceId || pkg.invoiceDocumentId);
    if (!invoiceId) {
      setError("لا يوجد مرجع فاتورة لهذه الباقة.");
      return;
    }
    try {
      const invoiceRow = await CoreInvoiceService.get(invoiceId);
      printPackageDocument(
        `فاتورة ${invoiceRow.invoiceNumber || invoiceId}`,
        `<b>الباقة:</b> ${pkg.packageNameSnapshot}<br>` +
          `<b>الجلسات:</b> ${pkg.totalSessions}<br>` +
          `<b>قبل الخصم:</b> ${halalasToMoney(invoiceRow.subtotalHalalas)}<br>` +
          `<b>الخصم:</b> ${halalasToMoney(invoiceRow.discountHalalas)}<br>` +
          `<b>الإجمالي:</b> ${halalasToMoney(invoiceRow.totalHalalas)}<br>` +
          `<b>المدفوع:</b> ${halalasToMoney(invoiceRow.paidHalalas)}<br>` +
          `<b>الحالة:</b> ${invoiceRow.status || "—"}<br>` +
          `<b>تاريخ الانتهاء:</b> ${packageDate(pkg.expiresAt)}`
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "تعذر العثور على الفاتورة الأصلية في Core D1."
      );
    }
  }

  if (!clientId) {
    return (
      <div className="session-packages__error">
        لا يوجد clientId ثابت لهذا الملف؛ لا يمكن عرض الرصيد بالاعتماد على
        الهاتف فقط.
      </div>
    );
  }

  return (
    <section className="session-packages" aria-label="الباقات والجلسات">
      <div className="session-packages__head">
        <h3>الباقات والجلسات</h3>
        <button
          type="button"
          className="session-packages__button secondary"
          onClick={() => void load()}
          disabled={busy}
        >
          تحديث
        </button>
      </div>

      {error ? <div className="session-packages__error">{error}</div> : null}
      {!busy && !packages.length ? (
        <div className="session-packages__card">لا توجد باقات مسجلة.</div>
      ) : null}

      {packages.map((pkg) => (
        <article key={pkg.id} className="session-packages__card">
          <div className="session-packages__head">
            <div>
              <strong>{pkg.packageNameSnapshot}</strong>
              <span className="session-packages__muted">
                الحالة: {pkg.status}
              </span>
            </div>
            <span>فاتورة: {pkg.invoiceNumber || pkg.invoiceId || "—"}</span>
          </div>

          <div className="session-packages__stats">
            <div className="session-packages__stat">
              <small>الإجمالي</small>
              <strong>{pkg.totalSessions}</strong>
            </div>
            <div className="session-packages__stat">
              <small>المتبقي</small>
              <strong>{pkg.remainingSessions}</strong>
            </div>
            <div className="session-packages__stat">
              <small>المحجوز</small>
              <strong>{pkg.reservedSessions}</strong>
            </div>
            <div className="session-packages__stat">
              <small>المستخدم</small>
              <strong>{pkg.usedSessions}</strong>
            </div>
          </div>

          <p className="session-packages__muted">
            الشراء: {packageDate(pkg.purchasedAt)} · الانتهاء:{" "}
            {packageDate(pkg.expiresAt)}
          </p>
          <p>
            الخدمات:{" "}
            {pkg.allowedServiceIdsSnapshot
              .map((id) => services[id] || id)
              .join("، ")}
          </p>

          <details>
            <summary>
              سجل الحركات ({transactions[String(pkg.id)]?.length || 0})
            </summary>
            {(transactions[String(pkg.id)] || []).map((transaction) => (
              <div key={transaction.id}>
                {labels[transaction.type] || transaction.type}:{" "}
                {transaction.remainingBefore} ← {transaction.remainingAfter}{" "}
                {transaction.reason ? `· ${transaction.reason}` : ""}
              </div>
            ))}
          </details>

          <details>
            <summary>
              الحجوزات المرتبطة ({bookings[String(pkg.id)]?.length || 0})
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
                    استرجاع جلسة
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
              فتح الفاتورة الأصلية
            </button>
            {props.canManage ? (
              <>
                <button
                  type="button"
                  className="session-packages__button secondary"
                  onClick={() => void adjust(pkg)}
                  disabled={busy}
                >
                  تعديل الرصيد
                </button>
                <button
                  type="button"
                  className="session-packages__button danger"
                  onClick={() => void cancel(pkg)}
                  disabled={busy || pkg.status === "cancelled"}
                >
                  إلغاء الباقة
                </button>
              </>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}