import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faBuilding,
  faCheckDouble,
  faEnvelope,
  faMagnifyingGlass,
  faPaperPlane,
  faPlus,
  faRotate,
  faUserGroup,
} from "@fortawesome/free-solid-svg-icons";

import {
  DashboardEmptyStateV2,
  DashboardFieldV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import {
  createEmployeeMessage,
  listEmployeeDirectory,
  listEmployeeMessages,
  listEmployeeNotifications,
  markEmployeeThreadRead,
  markEmployeeNotificationsRead,
  type EmployeeDirectoryEntry,
  type EmployeeMessage,
} from "../../services/employeeHub";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
};

type ConversationFilter = "all" | "unread" | "hr" | "internal";

function makeConversationId(a: string, b: string) {
  return [cleanText(a), cleanText(b)].filter(Boolean).sort().join("__");
}

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object") {
    const maybe = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toMillis === "function") {
      const ms = maybe.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof maybe.seconds === "number") {
      return maybe.seconds * 1000 + Math.floor((maybe.nanoseconds || 0) / 1_000_000);
    }
  }
  return 0;
}

function formatMessageTime(value: unknown, includeDate = true) {
  const ms = toMillis(value);
  if (!ms) return "الآن";
  return new Intl.DateTimeFormat("ar-SA", {
    hour: "numeric",
    minute: "2-digit",
    ...(includeDate ? { year: "numeric", month: "short", day: "numeric" } : {}),
  }).format(new Date(ms));
}

function initials(value: unknown) {
  const text = cleanText(value);
  if (!text) return "؟";
  const parts = text.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

function roleLabel(value: unknown) {
  const role = cleanText(value).toLowerCase();
  if (role === "owner") return "المالك";
  if (role === "admin") return "الإدارة";
  if (role === "hr") return "الموارد البشرية";
  if (role === "reception") return "الاستقبال";
  return "موظف";
}

function isManagementRole(value: unknown) {
  return ["owner", "admin", "hr"].includes(cleanText(value).toLowerCase());
}

export default function AdminMessagesV2({ session }: Props) {
  const [items, setItems] = useState<EmployeeMessage[]>([]);
  const [directory, setDirectory] = useState<EmployeeDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [recipientUid, setRecipientUid] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [creating, setCreating] = useState(false);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);

  const canManage = isManagementRole(session.role);

  const directoryByUid = useMemo(() => {
    const map = new Map<string, EmployeeDirectoryEntry>();
    directory.forEach((item) => {
      [item.employeeKey, item.linkedUid, item.employeeId].forEach((key) => {
        const normalized = cleanText(key);
        if (normalized) map.set(normalized, item);
      });
    });
    return map;
  }, [directory]);

  const loadAll = async () => {
    if (!session.uid) return;
    setLoading(true);
    setNotice("");
    try {
      const [dir, msgSnap] = await Promise.all([
        listEmployeeDirectory(),
        listEmployeeMessages(500),
      ]);
      setDirectory(dir.filter((item) => item.active !== false));
      const rows = msgSnap as EmployeeMessage[];
      setItems(rows);

      const notifications = await listEmployeeNotifications({
        targetUid: session.uid,
        targetEmployeeId: session.employeeId,
        limitCount: 200,
      });
      const unreadIds = notifications
        .filter((item) => !item.isRead && (item.route === "/employee/messages" || item.type === "message"))
        .map((item) => item.id);
      if (unreadIds.length) {
        await markEmployeeNotificationsRead({ notificationIds: unreadIds, readerUid: session.uid });
      }
    } catch (error) {
      setNotice(cleanText((error as any)?.message || "تعذر تحميل الرسائل الداخلية."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.uid]);

  const visibleMessages = useMemo(() => {
    if (!session.uid) return [];
    if (canManage) return items;
    return items.filter(
      (item) =>
        item.senderUid === session.uid ||
        item.recipientUid === session.uid ||
        (item.kind === "system" && (!item.recipientUid || item.recipientUid === session.uid)),
    );
  }, [canManage, items, session.uid]);

  const conversations = useMemo(() => {
    const grouped = new Map<string, EmployeeMessage[]>();
    visibleMessages.forEach((item) => {
      const id = cleanText(item.conversationId || makeConversationId(item.senderUid, item.recipientUid));
      if (!id) return;
      const current = grouped.get(id) || [];
      current.push(item);
      grouped.set(id, current);
    });

    return Array.from(grouped.entries())
      .map(([id, messages]) => {
        const sortedDesc = [...messages].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        const latest = sortedDesc[0];
        const participantUids = Array.from(
          new Set(
            sortedDesc
              .flatMap((item) => [cleanText(item.senderUid), cleanText(item.recipientUid)])
              .filter(Boolean),
          ),
        );
        const otherUids = participantUids.filter((uid) => uid !== session.uid);
        const preferredOtherUid =
          otherUids.find((uid) => !isManagementRole(directoryByUid.get(uid)?.role)) || otherUids[0] || "";
        const other = directoryByUid.get(preferredOtherUid);
        const senderName = cleanText(latest?.senderName || directoryByUid.get(latest?.senderUid || "")?.name);
        const recipientDisplay = cleanText(
          latest?.recipientName || directoryByUid.get(latest?.recipientUid || "")?.name,
        );
        const title =
          cleanText(other?.name) ||
          (latest?.senderUid === session.uid ? recipientDisplay : senderName) ||
          [senderName, recipientDisplay].filter(Boolean).join(" ↔ ") ||
          "محادثة داخلية";
        const unreadCount = sortedDesc.filter((item) => {
          const readBy = Array.isArray(item.readBy) ? item.readBy.map(cleanText) : [];
          return item.senderUid !== session.uid && !readBy.includes(session.uid);
        }).length;
        const kind = sortedDesc.some((item) => item.kind === "hr_to_employee") ? "hr" : "internal";
        return {
          id,
          messages: [...sortedDesc].reverse(),
          latest,
          title,
          subtitle: cleanText(other?.title || roleLabel(other?.role)),
          otherUid: preferredOtherUid,
          unreadCount,
          kind,
          latestAt: toMillis(latest?.createdAt),
        };
      })
      .sort((a, b) => b.latestAt - a.latestAt);
  }, [directoryByUid, session.uid, visibleMessages]);

  const filteredConversations = useMemo(() => {
    const q = cleanText(search).toLowerCase();
    return conversations.filter((conversation) => {
      if (filter === "unread" && conversation.unreadCount < 1) return false;
      if (filter === "hr" && conversation.kind !== "hr") return false;
      if (filter === "internal" && conversation.kind !== "internal") return false;
      if (!q) return true;
      return [conversation.title, conversation.subtitle, conversation.latest?.body]
        .map((value) => cleanText(value).toLowerCase())
        .some((value) => value.includes(q));
    });
  }, [conversations, filter, search]);

  useEffect(() => {
    if (selectedConversationId && conversations.some((item) => item.id === selectedConversationId)) return;
    setSelectedConversationId(conversations[0]?.id || "");
  }, [conversations, selectedConversationId]);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) || null,
    [conversations, selectedConversationId],
  );

  useEffect(() => {
    if (!activeConversation?.id || !session.uid) return;
    void markEmployeeThreadRead({ conversationId: activeConversation.id, readerUid: session.uid })
      .then(() => {
        setItems((current) =>
          current.map((item) =>
            item.conversationId === activeConversation.id && item.senderUid !== session.uid
              ? { ...item, readBy: Array.from(new Set([...(item.readBy || []), session.uid])) }
              : item,
          ),
        );
      })
      .catch(() => {});
  }, [activeConversation?.id, session.uid]);

  const selectedRecipient = useMemo(() => directoryByUid.get(recipientUid), [directoryByUid, recipientUid]);

  const replyUid = useMemo(() => {
    if (creating) return cleanText(recipientUid);
    return cleanText(activeConversation?.otherUid || recipientUid);
  }, [activeConversation?.otherUid, creating, recipientUid]);

  const replyRecipient = directoryByUid.get(replyUid);

  const recipientOptions = useMemo(
    () => [
      { value: "", label: "اختر موظفًا", disabled: true },
      ...directory
        .filter(
          (item) =>
            ![item.employeeKey, item.linkedUid, item.employeeId]
              .map(cleanText)
              .includes(session.uid),
        )
        .map((item) => ({
          value: cleanText(item.employeeKey || item.linkedUid || item.employeeId),
          label: `${item.name || item.email || item.employeeId} — ${roleLabel(item.role)}`,
        }))
        .filter((item) => item.value),
    ],
    [directory, session.uid],
  );

  const startNewConversation = () => {
    setCreating(true);
    setMobileThreadOpen(true);
    setRecipientUid("");
    setRecipientName("");
    setBody("");
  };

  const openConversation = (conversationId: string, otherUid: string) => {
    setCreating(false);
    setSelectedConversationId(conversationId);
    setRecipientUid(otherUid);
    setRecipientName(directoryByUid.get(otherUid)?.name || "");
    setMobileThreadOpen(true);
  };

  const handleSend = async () => {
    if (!session.uid) return;
    const toUid = cleanText(replyUid);
    const text = cleanText(body);
    if (!toUid || !text) {
      setNotice("اختر المستلم واكتب نص الرسالة أولًا.");
      return;
    }
    if (toUid === session.uid) {
      setNotice("لا يمكن إرسال رسالة إلى الحساب نفسه.");
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      const target = directoryByUid.get(toUid) || selectedRecipient;
      const conversationId =
        creating || !activeConversation?.id
          ? makeConversationId(session.uid, toUid)
          : activeConversation.id;
      const targetIsManagement = isManagementRole(target?.role);
      const kind: EmployeeMessage["kind"] = canManage || targetIsManagement
        ? "hr_to_employee"
        : "employee_to_employee";

      await createEmployeeMessage({
        conversationId,
        threadId: conversationId,
        senderUid: session.uid,
        senderName: session.displayName || session.email,
        recipientUid: toUid,
        recipientName: target?.name || recipientName,
        body: text,
        kind,
      });

      setBody("");
      setCreating(false);
      await loadAll();
      setSelectedConversationId(conversationId);
      setNotice("تم إرسال الرسالة بنجاح.");
    } catch (error) {
      setNotice(cleanText((error as any)?.message || "تعذر إرسال الرسالة."));
    } finally {
      setBusy(false);
    }
  };

  const stats = useMemo(
    () => ({
      total: conversations.length,
      hr: conversations.filter((item) => item.kind === "hr").length,
      internal: conversations.filter((item) => item.kind === "internal").length,
      unread: conversations.reduce((sum, item) => sum + item.unreadCount, 0),
    }),
    [conversations],
  );

  const filterItems = [
    ["all", "الكل", stats.total],
    ["unread", "غير مقروء", stats.unread],
    ["hr", "HR", stats.hr],
    ["internal", "داخلي", stats.internal],
  ] as const;

  if (!session.user) {
    return (
      <main className="dashboard-v2 dsv2-page admin-messages-v2-page" dir="rtl">
        <DashboardEmptyStateV2 title="لا توجد جلسة موظف نشطة" tone="gold" />
      </main>
    );
  }

  return (
    <main
      className={`dashboard-v2 dsv2-page admin-messages-v2-page${mobileThreadOpen ? " is-mobile-thread-open" : ""}`}
      dir="rtl"
    >
      <section className="admin-messages-v2-hero">
        <div className="admin-messages-v2-hero__copy">
          <span className="dsv2-badge">التواصل الداخلي</span>
          <h1>صندوق الرسائل</h1>
          <p>محادثات الموارد البشرية والتواصل الداخلي بين الموظفين في مساحة واحدة.</p>
        </div>
        <div className="admin-messages-v2-hero__actions">
          <button
            className="dsv2-btn dsv2-btn--secondary"
            type="button"
            onClick={() => void loadAll()}
            disabled={loading || busy}
          >
            <FontAwesomeIcon icon={faRotate} spin={loading} />
            <span>{loading ? "جارٍ التحديث" : "تحديث"}</span>
          </button>
          <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={startNewConversation}>
            <FontAwesomeIcon icon={faPlus} />
            <span>رسالة جديدة</span>
          </button>
        </div>
      </section>

      <section className="admin-messages-v2-stats" aria-label="إحصاءات الرسائل">
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faEnvelope} /></span>
          <p className="dsv2-metric-card__label">إجمالي المحادثات</p>
          <strong className="dsv2-metric-card__value">{stats.total}</strong>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faBuilding} /></span>
          <p className="dsv2-metric-card__label">رسائل HR</p>
          <strong className="dsv2-metric-card__value">{stats.hr}</strong>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--success">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faUserGroup} /></span>
          <p className="dsv2-metric-card__label">محادثات داخلية</p>
          <strong className="dsv2-metric-card__value">{stats.internal}</strong>
        </article>
        <article className={`dsv2-metric-card ${stats.unread ? "dsv2-metric-card--danger" : "dsv2-metric-card--gold"}`}>
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faCheckDouble} /></span>
          <p className="dsv2-metric-card__label">غير مقروءة</p>
          <strong className="dsv2-metric-card__value">{stats.unread}</strong>
        </article>
      </section>

      {notice ? <div className="admin-messages-v2-alert" role="status">{notice}</div> : null}

      <section className="admin-messages-v2-workspace">
        <aside className="dsv2-card admin-messages-v2-inbox">
          <header className="admin-messages-v2-inbox__head">
            <div>
              <span>صندوق الرسائل</span>
              <strong>{filteredConversations.length} محادثة</strong>
            </div>
            <DashboardFieldV2 id="admin-messages-search" label="البحث">
              <div className="admin-messages-v2-search">
                <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
                <input
                  id="admin-messages-search"
                  className="dsv2-input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ابحث بالاسم أو نص الرسالة..."
                />
              </div>
            </DashboardFieldV2>
          </header>

          <div className="admin-messages-v2-filters" aria-label="تصفية المحادثات">
            {filterItems.map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "is-active" : ""}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                <span>{label}</span>
                <em>{count}</em>
              </button>
            ))}
          </div>

          <div className="admin-messages-v2-list">
            {loading && items.length === 0 ? (
              <div className="admin-messages-v2-loading" role="status" aria-label="جارٍ تحميل المحادثات">
                <DashboardSkeletonV2 variant="block" height={76} />
                <DashboardSkeletonV2 variant="block" height={76} />
                <DashboardSkeletonV2 variant="block" height={76} />
              </div>
            ) : (
              filteredConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`admin-messages-v2-conversation${
                    selectedConversationId === conversation.id && !creating ? " is-active" : ""
                  }`}
                  onClick={() => openConversation(conversation.id, conversation.otherUid)}
                  aria-pressed={selectedConversationId === conversation.id && !creating}
                >
                  <span className="admin-messages-v2-avatar" aria-hidden="true">
                    {initials(conversation.title)}
                  </span>
                  <span className="admin-messages-v2-conversation__copy">
                    <strong>{conversation.title}</strong>
                    <small>{conversation.kind === "hr" ? "محادثة موارد بشرية" : "محادثة داخلية"}</small>
                    <span>{conversation.latest?.body || "لا توجد رسالة"}</span>
                  </span>
                  <span className="admin-messages-v2-conversation__meta">
                    <time>{formatMessageTime(conversation.latest?.createdAt, false)}</time>
                    {conversation.unreadCount ? <em>{conversation.unreadCount}</em> : null}
                  </span>
                </button>
              ))
            )}

            {!loading && !filteredConversations.length ? (
              <DashboardEmptyStateV2
                title="لا توجد محادثات مطابقة"
                description="ابدأ محادثة جديدة أو غيّر الفلتر."
                icon={<FontAwesomeIcon icon={faEnvelope} />}
                tone="gold"
                compact
              />
            ) : null}
          </div>
        </aside>

        <section className="dsv2-card admin-messages-v2-thread" aria-label="المحادثة">
          {creating ? (
            <div className="admin-messages-v2-new">
              <header className="admin-messages-v2-thread__head">
                <button
                  type="button"
                  className="admin-messages-v2-back"
                  onClick={() => {
                    setCreating(false);
                    setMobileThreadOpen(false);
                  }}
                  aria-label="العودة إلى المحادثات"
                >
                  <FontAwesomeIcon icon={faArrowRight} />
                </button>
                <div>
                  <span>محادثة جديدة</span>
                  <strong>اختر المستلم واكتب رسالتك</strong>
                </div>
              </header>

              <div className="admin-messages-v2-new__body">
                <DashboardFieldV2 id="admin-message-recipient" label="المستلم" required>
                  <DashboardSelectV2
                    id="admin-message-recipient"
                    value={recipientUid}
                    options={recipientOptions}
                    placeholder="اختر موظفًا"
                    onChange={setRecipientUid}
                  />
                </DashboardFieldV2>

                <DashboardFieldV2 id="admin-message-recipient-name" label="اسم بديل للمستلم" hint="اختياري، ويُستخدم فقط إذا لم يظهر الاسم.">
                  <input
                    id="admin-message-recipient-name"
                    className="dsv2-input"
                    value={recipientName}
                    onChange={(event) => setRecipientName(event.target.value)}
                    placeholder="اسم المستلم"
                  />
                </DashboardFieldV2>

                <DashboardFieldV2 id="admin-message-body-new" label="نص الرسالة" required className="admin-messages-v2-field--wide">
                  <textarea
                    id="admin-message-body-new"
                    className="dsv2-textarea admin-messages-v2-new-textarea"
                    rows={9}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="اكتب الرسالة هنا..."
                  />
                </DashboardFieldV2>
              </div>

              <div className="admin-messages-v2-compose-actions">
                <button
                  className="dsv2-btn dsv2-btn--primary"
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={busy || !recipientUid || !cleanText(body)}
                >
                  <FontAwesomeIcon icon={faPaperPlane} />
                  <span>{busy ? "جارٍ الإرسال" : "إرسال الرسالة"}</span>
                </button>
              </div>
            </div>
          ) : activeConversation ? (
            <>
              <header className="admin-messages-v2-thread__head">
                <button
                  type="button"
                  className="admin-messages-v2-back"
                  onClick={() => setMobileThreadOpen(false)}
                  aria-label="العودة إلى قائمة المحادثات"
                >
                  <FontAwesomeIcon icon={faArrowRight} />
                </button>
                <span className="admin-messages-v2-avatar admin-messages-v2-avatar--large" aria-hidden="true">
                  {initials(activeConversation.title)}
                </span>
                <div>
                  <span>{activeConversation.kind === "hr" ? "محادثة موارد بشرية" : "محادثة داخلية"}</span>
                  <strong>{activeConversation.title}</strong>
                  <small>{activeConversation.subtitle}</small>
                </div>
              </header>

              <div className="admin-messages-v2-messages">
                {activeConversation.messages.map((item) => {
                  const mine = item.senderUid === session.uid;
                  return (
                    <article key={item.id} className={mine ? "is-mine" : "is-other"}>
                      <span className="admin-messages-v2-avatar" aria-hidden="true">
                        {initials(item.senderName || item.senderUid)}
                      </span>
                      <div className="admin-messages-v2-bubble">
                        <header>
                          <strong>
                            {mine
                              ? "أنت"
                              : item.senderName || directoryByUid.get(item.senderUid)?.name || "مستخدم"}
                          </strong>
                          <span>{item.kind === "hr_to_employee" ? "رسالة HR" : "رسالة داخلية"}</span>
                        </header>
                        <p>{item.body}</p>
                        <footer>
                          <time>{formatMessageTime(item.createdAt)}</time>
                          {mine ? (
                            <span><FontAwesomeIcon icon={faCheckDouble} /> تم الإرسال</span>
                          ) : null}
                        </footer>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="admin-messages-v2-composer">
                <textarea
                  className="dsv2-textarea"
                  rows={3}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder={`اكتب ردًا إلى ${replyRecipient?.name || activeConversation.title}...`}
                  aria-label="نص الرد"
                />
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--primary"
                  onClick={() => void handleSend()}
                  disabled={busy || !replyUid || !cleanText(body)}
                  aria-label="إرسال"
                >
                  <FontAwesomeIcon icon={faPaperPlane} />
                  <span>{busy ? "جارٍ الإرسال" : "إرسال"}</span>
                </button>
              </div>
            </>
          ) : (
            <DashboardEmptyStateV2
              title="اختر محادثة"
              description="حدد محادثة من القائمة أو ابدأ رسالة جديدة."
              icon={<FontAwesomeIcon icon={faEnvelope} />}
              tone="gold"
            />
          )}
        </section>
      </section>
    </main>
  );
}
