import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const ALL_BOOKINGS_KEY = "allBookings";

function updateLocalBookingPaid(bookingId: string, paid: boolean) {
  try {
    const raw = localStorage.getItem(ALL_BOOKINGS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return;

    const next = arr.map((b: any) => {
      const id = String(b.id || b.bookingId || "");
      if (id !== bookingId) return b;
      return { ...b, paymentStatus: paid ? "paid" : "pending" };
    });

    localStorage.setItem(ALL_BOOKINGS_KEY, JSON.stringify(next));
  } catch {}
}

export default function PaymentCallback() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [msg, setMsg] = useState("جاري التحقق من الدفع...");

  useEffect(() => {
    const bookingId = sp.get("bookingId") || "";
    const paymentId = sp.get("id") || sp.get("payment_id") || ""; // بعض التدفقات ترجع id
    if (!bookingId) {
      setMsg("لا يوجد رقم حجز.");
      return;
    }

    // ✅ نستدعي Cloud Function للتحقق من الدفع (من Moyasar API) ثم نحدّث الحالة
    (async () => {
      try {
        const res = await fetch("/api/verifyMoyasarPayment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId, paymentId }),
        });

        const data = await res.json();
        const paid = data?.paid === true;

        updateLocalBookingPaid(bookingId, paid);

        setMsg(paid ? "تم الدفع بنجاح ✅" : "الدفع لم يكتمل بعد (بانتظار الدفع).");
        setTimeout(() => navigate("/success"), 800);
      } catch {
        setMsg("تعذر التحقق الآن، تم حفظ الحجز وبإمكانك المحاولة لاحقًا.");
        setTimeout(() => navigate("/success"), 1200);
      }
    })();
  }, [navigate, sp]);

  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ textAlign: "center", lineHeight: 1.8 }}>
        <h2>تأكيد الدفع</h2>
        <p style={{ color: "#666" }}>{msg}</p>
      </div>
    </div>
  );
}
