import { extractBookingPublicIdBase } from "./bookingDisplayUtils";
import { normalizeDigits, normalizeSearchText, phone10Digits } from "./bookingTextUtils";

export type ReceptionSearchKind = "empty" | "phone" | "publicId" | "name" | "id";

export type ReceptionSearchQuery = {
  kind: ReceptionSearchKind;
  value: string;
  publicIdCandidates: string[];
};

export type ReceptionSearchMatchArgs = {
  query: ReceptionSearchQuery;
  qName: string;
  qPhone: string;
  qPublicIds: string[];
  qDocId: string;
};

type ReceptionSearchCandidate = {
  nameCandidate: string;
  phoneCandidate: string;
  publicIdCandidate: string;
  publicBaseCandidate: string;
  publicDigitsCandidate: string;
  idCandidate: string;
};

export function normalizeSearchKey(raw: string) {
  return normalizeDigits(String(raw || "").trim());
}

export function classifySearchKey(q: string): ReceptionSearchQuery {
  const s = normalizeSearchKey(q);
  if (!s) return { kind: "empty", value: "", publicIdCandidates: [] };

  const digits10 = phone10Digits(s);
  if (/^05\d{8}$/.test(digits10)) {
    return { kind: "phone", value: digits10, publicIdCandidates: [] };
  }

  const compact = s.replace(/\s+/g, "").replace(/_/g, "-");
  const prefixed = compact.match(/^([A-Za-z]{2})-?(\d{1,12})$/);
  if (prefixed) {
    const prefix = prefixed[1].toUpperCase();
    const num = prefixed[2];
    const candidates = Array.from(
      new Set<string>([
        `${prefix}-${num}`,
        `${prefix}${num}`,
        compact.toUpperCase(),
      ])
    );
    return {
      kind: "publicId",
      value: `${prefix}-${num}`,
      publicIdCandidates: candidates,
    };
  }

  if (/^(mk|qs)\b/i.test(s) || /^mk[-_ ]?/i.test(s) || /^qs[-_ ]?/i.test(s)) {
    const cleaned = compact.toUpperCase();
    const m = cleaned.match(/^([A-Z]{2})-?(\d+)$/);
    if (m) {
      const prefix = m[1];
      const num = m[2];
      return {
        kind: "publicId",
        value: `${prefix}-${num}`,
        publicIdCandidates: [`${prefix}-${num}`, `${prefix}${num}`, cleaned],
      };
    }
    return { kind: "publicId", value: cleaned, publicIdCandidates: [cleaned] };
  }

  const onlyDigits = compact.replace(/\D/g, "");
  if (/^05\d{1,8}$/.test(onlyDigits)) {
    return { kind: "phone", value: onlyDigits, publicIdCandidates: [] };
  }
  if (onlyDigits && onlyDigits.length >= 3 && onlyDigits.length <= 12) {
    return {
      kind: "publicId",
      value: `MK-${onlyDigits}`,
      publicIdCandidates: [`MK-${onlyDigits}`, `MK${onlyDigits}`, onlyDigits],
    };
  }

  const hasLetters = /[A-Za-z\u0600-\u06FF]/.test(s);
  if (hasLetters) return { kind: "name", value: s.trim(), publicIdCandidates: [] };

  return { kind: "id", value: s, publicIdCandidates: [] };
}

export function isReceptionSearchCancelledStatus(raw: any) {
  const s = String(raw?.status || "").trim().toLowerCase();
  return s === "cancelled" || s === "canceled" || s === "rejected";
}

export function isReceptionSearchCompletedStatus(raw: any) {
  return String(raw?.status || "").trim().toLowerCase() === "completed";
}

function readReceptionSearchCandidate(raw: any): ReceptionSearchCandidate {
  const publicBaseCandidate = normalizeSearchText(extractBookingPublicIdBase(raw));
  return {
    nameCandidate: normalizeSearchText(
      String(raw?.clientName || raw?.name || raw?.fullName || "")
    ),
    phoneCandidate: phone10Digits(
      String(raw?.clientPhone || raw?.phone || raw?.mobile || "")
    ),
    publicIdCandidate: normalizeSearchText(
      String(raw?.publicId || raw?.trackPublicId || raw?.mk || "")
    ),
    publicBaseCandidate,
    publicDigitsCandidate: String(publicBaseCandidate || "").replace(/\D/g, ""),
    idCandidate: normalizeSearchText(String(raw?.id || raw?.bookingId || "")),
  };
}

function matchesReceptionSearchStrict(
  raw: any,
  { query, qName, qPhone, qPublicIds, qDocId }: ReceptionSearchMatchArgs
) {
  const {
    nameCandidate,
    phoneCandidate,
    publicIdCandidate,
    publicBaseCandidate,
    publicDigitsCandidate,
    idCandidate,
  } = readReceptionSearchCandidate(raw);

  if (query.kind === "phone") {
    return !!qPhone && qPhone.length === 10 && phoneCandidate === qPhone;
  }

  if (query.kind === "publicId") {
    return qPublicIds.some((needle) => {
      const needleDigits = String(needle || "").replace(/\D/g, "");
      return (
        publicIdCandidate === needle ||
        publicBaseCandidate === needle ||
        (!!needleDigits && publicDigitsCandidate === needleDigits)
      );
    });
  }

  if (query.kind === "name") {
    return !!qName && (nameCandidate === qName || nameCandidate.startsWith(`${qName} `));
  }

  if (query.kind === "id") return !!qDocId && idCandidate === qDocId;

  return (
    (!!qPhone && qPhone.length === 10 && phoneCandidate === qPhone) ||
    (!!qName && (nameCandidate === qName || nameCandidate.startsWith(`${qName} `))) ||
    (!!qDocId && idCandidate === qDocId)
  );
}

export function matchesReceptionSearchLoose(
  raw: any,
  { query, qName, qPhone, qPublicIds, qDocId }: ReceptionSearchMatchArgs
) {
  const {
    nameCandidate,
    phoneCandidate,
    publicIdCandidate,
    publicBaseCandidate,
    idCandidate,
  } = readReceptionSearchCandidate(raw);

  if (query.kind === "phone") return !!qPhone && phoneCandidate.includes(qPhone);

  if (query.kind === "publicId") {
    return qPublicIds.some(
      (needle) => publicIdCandidate.includes(needle) || publicBaseCandidate.includes(needle)
    );
  }

  if (query.kind === "name") return !!qName && nameCandidate.includes(qName);
  if (query.kind === "id") return !!qDocId && idCandidate.includes(qDocId);

  return (
    (!!qPhone && phoneCandidate.includes(qPhone)) ||
    (!!qName &&
      (nameCandidate.includes(qName) ||
        publicIdCandidate.includes(qName) ||
        publicBaseCandidate.includes(qName))) ||
    (!!qDocId && idCandidate.includes(qDocId))
  );
}

export function matchesReceptionSearchCancelledStrict(
  raw: any,
  args: ReceptionSearchMatchArgs
) {
  return matchesReceptionSearchStrict(raw, args);
}

export function matchesReceptionSearchCompletedStrict(
  raw: any,
  args: ReceptionSearchMatchArgs
) {
  return matchesReceptionSearchStrict(raw, args);
}

export function matchesReceptionSearchBooking(raw: any, args: ReceptionSearchMatchArgs) {
  if (isReceptionSearchCompletedStatus(raw)) {
    return matchesReceptionSearchCompletedStrict(raw, args);
  }
  if (isReceptionSearchCancelledStatus(raw)) {
    return matchesReceptionSearchCancelledStrict(raw, args);
  }
  return matchesReceptionSearchLoose(raw, args);
}

export function normalizeCreatedAtToEpoch(raw: any) {
  if (!raw) return 0;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof raw?.toDate === "function") {
    const t = raw.toDate();
    return t instanceof Date ? t.getTime() : 0;
  }
  if (Number.isFinite(raw?.seconds)) {
    const sec = Number(raw.seconds);
    const ns = Number(raw.nanoseconds || 0);
    return sec * 1000 + Math.floor(ns / 1_000_000);
  }
  return 0;
}

export function sortBookingsByCreatedAtDesc(rows: any[]) {
  return [...(Array.isArray(rows) ? rows : [])].sort(
    (a, b) => normalizeCreatedAtToEpoch(b?.createdAt) - normalizeCreatedAtToEpoch(a?.createdAt)
  );
}
