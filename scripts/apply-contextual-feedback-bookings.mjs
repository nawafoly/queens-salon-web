import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing bookings feedback codemod anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Bookings feedback codemod anchor is not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceAllExact(source, before, after, expectedCount, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return source;
    throw new Error(`Missing bookings feedback codemod anchor: ${label}`);
  }
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`Unexpected bookings anchor count for ${label}: ${count}`);
  }
  return source.split(before).join(after);
}

const path = "src/pages/DashboardBookings.tsx";
let source = readFileSync(path, "utf8");

source = replaceOnce(
  source,
  `import { DashboardDateInputV2, DashboardSelectBridgeV2 } from "../components/dashboard-v2/DashboardNativeControlBridgeV2";`,
  `import { DashboardDateInputV2, DashboardSelectBridgeV2 } from "../components/dashboard-v2/DashboardNativeControlBridgeV2";\nimport { DashboardActionFeedbackV2 } from "../components/dashboard-v2";`,
  "action feedback import"
);

source = replaceOnce(
  source,
  `  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);\n  const [cancelBusy, setCancelBusy] = useState(false);`,
  `  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);\n  const [cancelBusy, setCancelBusy] = useState(false);\n  const [cancelError, setCancelError] = useState("");\n  const [bookingActionFeedback, setBookingActionFeedback] = useState<{\n    bookingId: string;\n    tone: "success" | "danger";\n    message: string;\n  } | null>(null);\n  const [bookingListFeedback, setBookingListFeedback] = useState<{\n    tone: "success" | "danger" | "warning";\n    message: string;\n  } | null>(null);`,
  "action feedback state"
);

source = replaceOnce(
  source,
  `  const closeCancelModal = useCallback(() => setCancelTarget(null), []);`,
  `  const closeCancelModal = useCallback(() => {\n    setCancelTarget(null);\n    setCancelError("");\n  }, []);`,
  "cancel close"
);

source = replaceAllExact(
  source,
  `      alert("غير مسموح لك بهذا التغيير.");`,
  `      setBookingActionFeedback({\n        bookingId: id,\n        tone: "danger",\n        message: language === "en" ? "You are not allowed to make this status change." : "غير مسموح لك بهذا التغيير.",\n      });`,
  2,
  "status permission alerts"
);

source = replaceOnce(
  source,
  `    if (newStatus === "cancelled") {\n      setCancelTarget(target);\n      return;\n    }`,
  `    if (newStatus === "cancelled") {\n      setCancelError("");\n      setBookingActionFeedback((current) => current?.bookingId === id ? null : current);\n      setCancelTarget(target);\n      return;\n    }`,
  "cancel status open"
);

source = replaceOnce(
  source,
  `      setConfirmError("");\n      setConfirmTarget(target);\n      return;`,
  `      setConfirmError("");\n      setBookingActionFeedback((current) => current?.bookingId === id ? null : current);\n      setConfirmTarget(target);\n      return;`,
  "confirm status open"
);

source = replaceOnce(
  source,
  `      setSelectedBooking((prev) => (prev && prev.id === id ? { ...prev, ...localPatch } : prev));\n      touchLastUpdate(id, localAuditPatch.atMs);\n    } catch (e) {\n      alert("فشل تحديث الحالة");\n    }`,
  `      setSelectedBooking((prev) => (prev && prev.id === id ? { ...prev, ...localPatch } : prev));\n      touchLastUpdate(id, localAuditPatch.atMs);\n      setBookingActionFeedback({\n        bookingId: id,\n        tone: "success",\n        message: language === "en"\n          ? \`Booking status updated to \${statusLabel[newStatus]}.\`\n          : \`تم تحديث حالة الحجز إلى \${statusLabel[newStatus]}.\`,\n      });\n    } catch (e) {\n      setBookingActionFeedback({\n        bookingId: id,\n        tone: "danger",\n        message: e instanceof Error && e.message\n          ? e.message\n          : (language === "en" ? "Unable to update the booking status." : "فشل تحديث الحالة."),\n      });\n    }`,
  "status result"
);

source = replaceOnce(
  source,
  `    requestSensitiveAction({\n      kind: "status",\n      bookingId: id,\n      nextStatus: newStatus,\n      bookingRef: bookingRef(target),\n    });`,
  `    setBookingActionFeedback((current) => current?.bookingId === id ? null : current);\n    requestSensitiveAction({\n      kind: "status",\n      bookingId: id,\n      nextStatus: newStatus,\n      bookingRef: bookingRef(target),\n    });`,
  "status request clear"
);

source = replaceOnce(
  source,
  `      touchLastUpdate(confirmTarget.id, localAuditPatch.atMs);\n\n      setConfirmTarget(null);`,
  `      touchLastUpdate(confirmTarget.id, localAuditPatch.atMs);\n      setBookingActionFeedback({\n        bookingId: confirmTarget.id,\n        tone: "success",\n        message: language === "en" ? "Booking confirmed successfully." : "تم تأكيد الحجز بنجاح.",\n      });\n\n      setConfirmTarget(null);`,
  "confirm success feedback"
);

source = replaceOnce(
  source,
  `  const confirmCancelBooking = async () => {\n    if (!cancelTarget?.id) return;\n    setCancelBusy(true);\n    try {\n      await updateCoreBookingStatus(cancelTarget.id, "cancelled");\n      const localAuditPatch = getLocalActorAudit();\n      const localPatch = {\n        status: "cancelled" as BookingStatus,\n        ...localAuditPatch,\n      };\n      setBookings((prev) =>\n        prev.map((row) => (row.id === cancelTarget.id ? { ...row, ...localPatch } : row))\n      );\n      setSelectedBooking((prev) =>\n        prev && prev.id === cancelTarget.id ? { ...prev, ...localPatch } : prev\n      );\n      touchLastUpdate(cancelTarget.id, localAuditPatch.atMs);\n      setCancelTarget(null);\n    } catch {\n      alert("فشل إلغاء الحجز");\n    } finally {\n      setCancelBusy(false);\n    }\n  };`,
  `  const confirmCancelBooking = async () => {\n    if (!cancelTarget?.id) return;\n    const targetId = cancelTarget.id;\n    setCancelBusy(true);\n    setCancelError("");\n    try {\n      await updateCoreBookingStatus(targetId, "cancelled");\n      const localAuditPatch = getLocalActorAudit();\n      const localPatch = {\n        status: "cancelled" as BookingStatus,\n        ...localAuditPatch,\n      };\n      setBookings((prev) =>\n        prev.map((row) => (row.id === targetId ? { ...row, ...localPatch } : row))\n      );\n      setSelectedBooking((prev) =>\n        prev && prev.id === targetId ? { ...prev, ...localPatch } : prev\n      );\n      touchLastUpdate(targetId, localAuditPatch.atMs);\n      setBookingActionFeedback({\n        bookingId: targetId,\n        tone: "success",\n        message: language === "en" ? "Booking cancelled successfully." : "تم إلغاء الحجز بنجاح.",\n      });\n      setCancelTarget(null);\n      setCancelError("");\n    } catch (error) {\n      setCancelError(\n        error instanceof Error && error.message\n          ? error.message\n          : (language === "en" ? "Unable to cancel the booking." : "فشل إلغاء الحجز.")\n      );\n    } finally {\n      setCancelBusy(false);\n    }\n  };`,
  "cancel action"
);

source = replaceAllExact(
  source,
  `      alert("حذف الحجز متاح للمالك فقط");`,
  `      setBookingActionFeedback({\n        bookingId: String(b.id || "").trim(),\n        tone: "danger",\n        message: language === "en" ? "Only the owner can delete a booking." : "حذف الحجز متاح للمالك فقط.",\n      });`,
  2,
  "delete permission alerts"
);

source = replaceOnce(
  source,
  `      setRefundMapByBookingId((current) => {\n        if (!current[bookingId]) return current;\n        const next = { ...current };\n        delete next[bookingId];\n        return next;\n      });\n    } catch (error) {`,
  `      setRefundMapByBookingId((current) => {\n        if (!current[bookingId]) return current;\n        const next = { ...current };\n        delete next[bookingId];\n        return next;\n      });\n      setBookingListFeedback({\n        tone: "success",\n        message: language === "en"\n          ? \`Booking \${bookingRef(b)} was removed from the bookings list.\`\n          : \`تم حذف الحجز \${bookingRef(b)} من قائمة الحجوزات.\`,\n      });\n    } catch (error) {`,
  "delete success"
);

const completedEditAlert = `        alert(\n          "الحجز المكتمل محمي ولا يمكن تعديله من هذا الحساب."\n        );`;
const completedEditFeedback = `        setBookingActionFeedback({\n          bookingId: String(b.id || "").trim(),\n          tone: "danger",\n          message: language === "en"\n            ? "Completed bookings are protected and cannot be edited from this account."\n            : "الحجز المكتمل محمي ولا يمكن تعديله من هذا الحساب.",\n        });`;
source = replaceAllExact(source, completedEditAlert, completedEditFeedback, 2, "completed edit alerts");

source = replaceAllExact(
  source,
  `      alert("التعديل متاح فقط للمالك أو الأدمن.");`,
  `      setBookingActionFeedback({\n        bookingId: String(b.id || "").trim(),\n        tone: "danger",\n        message: language === "en" ? "Editing is available only to the owner or an admin." : "التعديل متاح فقط للمالك أو الأدمن.",\n      });`,
  2,
  "edit permission alerts"
);

source = replaceOnce(
  source,
  `      setEditTarget(b);`,
  `      setBookingActionFeedback((current) => current?.bookingId === String(b.id || "").trim() ? null : current);\n      setEditTarget(b);`,
  "edit open clear"
);

source = replaceOnce(
  source,
  `                            {uiRole === "reception" && b.status === "pending" ? (\n                              <>\n                                <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={() => handleUpdateStatus(b.id, "confirmed")}>{t("تأكيد")}</button>\n                                <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => handleUpdateStatus(b.id, "cancelled")}>{t("إلغاء")}</button>\n                              </>\n                            ) : null}\n                          </div>\n                        </td>`,
  `                            {uiRole === "reception" && b.status === "pending" ? (\n                              <>\n                                <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={() => handleUpdateStatus(b.id, "confirmed")}>{t("تأكيد")}</button>\n                                <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => handleUpdateStatus(b.id, "cancelled")}>{t("إلغاء")}</button>\n                              </>\n                            ) : null}\n                          </div>\n                          {bookingActionFeedback?.bookingId === String(b.id || "").trim() ? (\n                            <DashboardActionFeedbackV2\n                              compact\n                              tone={bookingActionFeedback.tone}\n                              title={bookingActionFeedback.tone === "success"\n                                ? (language === "en" ? "Action completed" : "تم تنفيذ الإجراء")\n                                : (language === "en" ? "Action failed" : "تعذر تنفيذ الإجراء")}\n                              description={bookingActionFeedback.message}\n                              className="bk-row-action-feedback"\n                            />\n                          ) : null}\n                        </td>`,
  "desktop row feedback"
);

source = replaceOnce(
  source,
  `                        {uiRole === "reception" && b.status === "pending" && (\n                          <>\n                            <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm w-100" onClick={() => handleUpdateStatus(b.id, "confirmed")}>\n                              {t("تأكيد")}\n                            </button>\n                            <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm w-100" onClick={() => handleUpdateStatus(b.id, "cancelled")}>\n                              {t("إلغاء")}\n                            </button>\n                          </>\n                        )}\n                      </div>\n                    </div>`,
  `                        {uiRole === "reception" && b.status === "pending" && (\n                          <>\n                            <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm w-100" onClick={() => handleUpdateStatus(b.id, "confirmed")}>\n                              {t("تأكيد")}\n                            </button>\n                            <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm w-100" onClick={() => handleUpdateStatus(b.id, "cancelled")}>\n                              {t("إلغاء")}\n                            </button>\n                          </>\n                        )}\n                      </div>\n                      {bookingActionFeedback?.bookingId === String(b.id || "").trim() ? (\n                        <DashboardActionFeedbackV2\n                          compact\n                          tone={bookingActionFeedback.tone}\n                          title={bookingActionFeedback.tone === "success"\n                            ? (language === "en" ? "Action completed" : "تم تنفيذ الإجراء")\n                            : (language === "en" ? "Action failed" : "تعذر تنفيذ الإجراء")}\n                          description={bookingActionFeedback.message}\n                          className="bk-mobile-action-feedback"\n                        />\n                      ) : null}\n                    </div>`,
  "mobile card feedback"
);

source = replaceOnce(
  source,
  `        <div className="bookings-v2-sections">\n          {bookingSectionsView}\n        </div>`,
  `        {bookingListFeedback ? (\n          <DashboardActionFeedbackV2\n            revealOnMount\n            tone={bookingListFeedback.tone}\n            title={bookingListFeedback.tone === "success"\n              ? (language === "en" ? "Bookings updated" : "تم تحديث الحجوزات")\n              : (language === "en" ? "Booking action needs attention" : "إجراء الحجز يحتاج متابعة")}\n            description={bookingListFeedback.message}\n          />\n        ) : null}\n\n        <div className="bookings-v2-sections">\n          {bookingSectionsView}\n        </div>`,
  "list feedback"
);

source = replaceOnce(
  source,
  `              <span>{t("التاريخ")}: {cancelTarget?.date || "—"} - {bookingClockText(cancelTarget?.time || "", language)}</span>\n            </div>\n          </div>\n          <div className="bk-cancel-foot">`,
  `              <span>{t("التاريخ")}: {cancelTarget?.date || "—"} - {bookingClockText(cancelTarget?.time || "", language)}</span>\n            </div>\n            {cancelError ? (\n              <DashboardActionFeedbackV2\n                revealOnMount\n                focusOnMount\n                tone="danger"\n                title={language === "en" ? "Cancellation failed" : "تعذر إلغاء الحجز"}\n                description={cancelError}\n              />\n            ) : null}\n          </div>\n          <div className="bk-cancel-foot">`,
  "cancel modal feedback"
);

source = replaceOnce(
  source,
  `    language,\n  ]);\n\n  const bookingSectionsView = useMemo(`,
  `    language,\n    bookingActionFeedback,\n  ]);\n\n  const bookingSectionsView = useMemo(`,
  "render callback dependency"
);

writeFileSync(path, source, "utf8");
console.log("Applied contextual bookings action feedback.");
