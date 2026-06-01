import { useEffect, useMemo, useState } from "react";
import { getDocs, limit, orderBy, query } from "firebase/firestore";

import {
  createEmployeeMessage,
  createEmployeeNotification,
  employeeMessagesCol,
  listEmployeeDirectory,
  listEmployeeNotifications,
  markEmployeeThreadRead,
  markEmployeeNotificationsRead,
  type EmployeeDirectoryEntry,
  type EmployeeMessage,
} from "../../services/employeeHub";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
  onPortalChange?: () => void | Promise<void>;
};

function makeConversationId(a: string, b: string) {
  return [cleanText(a), cleanText(b)].filter(Boolean).sort().join("__");
}

function getOtherParticipant(message: EmployeeMessage, uid: string) {
  return message.senderUid === uid ? message.recipientUid : message.senderUid;
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

function formatMessageTime(value: unknown) {
  const ms = toMillis(value);
  if (!ms) return "just now";
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

export default function EmployeeMessagesPage({ session, onPortalChange }: Props) {
  const [items, setItems] = useState<EmployeeMessage[]>([]);
  const [directory, setDirectory] = useState<EmployeeDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [recipientUid, setRecipientUid] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [body, setBody] = useState("");

  const loadAll = async () => {
    if (!session.uid) return;
    setLoading(true);
    try {
      const [dir, msgSnap] = await Promise.all([
        listEmployeeDirectory(),
        getDocs(query(employeeMessagesCol(), orderBy("createdAt", "desc"), limit(300))),
      ]);
      setDirectory(dir);
      const rows = msgSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as EmployeeMessage[];
      setItems(rows);

      const notifications = await listEmployeeNotifications({
        targetUid: session.uid,
        targetEmployeeId: session.employeeId,
        limitCount: 200,
      });
      const unreadIds = notifications
        .filter((note) => !note.isRead && (note.route === "/employee/messages" || note.type === "message"))
        .map((note) => note.id);
      if (unreadIds.length) {
        await markEmployeeNotificationsRead({ notificationIds: unreadIds, readerUid: session.uid });
        await Promise.resolve(onPortalChange?.());
      }
    } catch (e) {
      setMessage(cleanText((e as any)?.message || "Failed to load messages."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.uid]);

  const filtered = useMemo(() => {
    if (!session.uid) return [];
    return items.filter(
      (msg) => msg.senderUid === session.uid || msg.recipientUid === session.uid || msg.kind === "system"
    );
  }, [items, session.uid]);

  const conversations = useMemo(() => {
    const map = new Map<string, EmployeeMessage[]>();
    filtered.forEach((msg) => {
      const key = cleanText(msg.conversationId || makeConversationId(msg.senderUid, msg.recipientUid));
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(msg);
    });

    return Array.from(map.entries())
      .map(([id, messages]) => {
        const sorted = [...messages].sort((a, b) => {
          const aMs = toMillis(a.createdAt);
          const bMs = toMillis(b.createdAt);
          return bMs - aMs;
        });
        const latest = sorted[0];
        const unreadCount = sorted.filter((msg) => {
          const readBy = Array.isArray(msg.readBy) ? msg.readBy.map((x) => cleanText(x)) : [];
          return !readBy.includes(session.uid);
        }).length;
        return {
          id,
          messages: sorted,
          latest,
          unreadCount,
          otherUid: latest ? getOtherParticipant(latest, session.uid) : "",
        };
      })
      .sort((a, b) => {
        const aMs = toMillis(a.latest?.createdAt);
        const bMs = toMillis(b.latest?.createdAt);
        return bMs - aMs;
      });
  }, [filtered, session.uid]);

  useEffect(() => {
    if (selectedConversationId || !conversations[0]?.id) return;
    setSelectedConversationId(conversations[0].id);
  }, [conversations, selectedConversationId]);

  const activeConversation = useMemo(() => {
    return conversations.find((item) => item.id === selectedConversationId) || conversations[0] || null;
  }, [conversations, selectedConversationId]);

  const activeMessages = activeConversation?.messages || [];

  useEffect(() => {
    if (!activeConversation?.id || !session.uid) return;
    void markEmployeeThreadRead({ conversationId: activeConversation.id, readerUid: session.uid });
  }, [activeConversation?.id, session.uid]);

  const selectedRecipient = useMemo(
    () => directory.find((item) => item.employeeKey === recipientUid || item.linkedUid === recipientUid || item.employeeId === recipientUid),
    [directory, recipientUid]
  );

  const handleSend = async () => {
    if (!session.uid) return;
    const toUid = cleanText(recipientUid);
    const text = cleanText(body);
    if (!toUid || !text) {
      setMessage("Recipient and message text are required.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const conversationId = activeConversation?.id || makeConversationId(session.uid, toUid);
      await createEmployeeMessage({
        conversationId,
        threadId: conversationId,
        senderUid: session.uid,
        senderName: session.displayName,
        recipientUid: toUid,
        recipientName: selectedRecipient?.name || recipientName,
        body: text,
        kind: "hr_to_employee",
      });

      await createEmployeeNotification({
        targetUid: toUid,
        targetEmployeeId: selectedRecipient?.employeeId || selectedRecipient?.employeeKey || toUid,
        type: "message",
        title: "رسالة جديدة",
        body: text.slice(0, 120),
        route: "/employee/messages",
      }).catch(() => {});

      setBody("");
      await loadAll();
      setSelectedConversationId(conversationId);
    } catch (e) {
      setMessage(cleanText((e as any)?.message || "Failed to send message."));
    } finally {
      setBusy(false);
    }
  };

  if (!session.user) {
    return (
      <div className="employee-card">
        <h2>Messages</h2>
        <p>No authenticated employee session.</p>
      </div>
    );
  }

  return (
    <div className="employee-panel">
      <div className="employee-panel-head">
        <div>
          <p className="employee-panel-kicker">Internal messages</p>
          <h2>Messages</h2>
          <p className="employee-panel-subtitle">Conversation and thread grouping with read receipts.</p>
        </div>
        <button className="employee-button" type="button" onClick={() => void loadAll()} disabled={loading || busy}>
          Refresh
        </button>
      </div>

      {message ? <div className="employee-alert">{message}</div> : null}

      <div className="employee-messages-composer">
        <label className="employee-field">
          <span>Recipient</span>
          <select value={recipientUid} onChange={(e) => setRecipientUid(e.target.value)}>
            <option value="">Select a coworker</option>
            {directory.map((item) => (
              <option key={item.employeeId} value={item.employeeKey || item.linkedUid || item.employeeId}>
                {item.name || item.employeeId} {item.role ? `(${item.role})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="employee-field">
          <span>Recipient name</span>
          <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Optional label" />
        </label>
        <label className="employee-field employee-field--wide">
          <span>Message</span>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message..." />
        </label>
        <div className="employee-actions">
          <button className="employee-button employee-button--accent" type="button" onClick={() => void handleSend()} disabled={busy || !recipientUid}>
            Send message
          </button>
        </div>
      </div>

      <div className="employee-split">
        <section className="employee-card">
          <div className="employee-card-head">
            <h3>Conversations</h3>
            <span>{conversations.length}</span>
          </div>
          <div className="employee-list">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                className={`employee-list-item employee-list-item--button ${selectedConversationId === conv.id ? "is-active" : ""}`}
                onClick={() => {
                  setSelectedConversationId(conv.id);
                  setRecipientUid(conv.otherUid || recipientUid);
                }}
              >
                <strong>{conv.otherUid || "Conversation"}</strong>
                <span>{conv.latest?.body || "No message"}</span>
                <small>{conv.unreadCount ? `${conv.unreadCount} unread` : "read"}</small>
              </button>
            ))}
            {!conversations.length ? <div className="employee-muted">No messages yet.</div> : null}
          </div>
        </section>

        <section className="employee-card">
          <div className="employee-card-head">
            <h3>Thread</h3>
            <span>{activeMessages.length}</span>
          </div>
          <div className="employee-thread">
            {activeMessages.map((msg) => {
              const mine = msg.senderUid === session.uid;
              return (
                <div key={msg.id} className={`employee-bubble ${mine ? "is-mine" : ""}`}>
                  <strong>{mine ? "You" : msg.senderName || msg.senderUid}</strong>
                  <p>{msg.body}</p>
                  <small>{formatMessageTime(msg.createdAt)}</small>
                </div>
              );
            })}
            {!activeMessages.length ? <div className="employee-muted">Select a conversation to view the thread.</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
