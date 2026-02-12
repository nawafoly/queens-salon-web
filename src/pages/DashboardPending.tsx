// src/pages/DashboardPending.tsx
import React from "react";
void React;

import { useNavigate } from "react-router-dom";

export default function DashboardPending() {
  const navigate = useNavigate();

  const styles = {
    page: {
      minHeight: "70vh",
      display: "grid",
      placeItems: "center",
      padding: 24,
    } as React.CSSProperties,

    card: {
      maxWidth: 520,
      width: "100%",
      padding: 22,
      borderRadius: 18,
      border: "1px solid rgba(13,13,13,.08)",
      background: "rgba(245,245,244,.92)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      boxShadow: "0 10px 30px rgba(0,0,0,.06)",
    } as React.CSSProperties,

    title: {
      margin: "0 0 8px 0",
      fontSize: 20,
      fontWeight: 900,
      color: "#0D0D0D",
    } as React.CSSProperties,

    text: {
      margin: 0,
      opacity: 0.85,
      lineHeight: 1.9,
      color: "#515659",
    } as React.CSSProperties,

    actions: {
      display: "flex",
      gap: 10,
      marginTop: 16,
      color: "#111",
      justifyContent: "flex-end",
    } as React.CSSProperties,

    btnSecondary: {
      padding: "10px 14px",
      borderRadius: 12,
      border: "1px solid rgba(13,13,13,.12)",
      background: "#fff",
      cursor: "pointer",
      fontWeight: 700,
    } as React.CSSProperties,

    btnPrimary: {
      padding: "10px 14px",
      borderRadius: 12,
      border: "none",
      background: "#0D0D0D",
      color: "#fff",
      cursor: "pointer",
      fontWeight: 700,
    } as React.CSSProperties,
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.title}>حسابك بانتظار التفعيل</h2>

        <p style={styles.text}>
          تم تسجيل دخولك بنجاح، لكن صلاحيات الإدارة لم يتم تفعيلها بعد.
          الرجاء التواصل مع إدارة الصالون لتفعيل الحساب.
        </p>

        <div style={styles.actions}>
          <button
            type="button"
            onClick={() => navigate("/")}
            style={styles.btnPrimary}
          >
            رجوع للموقع
          </button>
        </div>
      </div>
    </div>
  );
}
