// src/helpers/bookingsNormalize.ts

export type NormalizedBooking = any;

const safeNumber = (n: any, fallback = 0) => {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
};

export const normalizeBooking = (b: any): NormalizedBooking => {
  const discountAmount = safeNumber(b?.discountAmount, 0);

  // total عندك هو السعر النهائي (بعد الخصم) في الحجوزات الجديدة
  // بس الحجوزات القديمة ممكن total=0 أو غير موجود
  const total =
    safeNumber(b?.total, 0) ||
    safeNumber(b?.finalPrice, 0) ||
    safeNumber(b?.price, 0) ||
    safeNumber(b?.servicePrice, 0);

  return {
    ...b,
    discountAmount,
    offerTitle: b?.offerTitle ?? null,
    offerId: b?.offerId ?? null,
    couponCode: b?.couponCode ?? "",
    finalPrice: safeNumber(b?.finalPrice, 0) || total,
    total,
  };
};

export const normalizeBookings = (arr: any[]): NormalizedBooking[] => {
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeBooking);
};
