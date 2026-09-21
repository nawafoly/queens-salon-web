import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateRight,
  faCircleExclamation,
  faMessage,
  faPaperPlane,
  faShieldHalved,
  faUserShield,
} from "@fortawesome/free-solid-svg-icons";

import {
  ClientConnectService,
  type ConnectConversation,
  type ConnectMessage,
  type ConnectSecurityContext,
  type ConnectSecurityEvent,
} from "../../services/ClientConnectService";
import { CoreStaffService } from "../../services/CoreStaffService";
import type { CoreStaff } from "../../types/coreApi";
import type { HrSession } from "./shared";

type Props = {
  session: HrSession;
  management?: boolean;
};

type Mode = "conversations" | "security";

function formatTime(value: string) {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function statusLabel(value: string) {
  if (value === "review") return "تحت المراجعة";
  if (value === "restricted") return "مقيدة";
  if (value === "closed") return "مغلقة";
  return "نشطة";
}

function severityLabel(value: string) {
  if (value === "critical") return "حرج";
  if (value === "high") return "مرتفع";
  if (value === "medium") return "متوسط";
  return "منخفض";
}

function reviewLabel(value: string) {
  if (value === "under_review") return "قيد المراجعة";
  if (value === "safe") return "سليم";
  if (value === "warning_issued") return "تم التحذير";
  if (value === "restricted") return "مقيد";
  if (value === "closed") return "مغلق";
  return "جديد";
}

export default function ClientConnectInboxV2({
  session,
  management = false,
}: Props) {
  const [mode, setMode] = useState<Mode>("conversations");
  const [conversations, setConversations] = useState<ConnectConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [messages, setMessages] = useState<ConnectMessage[]>([]);
  const [body, setBody] = useState("");
  const [staff, setStaff] = useState<CoreStaff[]>([]);
  const [securityEvents, setSecurityEvents] = useState<ConnectSecurityEvent[]>([]);
  const [securityContext, setSecurityContext] = useState<ConnectSecurityContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  const loadConversations = async () => {
    setLoading(true);
    setNotice("");
    try {
      const rows = await ClientConnectService.listStaffConversations({ limit: 300 });
      setConversations(rows);
      setSelectedConversationId((current) =>
        current && rows.some((row) => row.id === current)
          ? current
          : rows[0]?.id || ""
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل محادثات العميلات.");
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (conversationId: string) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setThreadLoading(true);
    setNotice("");
    try {
      setMessages(await ClientConnectService.listStaffMessages(conversationId));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل المحادثة.");
    } finally {
      setThreadLoading(false);
    }
  };

  const loadSecurity = async () => {
    if (!management) return;
    setLoading(true);
    setNotice("");
    try {
      setSecurityEvents(await ClientConnectService.listSecurityEvents({ limit: 300 }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل التنبيهات الأمنية.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConversations();
    if (management) {
      void CoreStaffService.list({ activeOnly: true })
        .then(setStaff)
        .catch(() => setStaff([]));
    }
  }, [management]);

  useEffect(() => {
    if (mode === "conversations") {
      void loadMessages(selectedConversationId);
    }
  }, [mode, selectedConversationId]);

  useEffect(() => {
    if (management && mode === "security") void loadSecurity();
  }, [management, mode]);

  const send = async () => {
    if (!selectedConversation || !body.trim() || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await ClientConnectService.sendStaffMessage(
        selectedConversation.id,
        body.trim()
      );
      if (result.blocked) {
        setNotice(
          result.userMessage ||
            "لم يتم إرسال الرسالة لأنها تحتوي على بيانات تواصل خارج منصة ملكات."
        );
        await Promise.all([loadConversations(), loadSecurity()]);
        return;
      }
      setBody("");
      await Promise.all([
        loadMessages(selectedConversation.id),
        loadConversations(),
      ]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر إرسال الرسالة.");
    } finally {
      setBusy(false);
    }
  };

  const assign = async (staffId: string) => {
    if (!management || !selectedConversation || !staffId || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await ClientConnectService.assignConversation(selectedConversation.id, staffId);
      await loadConversations();
      setNotice("تم إسناد المحادثة للمختصة.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تغيير المختصة.");
    } finally {
      setBusy(false);
    }
  };

  const openSecurityEvent = async (event: ConnectSecurityEvent) => {
    if (!management) return;
    setBusy(true);
    setNotice("");
    try {
      setSecurityContext(await ClientConnectService.getSecurityEvent(event.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر فتح المراجعة الأمنية.");
    } finally {
      setBusy(false);
    }
  };

  const review = async (
    status: "safe" | "warning_issued" | "restricted" | "closed"
  ) => {
    if (!management || !securityContext || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const updated = await ClientConnectService.reviewSecurityEvent(
        securityContext.event.id,
        status
      );
      setSecurityContext(updated);
      await Promise.all([loadSecurity(), loadConversations()]);
      setNotice("تم حفظ قرار المراجعة.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ قرار المراجعة.");
    } finally {
      setBusy(false);
    }
  };

  const canSend =
    selectedConversation &&
    selectedConversation.status !== "restricted" &&
    selectedConversation.status !== "closed" &&
    body.trim() &&
    !busy;

  return (
    <main className="dashboard-v2 dsv2-page client-connect-inbox-v2" dir="rtl">
      <section className="client-connect-inbox-v2__hero">
        <div>
          <span className="dsv2-badge">MALIKAT Connect</span>
          <h1>{management ? "محادثات العميلات" : "عميلاتي"}</h1>
          <p>
            {management
              ? "تواصل ملكات مع العميلات والمختصات، مع مراجعة محاولات مشاركة بيانات التواصل."
              : "المحادثات المسندة لك من ملكات فقط. بيانات التواصل الشخصية لا تظهر للطرفين."}
          </p>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--secondary"
          onClick={() =>
            mode === "security" ? void loadSecurity() : void loadConversations()
          }
          disabled={loading || busy}
        >
          <FontAwesomeIcon icon={faArrowRotateRight} spin={loading} />
          تحديث
        </button>
      </section>

      {management ? (
        <div className="client-connect-mode-tabs" role="tablist" aria-label="نوع الرسائل">
          <button
            type="button"
            className={mode === "conversations" ? "is-active" : ""}
            onClick={() => setMode("conversations")}
          >
            <FontAwesomeIcon icon={faMessage} />
            المحادثات
          </button>
          <button
            type="button"
            className={mode === "security" ? "is-active" : ""}
            onClick={() => setMode("security")}
          >
            <FontAwesomeIcon icon={faShieldHalved} />
            المراجعة الأمنية
            {securityEvents.filter((item) => item.reviewStatus === "new").length ? (
              <em>
                {securityEvents.filter((item) => item.reviewStatus === "new").length}
              </em>
            ) : null}
          </button>
        </div>
      ) : null}

      {notice ? <div className="client-connect-inbox-v2__notice">{notice}</div> : null}

      {mode === "conversations" ? (
        <section className="client-connect-inbox-v2__workspace">
          <aside className="client-connect-inbox-v2__list">
            {loading && !conversations.length ? (
              <div className="client-connect-inbox-v2__empty">جاري التحميل...</div>
            ) : !conversations.length ? (
              <div className="client-connect-inbox-v2__empty">
                لا توجد محادثات مسندة حاليًا.
              </div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={conversation.id === selectedConversationId ? "is-active" : ""}
                  onClick={() => setSelectedConversationId(conversation.id)}
                >
                  <span className="client-connect-inbox-v2__avatar">
                    {(conversation.clientName || "ع").slice(0, 1)}
                  </span>
                  <span>
                    <strong>{conversation.clientName || "عميلة ملكات"}</strong>
                    <small>
                      {conversation.assignedStaffName
                        ? `المختصة: ${conversation.assignedStaffName}`
                        : "بانتظار الإسناد"}
                    </small>
                    <p>{conversation.lastMessagePreview || "لا توجد رسالة بعد"}</p>
                  </span>
                  <em data-status={conversation.status}>
                    {statusLabel(conversation.status)}
                  </em>
                </button>
              ))
            )}
          </aside>

          <div className="client-connect-inbox-v2__thread">
            {!selectedConversation ? (
              <div className="client-connect-inbox-v2__empty">
                اختر محادثة لعرضها.
              </div>
            ) : (
              <>
                <header>
                  <div>
                    <strong>{selectedConversation.clientName || "عميلة ملكات"}</strong>
                    <span>
                      {selectedConversation.assignedStaffName
                        ? `مع ${selectedConversation.assignedStaffName}`
                        : "غير مسندة"}
                      {" · "}
                      {statusLabel(selectedConversation.status)}
                    </span>
                  </div>
                  {management ? (
                    <label>
                      <span>إسناد للمختصة</span>
                      <select
                        value={selectedConversation.assignedStaffId}
                        onChange={(event) => void assign(event.target.value)}
                        disabled={busy}
                      >
                        <option value="">اختر المختصة</option>
                        {staff.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name || item.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </header>

                <div className="client-connect-inbox-v2__messages">
                  {threadLoading ? (
                    <div className="client-connect-inbox-v2__empty">جاري تحميل المحادثة...</div>
                  ) : messages.length ? (
                    messages.map((message) => {
                      const mine =
                        management
                          ? message.senderKind === "admin"
                          : message.senderKind === "staff";
                      return (
                        <article
                          key={message.id}
                          className={`client-connect-inbox-v2__message ${mine ? "is-mine" : ""}`}
                        >
                          <div>{message.body}</div>
                          <small>
                            {message.senderKind === "client"
                              ? selectedConversation.clientName || "العميلة"
                              : message.senderKind === "admin"
                                ? "إدارة ملكات"
                                : selectedConversation.assignedStaffName || session.displayName || "المختصة"}
                            {message.createdAt ? ` · ${formatTime(message.createdAt)}` : ""}
                          </small>
                        </article>
                      );
                    })
                  ) : (
                    <div className="client-connect-inbox-v2__empty">لا توجد رسائل بعد.</div>
                  )}
                </div>

                {selectedConversation.status === "restricted" ? (
                  <div className="client-connect-inbox-v2__locked">
                    تم تقييد الإرسال حتى تنتهي مراجعة الإدارة.
                  </div>
                ) : selectedConversation.status === "closed" ? (
                  <div className="client-connect-inbox-v2__locked">المحادثة مغلقة.</div>
                ) : (
                  <div className="client-connect-inbox-v2__composer">
                    <textarea
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      rows={3}
                      maxLength={4000}
                      placeholder="اكتب الرسالة داخل ملكات..."
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <button type="button" onClick={() => void send()} disabled={!canSend}>
                      <FontAwesomeIcon icon={faPaperPlane} />
                      إرسال
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      ) : null}

      {management && mode === "security" ? (
        <section className="client-connect-security-v2">
          <aside className="client-connect-security-v2__events">
            {loading && !securityEvents.length ? (
              <div className="client-connect-inbox-v2__empty">جاري تحميل التنبيهات...</div>
            ) : !securityEvents.length ? (
              <div className="client-connect-inbox-v2__empty">
                لا توجد تنبيهات أمنية.
              </div>
            ) : (
              securityEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={securityContext?.event.id === event.id ? "is-active" : ""}
                  onClick={() => void openSecurityEvent(event)}
                >
                  <FontAwesomeIcon icon={faCircleExclamation} />
                  <span>
                    <strong>{event.clientName || "عميلة ملكات"}</strong>
                    <small>
                      {severityLabel(event.severity)} · {reviewLabel(event.reviewStatus)}
                    </small>
                    <p>{event.detectionType}</p>
                  </span>
                </button>
              ))
            )}
          </aside>

          <div className="client-connect-security-v2__review">
            {!securityContext ? (
              <div className="client-connect-inbox-v2__empty">
                <FontAwesomeIcon icon={faUserShield} />
                اختر تنبيهًا لفتح المحادثة الكاملة. يتم تسجيل فتح المراجعة في Audit Log.
              </div>
            ) : (
              <>
                <header>
                  <div>
                    <span>مراجعة أمنية</span>
                    <h2>{securityContext.event.clientName || "عميلة ملكات"}</h2>
                    <p>
                      السبب: {securityContext.event.detectionType} · الخطورة:{" "}
                      {severityLabel(securityContext.event.severity)}
                    </p>
                  </div>
                  <strong>{reviewLabel(securityContext.event.reviewStatus)}</strong>
                </header>

                <div className="client-connect-security-v2__messages">
                  {securityContext.messages.map((message) => (
                    <article
                      key={message.id}
                      className={
                        message.deliveryStatus === "blocked"
                          ? "is-blocked"
                          : message.senderKind === "client"
                            ? "is-client"
                            : "is-staff"
                      }
                    >
                      <div>{message.body}</div>
                      <small>
                        {message.deliveryStatus === "blocked"
                          ? "رسالة محظورة — لم تصل للطرف الآخر"
                          : message.senderKind === "client"
                            ? "العميلة"
                            : message.senderKind === "admin"
                              ? "الإدارة"
                              : "المختصة"}
                        {message.createdAt ? ` · ${formatTime(message.createdAt)}` : ""}
                      </small>
                    </article>
                  ))}
                </div>

                <div className="client-connect-security-v2__actions">
                  <button type="button" onClick={() => void review("safe")} disabled={busy}>
                    سليم
                  </button>
                  <button type="button" onClick={() => void review("warning_issued")} disabled={busy}>
                    تحذير
                  </button>
                  <button type="button" onClick={() => void review("restricted")} disabled={busy}>
                    تقييد
                  </button>
                  <button type="button" onClick={() => void review("closed")} disabled={busy}>
                    إغلاق
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
