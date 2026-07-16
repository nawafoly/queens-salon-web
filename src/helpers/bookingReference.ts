export type BookingReferenceInput = {
  id?: string | null;
  publicId?: string | null;
  date?: string | null;
};

function compactDate(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[1].slice(-2)}${match[2]}${match[3]}`;
}

function compactToken(value: unknown, length = 7): string {
  const token = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!token) return "";
  return token.slice(-Math.max(4, length));
}

export function formatBookingReference(
  booking: BookingReferenceInput | null | undefined
): string {
  const rawPublicId = String(booking?.publicId || "").trim().toUpperCase();
  if (/^QS-\d{6}-[A-Z0-9]{5,12}$/.test(rawPublicId)) return rawPublicId;
  if (/^MK-\d+$/.test(rawPublicId)) return rawPublicId;
  if (/^\d+$/.test(rawPublicId)) return `MK-${rawPublicId}`;

  const rawId = String(booking?.id || "").trim();
  const source = rawPublicId || rawId;
  if (!source) return "—";

  const datePart = compactDate(booking?.date);
  const suffix = compactToken(source, 7);
  if (datePart && suffix) return `QS-${datePart}-${suffix}`;
  if (suffix) return `QS-${suffix}`;
  return source;
}

// New booking references are allocated exclusively by Core D1 as MK-xxxxx.
// This helper remains only for rendering legacy rows that have no publicId.
export function buildBookingPublicId(
  bookingId: string,
  bookingDate: string
): string {
  const datePart = compactDate(bookingDate) || "000000";
  const suffix = compactToken(bookingId, 8) || "BOOKING";
  return `QS-${datePart}-${suffix}`;
}
