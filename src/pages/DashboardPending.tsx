// src/pages/DashboardPending.tsx
import React from "react";

// 👇 يخلي TS يعتبره مستخدم
void React;
import { useNavigate } from "react-router-dom";

export default function DashboardPending() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 520, width: "100%", padding: 18, borderRadius: 16, border: "1px solid rgba(0,0,0,.08)", background: "rgba(255,255,255,.9)" }}>
        <h2 style={{ margin: 0, marginBottom: 8 }}>حسابك بانتظار التفعيل</h2>
        <p style={{ margin: 0, opacity: 0.8, lineHeight: 1.8 }}>
          تم تسجيل دخولك بنجاح، لكن صلاحيات الإدارة لم يتم تفعيلها بعد.
          الرجاء التواصل مع إدارة الصالون لتفعيل الحساب.
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => navigate("/")}
            style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,.12)", background: "#fff", cursor: "pointer" }}
          >
            رجوع للموقع
          </button>
          <button
            type="button"
            onClick={() => navigate("/login")}
            style={{ padding: "10px 14px", borderRadius: 12, border: "none", background: "#111", color: "#fff", cursor: "pointer" }}
          >
            تسجيل دخول بحساب آخر
          </button>
        </div>
      </div>
    </div>
  );
}
