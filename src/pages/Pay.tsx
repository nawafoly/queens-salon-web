import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { buildSuccessNavigationPayload } from "../helpers/successNavigation";

const ALL_BOOKINGS_KEY = "allBookings";
const BOOKING_KEY = "currentBooking";

type VerificationTone = "loading" | "success" | "warning" | "error";

function updateLocalBookingPaid(bookingId: string, paid: boolean) {
  let matched: any = null;

  try {
    const raw = localStorage.getItem(ALL_BOOKINGS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      const next = arr.map((booking: any) => {
        const id = String(booking?.id || booking?.bookingId || "");
        if (id !== bookingId) return booking;
        matched = { ...booking, paymentStatus: paid ? "paid" : "pending" };
        return matched;
      });
      localStorage.setItem(ALL_BOOKINGS_KEY, JSON.stringify(next));
    }
  } catch {
    // Keep verification flow working when local cache is unavailable.
  }

  try {
    const rawCurrent = localStorage.getItem(BOOKING_KEY);
    const current = rawCurrent ? JSON.parse(rawCurrent) : null;
    const currentId = String(current?.id || current?.bookingId || "");
    if (current && currentId === bookingId) {
      matched = { ...current, paymentStatus: paid ? "paid" : "pending" };
      localStorage.setItem(BOOKING_KEY, JSON.stringify(matched));
    }
  } catch {
    // Keep verification flow working when local cache is unavailable.
  }

  return matched || { id: bookingId, bookingId, trackId: bookingId };
}

function statusSymbol(tone: VerificationTone) {
  if (tone === "success") return "✓";
  if (tone === "warning") return "!";
  if (tone === "error") return "×";
  return null;
}

export default function Pay() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const bookingId = sp.get("bookingId") || "";
  const [message, setMessage] = useState("جاري التحقق من عملية الدفع...");
  const [tone, setTone] = useState<VerificationTone>("loading");

  useEffect(() => {
    const paymentId = sp.get("id") || sp.get("payment_id") || "";
    let redirectTimer: number | undefined;
    let active = true;

    if (!bookingId) {
      setTone("error");
      setMessage("تعذر العثور على رقم الحجز المرتبط بعملية الدفع.");
      return undefined;
    }

    void (async () => {
      try {
        const res = await fetch("/api/verifyMoyasarPayment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId, paymentId }),
        });

        const data = await res.json();
        if (!active) return;

        const paid = data?.paid === true;
        const successRef = updateLocalBookingPaid(bookingId, paid);
        const successNav = buildSuccessNavigationPayload(successRef, "created");

        setTone(paid ? "success" : "warning");
        setMessage(
          paid
            ? "تم التحقق من الدفع بنجاح. سيتم تحويلك إلى تفاصيل الحجز."
            : "عملية الدفع لا تزال قيد المعالجة. سيتم تحويلك إلى تفاصيل الحجز."
        );
        redirectTimer = window.setTimeout(
          () => navigate(successNav.to, { state: successNav.state }),
          900
        );
      } catch {
        if (!active) return;
        const successNav = buildSuccessNavigationPayload(
          { id: bookingId, bookingId, trackId: bookingId },
          "created"
        );
        setTone("warning");
        setMessage("تعذر التحقق الآن، لكن حجزك محفوظ وسيتم تحويلك إلى تفاصيله.");
        redirectTimer = window.setTimeout(
          () => navigate(successNav.to, { state: successNav.state }),
          1300
        );
      }
    })();

    return () => {
      active = false;
      if (redirectTimer) window.clearTimeout(redirectTimer);
    };
  }, [bookingId, navigate, sp]);

  const symbol = statusSymbol(tone);

  return (
    <main className="payment-status-page">
      <section className="payment-status-card" aria-live="polite">
        <div className="payment-status-topline" />
        <div className="payment-status-brand">
          <span className="payment-status-brand-mark">M</span>
          <span>صالون ملكات</span>
        </div>

        <div className={`payment-status-icon is-${tone}`} aria-hidden="true">
          {tone === "loading" ? (
            <span className="payment-status-spinner" />
          ) : (
            <span className="payment-status-symbol">{symbol}</span>
          )}
        </div>

        <h1 className="payment-status-title">التحقق من الدفع</h1>
        <p className="payment-status-message">{message}</p>

        {bookingId ? (
          <div className="payment-status-reference">
            <span className="payment-status-reference-label">مرجع الحجز</span>
            <strong className="payment-status-reference-value">{bookingId}</strong>
          </div>
        ) : null}

        {tone === "loading" ? (
          <>
            <div className="payment-status-progress" aria-hidden="true">
              <div className="payment-status-progress-bar" />
            </div>
            <p className="payment-status-note">لا تغلق الصفحة أثناء التحقق.</p>
          </>
        ) : null}

        {tone === "error" ? (
          <div className="payment-status-actions">
            <button
              type="button"
              className="payment-status-btn is-primary"
              onClick={() => navigate("/booking")}
            >
              العودة إلى الحجز
            </button>
            <button
              type="button"
              className="payment-status-btn"
              onClick={() => navigate("/")}
            >
              الصفحة الرئيسية
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
