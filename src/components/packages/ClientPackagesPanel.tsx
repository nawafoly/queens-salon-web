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
  purchase: "ط´ط±ط§ط،",
  reserve: "ط­ط¬ط²",
  consume: "ط§ط³طھط®ط¯ط§ظ…",
  restore: "ط¥ظ„ط؛ط§ط، ظˆط§ط³طھط±ط¬ط§ط¹",
  cancel: "ط¥ظ„ط؛ط§ط، ط¨ط§ظ‚ط©",
  admin_adjustment: "طھط¹ط¯ظٹظ„ ط¥ط¯ط§ط±ظٹ",
  admin_restore: "ط§ط³طھط±ط¬ط§ط¹ ط¥ط¯ط§ط±ظٹ",
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
  return `${(Number.isFinite(amount) ? amount / 100 : 0).toFixed(2)} ط±.ط³`;
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
        cause instanceof Error ? cause.message : "طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ط¨ط§ظ‚ط§طھ ظˆط§ظ„ط¬ظ„ط³ط§طھ.";
      setError(message || "طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ط¨ط§ظ‚ط§طھ ظˆط§ظ„ط¬ظ„ط³ط§طھ.");
    } finally {
      setBusy(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function adjust(pkg: ClientPackage) {
    const raw = window.prompt(
      "ط¹ط¯ط¯ ط§ظ„ط¬ظ„ط³ط§طھ ط§ظ„ظ…ط±ط§ط¯ ط¥ط¶ط§ظپطھظ‡ط§ ط£ظˆ ط®طµظ…ظ‡ط§ (ظ…ط«ط§ظ„: 1 ط£ظˆ -1)"
    );
    if (raw === null) return;
    const delta = Number(raw);
    const reason = window.prompt("ط³ط¨ط¨ ط§ظ„طھط¹ط¯ظٹظ„ ط§ظ„ط¥ط¯ط§ط±ظٹ") || "";
    if (!Number.isInteger(delta) || !delta || !reason.trim()) {
      setError("ظٹظ„ط²ظ… ط¥ط¯ط®ط§ظ„ ط¹ط¯ط¯ طµط­ظٹط­ ظˆط³ط¨ط¨ ظˆط§ط¶ط­.");
      return;
    }
    setBusy(true);
    try {
      await PackageOperationsService.adjust(String(pkg.id), delta, reason);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "طھط¹ط°ط± طھط¹ط¯ظٹظ„ ط§ظ„ط±طµظٹط¯.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(pkg: ClientPackage) {
    const reason = window.prompt("ط³ط¨ط¨ ط¥ظ„ط؛ط§ط، ط§ظ„ط¨ط§ظ‚ط©");
    if (!reason?.trim()) return;
    if (!window.confirm(`طھط£ظƒظٹط¯ ط¥ظ„ط؛ط§ط، ${pkg.packageNameSnapshot}طں`)) return;
    setBusy(true);
    try {
      await PackageOperationsService.cancel(String(pkg.id), reason);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "طھط¹ط°ط± ط¥ظ„ط؛ط§ط، ط§ظ„ط¨ط§ظ‚ط©.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(booking: LinkedBooking) {
    const reason = window.prompt("ط³ط¨ط¨ ط§ط³طھط±ط¬ط§ط¹ ط§ظ„ط¬ظ„ط³ط© ط§ظ„ظ…ط³طھط®ط¯ظ…ط©");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await PackageOperationsService.restoreConsumed(booking.id, reason);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "طھط¹ط°ط± ط§ط³طھط±ط¬ط§ط¹ ط§ظ„ط¬ظ„ط³ط©."
      );
    } finally {
      setBusy(false);
    }
  }

  async function invoice(pkg: ClientPackage) {
    const invoiceId = text(pkg.invoiceId || pkg.invoiceDocumentId);
    if (!invoiceId) {
      setError("ظ„ط§ ظٹظˆط¬ط¯ ظ…ط±ط¬ط¹ ظپط§طھظˆط±ط© ظ„ظ‡ط°ظ‡ ط§ظ„ط¨ط§ظ‚ط©.");
      return;
    }
    try {
      const invoiceRow = await CoreInvoiceService.get(invoiceId);
      printPackageDocument(
        `ظپط§طھظˆط±ط© ${invoiceRow.invoiceNumber || invoiceId}`,
        `<b>ط§ظ„ط¨ط§ظ‚ط©:</b> ${pkg.packageNameSnapshot}<br>` +
          `<b>ط§ظ„ط¬ظ„ط³ط§طھ:</b> ${pkg.totalSessions}<br>` +
          `<b>ظ‚ط¨ظ„ ط§ظ„ط®طµظ…:</b> ${halalasToMoney(invoiceRow.subtotalHalalas)}<br>` +
          `<b>ط§ظ„ط®طµظ…:</b> ${halalasToMoney(invoiceRow.discountHalalas)}<br>` +
          `<b>ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ:</b> ${halalasToMoney(invoiceRow.totalHalalas)}<br>` +
          `<b>ط§ظ„ظ…ط¯ظپظˆط¹:</b> ${halalasToMoney(invoiceRow.paidHalalas)}<br>` +
          `<b>ط§ظ„ط­ط§ظ„ط©:</b> ${invoiceRow.status || "â€”"}<br>` +
          `<b>طھط§ط±ظٹط® ط§ظ„ط§ظ†طھظ‡ط§ط،:</b> ${packageDate(pkg.expiresAt)}`
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "طھط¹ط°ط± ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ط§ظ„ظپط§طھظˆط±ط© ط§ظ„ط£طµظ„ظٹط© ظپظٹ Core D1."
      );
    }
  }

  if (!clientId) {
    return (
      <div className="session-packages__error">
        ظ„ط§ ظٹظˆط¬ط¯ clientId ط«ط§ط¨طھ ظ„ظ‡ط°ط§ ط§ظ„ظ…ظ„ظپط› ظ„ط§ ظٹظ…ظƒظ† ط¹ط±ط¶ ط§ظ„ط±طµظٹط¯ ط¨ط§ظ„ط§ط¹طھظ…ط§ط¯ ط¹ظ„ظ‰
        ط§ظ„ظ‡ط§طھظپ ظپظ‚ط·.
      </div>
    );
  }

  return (
    <section className="session-packages" aria-label="ط§ظ„ط¨ط§ظ‚ط§طھ ظˆط§ظ„ط¬ظ„ط³ط§طھ">
      <div className="session-packages__head">
        <h3>ط§ظ„ط¨ط§ظ‚ط§طھ ظˆط§ظ„ط¬ظ„ط³ط§طھ</h3>
        <button
          type="button"
          className="session-packages__button secondary"
          onClick={() => void load()}
          disabled={busy}
        >
          طھط­ط¯ظٹط«
        </button>
      </div>

      {error ? <div className="session-packages__error">{error}</div> : null}
      {!busy && !packages.length ? (
        <div className="session-packages__card">ظ„ط§ طھظˆط¬ط¯ ط¨ط§ظ‚ط§طھ ظ…ط³ط¬ظ„ط©.</div>
      ) : null}

      {packages.map((pkg) => (
        <article key={pkg.id} className="session-packages__card">
          <div className="session-packages__head">
            <div>
              <strong>{pkg.packageNameSnapshot}</strong>
              <span className="session-packages__muted">
                ط§ظ„ط­ط§ظ„ط©: {pkg.status}
              </span>
            </div>
            <span>ظپط§طھظˆط±ط©: {pkg.invoiceNumber || pkg.invoiceId || "â€”"}</span>
          </div>

          <div className="session-packages__stats">
            <div className="session-packages__stat">
              <small>ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</small>
              <strong>{pkg.totalSessions}</strong>
            </div>
            <div className="session-packages__stat">
              <small>ط§ظ„ظ…طھط¨ظ‚ظٹ</small>
              <strong>{pkg.remainingSessions}</strong>
            </div>
            <div className="session-packages__stat">
              <small>ط§ظ„ظ…ط­ط¬ظˆط²</small>
              <strong>{pkg.reservedSessions}</strong>
            </div>
            <div className="session-packages__stat">
              <small>ط§ظ„ظ…ط³طھط®ط¯ظ…</small>
              <strong>{pkg.usedSessions}</strong>
            </div>
          </div>

          <p className="session-packages__muted">
            ط§ظ„ط´ط±ط§ط،: {packageDate(pkg.purchasedAt)} آ· ط§ظ„ط§ظ†طھظ‡ط§ط،:{" "}
            {packageDate(pkg.expiresAt)}
          </p>
          <p>
            ط§ظ„ط®ط¯ظ…ط§طھ:{" "}
            {pkg.allowedServiceIdsSnapshot
              .map((id) => services[id] || id)
              .join("طŒ ")}
          </p>

          <details>
            <summary>
              ط³ط¬ظ„ ط§ظ„ط­ط±ظƒط§طھ ({transactions[String(pkg.id)]?.length || 0})
            </summary>
            {(transactions[String(pkg.id)] || []).map((transaction) => (
              <div key={transaction.id}>
                {labels[transaction.type] || transaction.type}:{" "}
                {transaction.remainingBefore} â†گ {transaction.remainingAfter}{" "}
                {transaction.reason ? `آ· ${transaction.reason}` : ""}
              </div>
            ))}
          </details>

          <details>
            <summary>
              ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ظ…ط±طھط¨ط·ط© ({bookings[String(pkg.id)]?.length || 0})
            </summary>
            {(bookings[String(pkg.id)] || []).map((booking) => (
              <div key={`${booking.id}_${booking.serviceName}`}>
                {booking.publicId} آ· {booking.serviceName} آ· {booking.date}{" "}
                {booking.time} آ· {booking.status}{" "}
                {props.canManage &&
                booking.packageRedemptionState === "consumed" ? (
                  <button
                    type="button"
                    onClick={() => void restore(booking)}
                  >
                    ط§ط³طھط±ط¬ط§ط¹ ط¬ظ„ط³ط©
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
              ظپطھط­ ط§ظ„ظپط§طھظˆط±ط© ط§ظ„ط£طµظ„ظٹط©
            </button>
            {props.canManage ? (
              <>
                <button
                  type="button"
                  className="session-packages__button secondary"
                  onClick={() => void adjust(pkg)}
                  disabled={busy}
                >
                  طھط¹ط¯ظٹظ„ ط§ظ„ط±طµظٹط¯
                </button>
                <button
                  type="button"
                  className="session-packages__button danger"
                  onClick={() => void cancel(pkg)}
                  disabled={busy || pkg.status === "cancelled"}
                >
                  ط¥ظ„ط؛ط§ط، ط§ظ„ط¨ط§ظ‚ط©
                </button>
              </>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}