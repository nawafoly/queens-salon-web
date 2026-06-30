import {
  EMPLOYEE_CONVERSATION_TYPES,
  EMPLOYEE_MESSAGE_TYPES,
  type EmployeeConversationType,
  type EmployeeMessageDoc,
  type EmployeeMessageRole,
  type EmployeeMessageStatus,
  type EmployeeMessageType,
} from "../../types/hrEmployee";

function toDateSafe(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value !== null) {
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof maybeTimestamp.toDate === "function") {
      const date = maybeTimestamp.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof maybeTimestamp.seconds === "number") {
      const date = new Date(maybeTimestamp.seconds * 1000 + Math.floor((maybeTimestamp.nanoseconds || 0) / 1000000));
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateEN(date: Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function formatNumberEN(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat("en-US", options).format(value);
}
function resolveEmployeeAvatarUrl(
  explicitAvatarUrl?: unknown,
  fallbackInput?: Record<string, unknown>
) {
  const explicit = String(explicitAvatarUrl || "").trim();
  if (explicit) return explicit;
  return String(fallbackInput?.avatarUrl || "").trim();
}
export const EMPLOYEE_MESSAGE_TYPE_OPTIONS: Array<{
  value: EmployeeMessageType;
  label: string;
}> = [
  { value: "message", label: "ط±ط³ط§ظ„ط©" },
  { value: "notice", label: "طھظ†ط¨ظٹظ‡" },
  { value: "system", label: "ط¥ط´ط¹ط§ط± ظ†ط¸ط§ظ…" },
];

export const EMPLOYEE_CONVERSATION_TYPE_OPTIONS: Array<{
  value: EmployeeConversationType;
  label: string;
}> = [
  { value: "hr_to_employee", label: "ط±ط³ط§ط¦ظ„ HR" },
  { value: "employee_to_employee", label: "ظ…ط­ط§ط¯ط«ط© ط¯ط§ط®ظ„ظٹط©" },
];

export type EmployeeMessageRecord = EmployeeMessageDoc & {
  id: string;
  conversationId: string;
  threadId: string;
  conversationType: EmployeeConversationType;
  participantUids: string[];
  senderUid: string;
  senderRole: EmployeeMessageRole;
  recipientUid: string;
  body: string;
  messageType: EmployeeMessageType;
  status: EmployeeMessageStatus;
  createdAtDate: Date | null;
  readAtDate: Date | null;
  conversationTypeLabel: string;
  typeLabel: string;
  preview: string;
};

export type EmployeeMessageConversationRecord = {
  id: string;
  conversationId: string;
  threadId: string;
  employeeId: string | null;
  employeeUid: string;
  conversationType: EmployeeConversationType;
  conversationTypeLabel: string;
  participantUids: string[];
  counterpartyUid: string;
  counterpartyName: string;
  counterpartyEmail: string | null;
  counterpartyPhoto: string | null;
  messages: EmployeeMessageRecord[];
  latestMessage: EmployeeMessageRecord;
  lastMessageAt: unknown;
  lastMessageAtDate: Date | null;
  unreadCount: number;
};

function pickText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && text !== "undefined" && text !== "null") return text;
  }
  return "";
}

function normalizeMessageType(value: unknown) {
  const normalized = String(value || "message").trim().toLowerCase();
  return (EMPLOYEE_MESSAGE_TYPES.some(type => type === normalized)
    ? normalized
    : "message") as EmployeeMessageType;
}

function normalizeConversationType(
  value: unknown,
  raw: Record<string, any> | null | undefined
) {
  const normalized = String(value || "").trim().toLowerCase();
  if (EMPLOYEE_CONVERSATION_TYPES.some(type => type === normalized)) {
    return normalized as EmployeeConversationType;
  }

  if (pickText(raw?.employeeUid)) {
    return "hr_to_employee" as EmployeeConversationType;
  }

  return "hr_to_employee" as EmployeeConversationType;
}

function normalizeMessageRole(
  value: unknown,
  options: { senderUid?: string; employeeUid?: string }
) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized) return normalized as EmployeeMessageRole;
  if (options.senderUid && options.employeeUid && options.senderUid === options.employeeUid) {
    return "employee";
  }
  return "hr";
}

function normalizeMessageStatus(value: unknown, isRead: boolean) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized) return normalized as EmployeeMessageStatus;
  return isRead ? "read" : "sent";
}

export function getEmployeeMessageTypeLabel(value: unknown) {
  const normalized = normalizeMessageType(value);
  return (
    EMPLOYEE_MESSAGE_TYPE_OPTIONS.find(option => option.value === normalized)?.label ||
    "ط±ط³ط§ظ„ط©"
  );
}

export function getEmployeeConversationTypeLabel(
  value: unknown,
  raw?: Record<string, any> | null
) {
  const normalized = normalizeConversationType(value, raw);
  return (
    EMPLOYEE_CONVERSATION_TYPE_OPTIONS.find(option => option.value === normalized)
      ?.label || "ط±ط³ط§ط¦ظ„ HR"
  );
}

export function buildEmployeeMessageParticipants(...values: Array<unknown>) {
  return Array.from(
    new Set(
      values
        .map(value => String(value ?? "").trim())
        .filter(value => value && value !== "undefined" && value !== "null")
    )
  );
}

export function buildEmployeePeerConversationId(
  leftUid: string,
  rightUid: string
) {
  const participants = buildEmployeeMessageParticipants(leftUid, rightUid).sort();
  return participants.length === 2
    ? `employee_to_employee__${participants[0]}__${participants[1]}`
    : "";
}

function resolveParticipantUids(
  raw: Record<string, any> | null | undefined,
  senderUid: string,
  recipientUid: string
) {
  const explicitParticipants = Array.isArray(raw?.participantUids)
    ? raw.participantUids
    : [];

  return buildEmployeeMessageParticipants(
    ...explicitParticipants,
    senderUid,
    recipientUid,
    raw?.employeeUid
  );
}

function resolveCounterparty(
  timeline: EmployeeMessageRecord[],
  viewerUid?: string | null
) {
  const fallback = {
    uid: "",
    name: "",
    email: null as string | null,
    photo: null as string | null,
  };

  if (!timeline.length) return fallback;

  if (!viewerUid) {
    const latestMessage = timeline[timeline.length - 1];
    return {
      uid: latestMessage.fromUserId || latestMessage.senderUid || "",
      name: latestMessage.fromUserName || latestMessage.toUserName || "",
      email: latestMessage.fromUserEmail || latestMessage.toUserEmail || null,
      photo: latestMessage.fromUserPhoto || latestMessage.toUserPhoto || null,
    };
  }

  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const message = timeline[index];

    if ((message.fromUserId || message.senderUid) !== viewerUid) {
      return {
        uid: message.fromUserId || message.senderUid || "",
        name: message.fromUserName || "",
        email: message.fromUserEmail || null,
        photo: message.fromUserPhoto || null,
      };
    }

    if ((message.toUserId || message.recipientUid) !== viewerUid) {
      return {
        uid: message.toUserId || message.recipientUid || "",
        name: message.toUserName || "",
        email: message.toUserEmail || null,
        photo: message.toUserPhoto || null,
      };
    }
  }

  return fallback;
}

export function normalizeEmployeeMessageRecord(
  id: string,
  raw: Record<string, any> | null | undefined
): EmployeeMessageRecord {
  const message = pickText(raw?.body, raw?.message);
  const normalizedType = normalizeMessageType(raw?.messageType ?? raw?.type);
  const senderUid = pickText(raw?.senderUid, raw?.fromUserId);
  const recipientUid = pickText(raw?.recipientUid, raw?.toUserId);
  const conversationType = normalizeConversationType(raw?.conversationType, raw);
  const conversationId = pickText(raw?.conversationId, raw?.threadId) || id;
  const threadId = pickText(raw?.threadId, raw?.conversationId) || conversationId;
  const isRead = Boolean(raw?.isRead);
  const senderRole = normalizeMessageRole(raw?.senderRole, {
    senderUid,
    employeeUid: pickText(raw?.employeeUid),
  });
  const status = normalizeMessageStatus(raw?.status, isRead);
  const participantUids = resolveParticipantUids(raw, senderUid, recipientUid);

  return {
    id,
    employeeId: pickText(raw?.employeeId) || null,
    employeeUid: pickText(raw?.employeeUid) || null,
    conversationId,
    threadId,
    conversationType,
    participantUids,
    senderUid,
    senderRole,
    recipientUid,
    messageType: normalizedType,
    body: message,
    status,
    fromUserId: senderUid,
    fromUserName: pickText(raw?.fromUserName) || null,
    fromUserEmail: pickText(raw?.fromUserEmail) || null,
    fromUserPhoto: resolveEmployeeAvatarUrl(
      pickText(raw?.fromUserPhoto, raw?.fromUserAvatar, raw?.senderPhoto),
      {
        uid: senderUid,
        name: raw?.fromUserName,
        email: raw?.fromUserEmail,
      }
    ),
    toUserId: recipientUid,
    toUserName: pickText(raw?.toUserName) || null,
    toUserEmail: pickText(raw?.toUserEmail) || null,
    toUserPhoto: resolveEmployeeAvatarUrl(
      pickText(raw?.toUserPhoto, raw?.toUserAvatar, raw?.recipientPhoto),
      {
        uid: recipientUid,
        name: raw?.toUserName,
        email: raw?.toUserEmail,
      }
    ),
    message,
    type: normalizedType,
    relatedTo: pickText(raw?.relatedTo) || null,
    relatedId: pickText(raw?.relatedId) || null,
    createdAt: raw?.createdAt ?? null,
    isRead,
    readAt: raw?.readAt ?? null,
    updatedAt: raw?.updatedAt ?? null,
    createdAtDate: toDateSafe(raw?.createdAt),
    readAtDate: toDateSafe(raw?.readAt),
    conversationTypeLabel: getEmployeeConversationTypeLabel(
      conversationType,
      raw
    ),
    typeLabel: getEmployeeMessageTypeLabel(normalizedType),
    preview: message.length > 120 ? `${message.slice(0, 117).trim()}...` : message,
  };
}

export function sortEmployeeMessages<T extends EmployeeMessageDoc>(messages: T[]) {
  return [...messages].sort((left, right) => {
    const leftTime = toDateSafe(left.createdAt)?.getTime() ?? 0;
    const rightTime = toDateSafe(right.createdAt)?.getTime() ?? 0;
    return rightTime - leftTime;
  });
}

export function sortEmployeeMessagesChronologically<T extends EmployeeMessageDoc>(
  messages: T[]
) {
  return [...messages].sort((left, right) => {
    const leftTime = toDateSafe(left.createdAt)?.getTime() ?? 0;
    const rightTime = toDateSafe(right.createdAt)?.getTime() ?? 0;
    return leftTime - rightTime;
  });
}

export function groupEmployeeMessageConversations(
  messages: EmployeeMessageRecord[],
  viewerUid?: string | null
) {
  const grouped = new Map<string, EmployeeMessageRecord[]>();

  messages.forEach(message => {
    const key = pickText(message.conversationId, message.threadId, message.id) || message.id;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(message);
      return;
    }
    grouped.set(key, [message]);
  });

  return Array.from(grouped.entries())
    .map(([conversationId, group]) => {
      const timeline = sortEmployeeMessagesChronologically(group);
      const latestMessage = timeline[timeline.length - 1];
      const counterparty = resolveCounterparty(timeline, viewerUid);
      return {
        id: conversationId,
        conversationId,
        threadId: latestMessage.threadId || conversationId,
        employeeId:
          latestMessage.employeeId ||
          timeline.find(message => pickText(message.employeeId))?.employeeId ||
          null,
        employeeUid:
          latestMessage.employeeUid ||
          timeline.find(message => pickText(message.employeeUid))?.employeeUid ||
          "",
        conversationType: latestMessage.conversationType,
        conversationTypeLabel: latestMessage.conversationTypeLabel,
        participantUids: buildEmployeeMessageParticipants(
          ...timeline.flatMap(message => message.participantUids || [])
        ),
        counterpartyUid: counterparty.uid,
        counterpartyName:
          counterparty.name ||
          (latestMessage.conversationType === "employee_to_employee"
            ? "ظ…ظˆط¸ظپ"
            : "HR"),
        counterpartyEmail: counterparty.email,
        counterpartyPhoto: resolveEmployeeAvatarUrl(counterparty.photo, {
          uid: counterparty.uid,
          name: counterparty.name,
          email: counterparty.email,
        }),
        messages: timeline,
        latestMessage,
        lastMessageAt: latestMessage.createdAt ?? null,
        lastMessageAtDate: latestMessage.createdAtDate,
        unreadCount: viewerUid
          ? timeline.filter(message => message.toUserId === viewerUid && !message.isRead).length
          : 0,
      } satisfies EmployeeMessageConversationRecord;
    })
    .sort((left, right) => {
      const leftTime = left.lastMessageAtDate?.getTime() ?? 0;
      const rightTime = right.lastMessageAtDate?.getTime() ?? 0;
      return rightTime - leftTime;
    });
}

