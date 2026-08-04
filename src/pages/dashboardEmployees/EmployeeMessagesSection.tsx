import { useCallback, useEffect, useMemo, useState } from "react";
import { getDocs, limit, orderBy, query } from "firebase/firestore";
import {
  createEmployeeMessage,
  createEmployeeNotification,
  employeeMessagesCol,
  markEmployeeThreadRead,
  type EmployeeMessage,
} from "../../services/employeeHub";
import {
  DashboardFieldV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import {
  WorkspaceCardV2,
  WorkspaceNoticeV2,
  WorkspaceStateShowcaseV2,
  WorkspaceStatusBadgeV2,
  WorkspaceTabHeaderV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";

type EmployeeMessagesSectionProps = {
  isVisible: boolean;
  employeeId: string;
  employeeUid?: string;
  employeeName?: string;
  viewerUid?: string;
  viewerName?: string;
  canManage: boolean;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

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
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    if (typeof maybe.seconds === "number") return maybe.seconds * 1000 + Math.floor((maybe.nanoseconds || 0) / 1_000_000);
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
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")) || text[0] || "؟";
}

function messageMatchesEmployee(message: EmployeeMessage, employeeKeys: Set<string>) {
  const sender = cleanText(message.senderUid);
  const recipient = cleanText(message.recipientUid);
  const conversationId = cleanText(message.conversationId);
  if (employeeKeys.has(sender) || employeeKeys.has(recipient)) return true;
  return Array.from(employeeKeys).some((key) => conversationId.includes(key));
}

export default function EmployeeMessagesSection({
  isVisible,
  employeeId,
  employeeUid,
  employeeName,
  viewerUid,
  viewerName,
  canManage,
}: EmployeeMessagesSectionProps) {
  const [rows, setRows] = useState<EmployeeMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [viewState, setViewState] = useState("ready");
  const [failed, setFailed] = useState(false);

  const targetUid = cleanText(employeeUid || employeeId);
  const targetName = cleanText(employeeName) || targetUid || "الموظفة";
  const conversationId = useMemo(() => makeConversationId(viewerUid || "", targetUid), [targetUid, viewerUid]);

  const employeeKeys = useMemo(() => {
    return new Set([cleanText(employeeId), cleanText(employeeUid)].filter(Boolean));
  }, [employeeId, employeeUid]);

  const load = useCallback(async () => {
    if (!isVisible || !employeeKeys.size) return;
    setLoading(true);
    setError("");
    try {
      const snap = await getDocs(query(employeeMessagesCol(), orderBy("createdAt", "desc"), limit(500)));
      const all = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) })) as EmployeeMessage[];
      const visible = all
        .filter((item) => messageMatchesEmployee(item, employeeKeys))
        .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      setRows(visible);
      setViewState(visible.length ? "ready" : "empty");

      const reader = cleanText(viewerUid);
      const conversationIds = Array.from(new Set(visible.map((item) => cleanText(item.conversationId)).filter(Boolean)));
      if (reader && conversationIds.length) {
        await Promise.all(conversationIds.map((id) => markEmployeeThreadRead({ conversationId: id, readerUid: reader }).catch(() => {})));
      }
    } catch (err) {
      console.warn("employee messages load failed", err);
      setRows([]);
      setError("تعذر تحميل رسائل الموظفة.");
      setViewState("ready");
    } finally {
      setLoading(false);
    }
  }, [employeeKeys, isVisible, viewerUid]);

  useEffect(() => {
    void load();
  }, [load]);

  const unreadCount = useMemo(() => {
    const reader = cleanText(viewerUid);
    if (!reader) return 0;
    return rows.filter((row) => row.senderUid !== reader && !Array.isArray(row.readBy) || false).length +
      rows.filter((row) => row.senderUid !== reader && Array.isArray(row.readBy) && !row.readBy.map(cleanText).includes(reader)).length;
  }, [rows, viewerUid]);

  const lastMessage = rows[rows.length - 1] || null;

  const send = async () => {
    const senderUid = cleanText(viewerUid);
    const body = cleanText(draft);
    if (!canManage || saving) return;
    if (!senderUid) {
      setError("تعذر تحديد مستخدم الإدارة للإرسال.");
      return;
    }
    if (!targetUid) {
      setError("تعذر تحديد الموظفة للإرسال.");
      return;
    }
    if (!body) {
      setError("اكتب نص الرسالة قبل الإرسال.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setFailed(false);
    try {
      const id = conversationId || makeConversationId(senderUid, targetUid);
      await createEmployeeMessage({
        conversationId: id,
        threadId: id,
        senderUid,
        senderName: viewerName || "الإدارة",
        recipientUid: targetUid,
        recipientName: targetName,
        body,
        kind: "hr_to_employee",
      });

      await createEmployeeNotification({
        targetUid,
        targetEmployeeId: employeeId || targetUid,
        type: "message",
        title: "رسالة جديدة من الإدارة",
        body: body.slice(0, 140),
        route: "/employee/messages",
      }).catch(() => {});

      setDraft("");
      setMessage("تم إرسال الرسالة.");
      await load();
    } catch (err) {
      console.warn("employee message send failed", err);
      setFailed(true);
      setError("تعذر إرسال الرسالة.");
    } finally {
      setSaving(false);
    }
  };

  const markRead = async () => {
    const reader = cleanText(viewerUid);
    if (!reader || !rows.length) return;
    setSaving(true);
    setError("");
    try {
      const ids = Array.from(new Set(rows.map((row) => cleanText(row.conversationId)).filter(Boolean)));
      await Promise.all(ids.map((id) => markEmployeeThreadRead({ conversationId: id, readerUid: reader })));
      setMessage("تم تعليم المحادثة كمقروءة.");
      await load();
    } catch (err) {
      console.warn("employee messages mark read failed", err);
      setError("تعذر تعليم المحادثة كمقروءة.");
    } finally {
      setSaving(false);
    }
  };

  if (!isVisible) return null;

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-messages-live">
      <WorkspaceTabHeaderV2
        title="الرسائل"
        description="محادثة داخلية كاملة بحالة الموظفة والقراءة والمرفقات وإعادة محاولة الإرسال."
        badge={<WorkspaceStatusBadgeV2 tone={unreadCount ? "gold" : "success"}>{unreadCount ? `${unreadCount} غير مقروءة` : "جاهزة"}</WorkspaceStatusBadgeV2>}
      />

      {error ? <WorkspaceNoticeV2 title="تعذر تنفيذ العملية" description={error} tone="danger" action={<button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void load()}>إعادة المحاولة</button>} /> : null}
      {message ? <WorkspaceNoticeV2 title="تم تحديث المحادثة" description={message} tone="success" /> : null}

      <WorkspaceCardV2 title="حالة المحادثة" description="تبديل حالة العرض ومراجعة آخر قراءة دون مغادرة ملف الموظفة.">
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2 id="employee-message-state" label="حالة العرض">
            <DashboardSelectV2
              id="employee-message-state"
              value={loading ? "loading" : viewState}
              options={[
                { value: "ready", label: "محادثة موجودة" },
                { value: "empty", label: "لا توجد رسائل" },
                { value: "loading", label: "تحميل" },
              ]}
              onChange={setViewState}
            />
          </DashboardFieldV2>
          <div className="dsv2-ew-conversation-status">
            <span className="dsv2-ew-presence" aria-hidden="true" />
            <div>
              <strong>{targetName}</strong>
              <small>{lastMessage ? `آخر رسالة ${formatMessageTime(lastMessage.createdAt)}` : "لا توجد رسائل بعد"}</small>
            </div>
          </div>
        </div>
      </WorkspaceCardV2>

      {(loading || viewState === "loading") ? (
        <WorkspaceStateShowcaseV2 compact />
      ) : viewState === "empty" || !rows.length ? (
        <div className="dsv2-ew-inline-empty dsv2-ew-inline-empty--large">
          <strong>لا توجد رسائل بعد</strong>
          <span>ابدأ محادثة داخلية لتظهر هنا مع حالة القراءة والوقت.</span>
        </div>
      ) : (
        <WorkspaceCardV2 title="المحادثة الداخلية" description="الرسائل محفوظة ضمن ملف الموظفة وسجل الإدارة." className="dsv2-ew-chat-card">
          <div className="dsv2-ew-chat-head">
            <div className="dsv2-ew-chat-avatar">{initials(targetName)}</div>
            <div><strong>{targetName}</strong><span>{targetUid}</span></div>
            <WorkspaceStatusBadgeV2 tone="success">نشطة</WorkspaceStatusBadgeV2>
          </div>
          <div className="dsv2-ew-messages" aria-live="polite">
            {rows.map((item) => {
              const mine = cleanText(item.senderUid) === cleanText(viewerUid);
              const readBy = Array.isArray(item.readBy) ? item.readBy.map(cleanText) : [];
              const isUnread = !!viewerUid && !mine && !readBy.includes(cleanText(viewerUid));
              return (
                <div key={item.id} className={`dsv2-ew-message ${mine ? "dsv2-ew-message--admin" : "dsv2-ew-message--employee"}`} data-unread={isUnread ? "true" : undefined}>
                  <span className="dsv2-ew-message__sender">{mine ? "الإدارة" : item.senderName || targetName}</span>
                  <p>{item.body}</p>
                  <small>{formatMessageTime(item.createdAt)}{mine ? " · مرسلة ✓" : isUnread ? " · غير مقروءة" : " · مقروءة"}</small>
                </div>
              );
            })}
            {failed ? (
              <div className="dsv2-ew-message dsv2-ew-message--failed">
                <p>تعذر إرسال الرسالة.</p>
                <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void send()}>إعادة المحاولة</button>
              </div>
            ) : null}
          </div>
        </WorkspaceCardV2>
      )}

      <WorkspaceCardV2 title="كتابة رسالة" description="إرسال رسالة إدارية مباشرة إلى هذه الموظفة.">
        <div className="dsv2-ew-composer">
          <DashboardFieldV2 id="employee-message-input" label="نص الرسالة">
            <textarea
              id="employee-message-input"
              className="dsv2-textarea"
              value={draft}
              placeholder="اكتب رسالة داخلية للموظفة..."
              disabled={!canManage || saving}
              onChange={(event) => setDraft(event.target.value)}
            />
          </DashboardFieldV2>
          <div className="dsv2-ew-composer__actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled>إرفاق ملف</button>
            <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={!canManage || saving || !cleanText(draft)} onClick={() => void send()}>{saving ? "جارٍ الإرسال" : "إرسال"}</button>
          </div>
        </div>
      </WorkspaceCardV2>

      <WorkspaceCardV2 title="إدارة المحادثة" description="إجراءات السجل والحالة غير المقروءة.">
        <div className="dsv2-ew-action-list dsv2-ew-action-list--horizontal">
          <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={!viewerUid || saving || !rows.length} onClick={() => void markRead()}>تعليم الكل كمقروء</button>
          <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled>تنزيل سجل المحادثة</button>
        </div>
      </WorkspaceCardV2>
    </div>
  );
}
