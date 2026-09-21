import { useEffect, useMemo, useState } from "react";
import {
  LuLoaderCircle,
  LuLockKeyhole,
  LuMessageCircle,
  LuRefreshCw,
  LuSend,
  LuShieldCheck,
  LuUserRound,
} from "react-icons/lu";

import {
  ClientConnectService,
  type ConnectConversation,
  type ConnectMessage,
} from "../../services/ClientConnectService";

function dateTime(value: string) {
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

function statusLabel(status: string) {
  if (status === "review") return "تحت المراجعة";
  if (status === "restricted") return "مقيدة مؤقتًا";
  if (status === "closed") return "مغلقة";
  return "نشطة";
}

export default function ClientConnectPanel() {
  const [conversations, setConversations] = useState<ConnectConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<ConnectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) || null,
    [conversations, selectedId]
  );

  const loadConversations = async () => {
    setLoading(true);
    setNotice("");
    try {
      const rows = await ClientConnectService.listClientConversations();
      setConversations(rows);
      setSelectedId((current) =>
        current && rows.some((row) => row.id === current)
          ? current
          : rows[0]?.id || ""
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل محادثاتك.");
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
      setMessages(await ClientConnectService.listClientMessages(conversationId));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل المحادثة.");
    } finally {
      setThreadLoading(false);
    }
  };

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    void loadMessages(selectedId);
  }, [selectedId]);

  const openConversation = async () => {
    setSending(true);
    setNotice("");
    try {
      const conversation = await ClientConnectService.openClientConversation();
      await loadConversations();
      setSelectedId(conversation.id);
      setNotice("تم فتح محادثة ملكات الخاصة بك.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر فتح المحادثة.");
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    const text = body.trim();
    if (!selected || !text || sending) return;
    setSending(true);
    setNotice("");
    try {
      const result = await ClientConnectService.sendClientMessage(selected.id, text);
      if (result.blocked) {
        setNotice(
          result.userMessage ||
            "لم يتم إرسال الرسالة لأنها تحتوي على بيانات تواصل خارج منصة ملكات."
        );
        await loadConversations();
        return;
      }
      setBody("");
      await Promise.all([loadMessages(selected.id), loadConversations()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر إرسال الرسالة.");
    } finally {
      setSending(false);
    }
  };

  const sendDisabled =
    !selected ||
    selected.status === "restricted" ||
    selected.status === "closed" ||
    !body.trim() ||
    sending;

  return (
    <section className="malikat-connect-client" aria-label="محادثات ملكات">
      <header className="malikat-connect-client__hero">
        <div className="malikat-connect-client__hero-icon">
          <LuMessageCircle />
        </div>
        <div>
          <span>خدمة MALIKAT Connect</span>
          <h3>تواصلي مع مختصتك</h3>
          <p>
            المحادثة تبقى داخل ملكات لحماية خصوصيتك واستمرارية الخدمة حتى لو تغيرت المختصة.
          </p>
        </div>
        <button
          type="button"
          className="malikat-connect-icon-btn"
          onClick={() => void loadConversations()}
          disabled={loading}
          aria-label="تحديث المحادثات"
        >
          <LuRefreshCw className={loading ? "is-spinning" : ""} />
        </button>
      </header>

      <div className="malikat-connect-policy">
        <LuShieldCheck />
        <span>
          لا يمكن مشاركة أرقام الجوال أو البريد أو حسابات التواصل الخارجية داخل المحادثة.
        </span>
      </div>

      {notice ? <div className="malikat-connect-notice" role="status">{notice}</div> : null}

      {loading && conversations.length === 0 ? (
        <div className="malikat-connect-empty">
          <LuLoaderCircle className="is-spinning" />
          <span>جاري تحميل المحادثات...</span>
        </div>
      ) : conversations.length === 0 ? (
        <div className="malikat-connect-empty">
          <LuUserRound />
          <strong>ابدئي محادثة مع ملكات</strong>
          <p>سيتم ربط المحادثة بمختصتك أو تحويلها إلى المختصة المناسبة من الإدارة.</p>
          <button type="button" onClick={() => void openConversation()} disabled={sending}>
            {sending ? "جاري الفتح..." : "بدء المحادثة"}
          </button>
        </div>
      ) : (
        <div className="malikat-connect-client__workspace">
          {conversations.length > 1 ? (
            <div className="malikat-connect-client__threads" aria-label="المحادثات">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={conversation.id === selectedId ? "is-active" : ""}
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <strong>{conversation.assignedStaffName || "فريق ملكات"}</strong>
                  <span>{conversation.lastMessagePreview || "محادثة ملكات"}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="malikat-connect-thread">
            <div className="malikat-connect-thread__head">
              <div>
                <strong>{selected?.assignedStaffName || "فريق ملكات"}</strong>
                <span>{selected ? statusLabel(selected.status) : ""}</span>
              </div>
              {selected?.status === "restricted" ? <LuLockKeyhole /> : <LuShieldCheck />}
            </div>

            <div className="malikat-connect-messages" aria-live="polite">
              {threadLoading ? (
                <div className="malikat-connect-empty compact">
                  <LuLoaderCircle className="is-spinning" />
                  <span>جاري تحميل المحادثة...</span>
                </div>
              ) : messages.length ? (
                messages.map((message) => {
                  const mine = message.senderKind === "client";
                  return (
                    <article
                      key={message.id}
                      className={`malikat-connect-message ${mine ? "is-mine" : "is-staff"}`}
                    >
                      <div>{message.body}</div>
                      <small>
                        {mine ? "أنتِ" : message.senderKind === "admin" ? "إدارة ملكات" : selected?.assignedStaffName || "ملكات"}
                        {message.createdAt ? ` · ${dateTime(message.createdAt)}` : ""}
                      </small>
                    </article>
                  );
                })
              ) : (
                <div className="malikat-connect-empty compact">
                  <LuMessageCircle />
                  <span>ابدئي رسالتك الأولى.</span>
                </div>
              )}
            </div>

            {selected?.status === "restricted" ? (
              <div className="malikat-connect-restricted">
                <LuLockKeyhole />
                <span>تم إيقاف الإرسال مؤقتًا حتى تنتهي مراجعة الإدارة.</span>
              </div>
            ) : selected?.status === "closed" ? (
              <div className="malikat-connect-restricted">
                <LuLockKeyhole />
                <span>هذه المحادثة مغلقة.</span>
              </div>
            ) : (
              <div className="malikat-connect-composer">
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="اكتبي رسالتك هنا..."
                  rows={3}
                  maxLength={4000}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={sendDisabled}
                  aria-label="إرسال"
                >
                  {sending ? <LuLoaderCircle className="is-spinning" /> : <LuSend />}
                  <span>{sending ? "إرسال..." : "إرسال"}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
