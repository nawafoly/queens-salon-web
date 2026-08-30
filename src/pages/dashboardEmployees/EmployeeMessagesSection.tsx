import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createEmployeeMessage,
  listEmployeeMessages,
  markEmployeeThreadRead,
  type EmployeeMessage,
} from "../../services/employeeHub";
import {
  DashboardFieldV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import {
  WorkspaceCardV2,
  WorkspaceNoticeV2,
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
    if (typeof maybe.toMillis === "function") {
      const ms = maybe.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof maybe.seconds === "number") return maybe.seconds * 1000 + Math.floor((maybe.nanoseconds || 0) / 1_000_000);
  }
  return 0;
}

function formatMessageTime(value: unknown, includeDate = true) {
  const ms = toMillis(value);
  if (!ms) return "الآن";
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
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

function readByList(value: unknown) {
  return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
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
  const [failed, setFailed] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const targetUid = cleanText(employeeUid || employeeId);
  const targetName = cleanText(employeeName) || "الموظفة";
  const conversationId = useMemo(() => makeConversationId(viewerUid || "", targetUid), [targetUid, viewerUid]);

  const employeeKeys = useMemo(() => {
    return new Set([cleanText(employeeId), cleanText(employeeUid)].filter(Boolean));
  }, [employeeId, employeeUid]);

  const load = useCallback(async () => {
    if (!isVisible || !employeeKeys.size) return;
    setLoading(true);
    setError("");
    try {
      const all = await listEmployeeMessages(500);
      const visible = all
        .filter((item) => messageMatchesEmployee(item, employeeKeys))
        .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      setRows(visible);

      const reader = cleanText(viewerUid);
      const conversationIds = Array.from(new Set(visible.map((item) => cleanText(item.conversationId)).filter(Boolean)));
      if (reader && conversationIds.length) {
        await Promise.all(conversationIds.map((id) => markEmployeeThreadRead({ conversationId: id, readerUid: reader }).catch(() => {})));
      }
    } catch (err) {
      console.warn("employee messages load failed", err);
      setError("تعذر تحميل رسائل الموظفة.");
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
    return rows.filter((row) => cleanText(row.senderUid) !== reader && !readByList(row.readBy).includes(reader)).length;
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
      const ids: string[] = Array.from(new Set<string>(rows.map((row) => cleanText(row.conversationId)).filter(Boolean)));
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

  const state: "loading" | "error" | "empty" | "ready" = loading && !rows.length
    ? "loading"
    : error && !rows.length
      ? "error"
      : rows.length
        ? "ready"
        : "empty";
  const stateLabel = state === "loading"
    ? "جاري التحميل"
    : state === "error"
      ? "تعذر التحميل"
      : state === "ready"
        ? "محادثة موجودة"
        : "لا توجد رسائل";

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-messages-live" data-dsv2-ignore-dirty="true">
      <WorkspaceTabHeaderV2
        title="الرسائل"
        description="محادثة داخلية كاملة بحالة الموظفة والقراءة والمرفقات وإعادة محاولة الإرسال."
        badge={<WorkspaceStatusBadgeV2 tone={unreadCount ? "gold" : state === "error" ? "danger" : "success"}>{unreadCount ? `${unreadCount} غير مقروءة` : stateLabel}</WorkspaceStatusBadgeV2>}
      />

      {error && rows.length ? <WorkspaceNoticeV2 title="تعذر تحديث المحادثة" description="احتفظنا بالرسائل الحالية. أعد المحاولة بعد التحقق من الاتصال." tone="danger" action={<button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void load()}>إعادة المحاولة</button>} /> : null}
      {message ? <WorkspaceNoticeV2 title="تم تحديث المحادثة" description={message} tone="success" /> : null}

      <WorkspaceCardV2 title="حالة المحادثة" description="تظهر تلقائيًا حسب تحميل البيانات ووجود الرسائل.">
        <div className="dsv2-ew-conversation-status dsv2-ew-conversation-status--single">
          <span className="dsv2-ew-presence" aria-hidden="true" data-state={state} />
          <div>
            <strong>{targetName}</strong>
            <small>{lastMessage ? `آخر رسالة ${formatMessageTime(lastMessage.createdAt)}` : targetUid || "لا توجد رسائل بعد"}</small>
          </div>
          <WorkspaceStatusBadgeV2 tone={state === "error" ? "danger" : state === "loading" ? "gold" : rows.length ? "success" : "default"}>{stateLabel}</WorkspaceStatusBadgeV2>
        </div>
      </WorkspaceCardV2>

      {state === "loading" ? (
        <WorkspaceCardV2 title="المحادثة الداخلية" description="جاري تحميل رسائل الموظفة وسجل القراءة.">
          <article className="dsv2-ew-skeleton dsv2-ew-chat-loading" aria-label="جاري تحميل رسائل الموظفة">
            <DashboardSkeletonV2 variant="title" width="44%" />
            <DashboardSkeletonV2 lines={3} />
            <DashboardSkeletonV2 variant="block" height={92} />
          </article>
        </WorkspaceCardV2>
      ) : state === "error" ? (
        <WorkspaceNoticeV2
          title="تعذر تحميل المحادثة"
          description="احتفظنا بالرسائل الحالية إن وجدت. أعد المحاولة بعد التحقق من الاتصال."
          tone="danger"
          action={<button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void load()}>إعادة المحاولة</button>}
        />
      ) : state === "empty" ? (
        <WorkspaceCardV2 title="المحادثة الداخلية" description="الرسائل محفوظة ضمن ملف الموظفة وسجل الإدارة." className="dsv2-ew-chat-card">
          <div className="dsv2-ew-chat-head">
            <div className="dsv2-ew-chat-avatar">{initials(targetName)}</div>
            <div><strong>{targetName}</strong><span>{targetUid || "لا يوجد معرف موظفة"}</span></div>
            <WorkspaceStatusBadgeV2>لا توجد رسائل</WorkspaceStatusBadgeV2>
          </div>
          <div className="dsv2-ew-inline-empty dsv2-ew-inline-empty--large">
            <strong>لا توجد رسائل بعد</strong>
            <span>ابدأ محادثة داخلية لتظهر هنا مع حالة القراءة والوقت.</span>
            <button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" onClick={() => composerRef.current?.focus()}>بدء محادثة</button>
          </div>
        </WorkspaceCardV2>
      ) : (
        <WorkspaceCardV2 title="المحادثة الداخلية" description="الرسائل محفوظة ضمن ملف الموظفة وسجل الإدارة." className="dsv2-ew-chat-card">
          <div className="dsv2-ew-chat-head">
            <div className="dsv2-ew-chat-avatar">{initials(targetName)}</div>
            <div><strong>{targetName}</strong><span>{targetUid}</span></div>
            <WorkspaceStatusBadgeV2 tone="success">متصلة</WorkspaceStatusBadgeV2>
          </div>
          <div className="dsv2-ew-messages" aria-live="polite">
            {rows.map((item) => {
              const mine = cleanText(item.senderUid) === cleanText(viewerUid);
              const isUnread = !!viewerUid && !mine && !readByList(item.readBy).includes(cleanText(viewerUid));
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
              ref={composerRef}
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
