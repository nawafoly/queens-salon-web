import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { buildSuccessNavigationPayload } from "../helpers/successNavigation";

const ALL_BOOKINGS_KEY = "allBookings";
const BOOKING_KEY = "currentBooking";

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
  } catch {}

  try {
    const rawCurrent = localStorage.getItem(BOOKING_KEY);
    const current = rawCurrent ? JSON.parse(rawCurrent) : null;
    const currentId = String(current?.id || current?.bookingId || "");
    if (current && currentId === bookingId) {
      matched = { ...current, paymentStatus: paid ? "paid" : "pending" };
      localStorage.setItem(BOOKING_KEY, JSON.stringify(matched));
    }
  } catch {}

  return matched || { id: bookingId, bookingId, trackId: bookingId };
}

export default function Pay() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [msg, setMsg] = useState("Verifying payment...");

  useEffect(() => {
    const bookingId = sp.get("bookingId") || "";
    const paymentId = sp.get("id") || sp.get("payment_id") || "";
    if (!bookingId) {
      setMsg("Missing booking reference.");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/verifyMoyasarPayment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId, paymentId }),
        });

        const data = await res.json();
        const paid = data?.paid === true;
        const successRef = updateLocalBookingPaid(bookingId, paid);
        const successNav = buildSuccessNavigationPayload(successRef, "created");

        setMsg(
          paid ? "Payment verified successfully." : "Payment is still pending."
        );
        setTimeout(() => navigate(successNav.to, { state: successNav.state }), 800);
      } catch {
        const successNav = buildSuccessNavigationPayload(
          { id: bookingId, bookingId, trackId: bookingId },
          "created"
        );
        setMsg("Could not verify payment right now. Your booking was saved.");
        setTimeout(() => navigate(successNav.to, { state: successNav.state }), 1200);
      }
    })();
  }, [navigate, sp]);

  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ textAlign: "center", lineHeight: 1.8 }}>
        <h2>Payment verification</h2>
        <p style={{ color: "#666" }}>{msg}</p>
      </div>
    </div>
  );
}
