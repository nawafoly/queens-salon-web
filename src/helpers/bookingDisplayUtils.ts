import { roundMoney2 } from "./bookingPaymentUtils";
import { pickEffectivePrice as resolveEffectiveSeasonPrice } from "./seasonPricing";
import { phone10Digits } from "./bookingTextUtils";

export function formatQuickClientLastUsed(lastUsedAt: number): string {
  if (!Number.isFinite(lastUsedAt) || lastUsedAt <= 0) return "";
  try {
    return new Intl.DateTimeFormat("ar-SA-u-nu-latn", { day: "2-digit", month: "2-digit" }).format(
      new Date(lastUsedAt)
    );
  } catch {
    return "";
  }
}

export function formatQuickClientButtonLabel(candidate: any): string {
  const name = String(candidate?.name || candidate?.fullName || "بدون اسم").trim();
  const phone = phone10Digits(candidate?.phone || candidate?.mobile || candidate?.clientPhone || "");
  const phoneTail = phone ? phone.slice(-4) : "";
  const lastUsed = formatQuickClientLastUsed(Number(candidate?.quickLastUsedAt || 0));
  const pieces = [name];
  if (phoneTail) pieces.push(phoneTail);
  if (lastUsed) pieces.push(lastUsed);
  return pieces.join(" • ");
}

export function readBookingSectionLabel(booking: any) {
  return String(
    booking?.serviceSectionTitle ||
      booking?.serviceSnapshot?.sectionTitleAtBooking ||
      booking?.serviceSnapshot?.sectionIdAtBooking ||
      booking?.serviceSectionId ||
      ""
  ).trim();
}

export function readBookingCategoryLabel(booking: any) {
  return String(
    booking?.serviceCategoryName ||
      booking?.serviceSnapshot?.categoryNameAtBooking ||
      booking?.serviceSnapshot?.categoryIdAtBooking ||
      booking?.serviceCategoryId ||
      ""
  ).trim();
}

export function extractBookingPublicIdBase(booking: any) {
  const raw = String(booking?.publicId || booking?.trackPublicId || booking?.mk || "")
    .trim()
    .toUpperCase();
  if (!raw) return "";
  const m = raw.match(/^(MK-\d+)(?:-\d+)?$/i);
  return m ? m[1].toUpperCase() : raw;
}

export function resolveBookingBlockKey(booking: any) {
  const groupId = String(booking?.bookingGroupId || booking?.parentBookingId || "").trim();
  if (groupId) return `group:${groupId}`;

  const raw = String(booking?.publicId || booking?.trackPublicId || booking?.mk || "")
    .trim()
    .toUpperCase();
  const base = extractBookingPublicIdBase(booking);
  if (base && raw && raw.startsWith(`${base}-`)) return `public:${base}`;

  const id = String(booking?.id || booking?.bookingId || raw || "").trim();
  return `single:${id || "unknown"}`;
}

export function formatSarDisplay(value: any, fractionDigits = 0, unit = "ريال") {
  const amount = Number(value || 0);
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${safe.toFixed(fractionDigits)} ${unit}`;
}

export function formatInternalPaymentDraftSummary(
  totalAmountRaw: any,
  paymentType: "full" | "partial" | "none",
  paidAmountRaw: any
) {
  const total = roundMoney2(Math.max(0, Number(totalAmountRaw || 0)));
  const paid =
    paymentType === "none"
      ? 0
      : paymentType === "full"
      ? total
      : roundMoney2(Math.max(0, Number(paidAmountRaw || 0)));
  const remaining = roundMoney2(Math.max(0, total - paid));

  if (paymentType === "none") {
    return `بدون دفع الآن - المتبقي ${remaining} ر.س`;
  }
  return `دفعت ${paid} ر.س - المتبقي ${remaining} ر.س`;
}

export function formatConfirmExistingBookingPaymentSummary(totalAmountRaw: any) {
  const total = roundMoney2(Math.max(0, Number(totalAmountRaw || 0)));
  const paid = roundMoney2(total);
  const remaining = roundMoney2(Math.max(0, total - paid));
  return `دفع كامل: ${paid} ر.س - المتبقي بعد التأكيد: ${remaining} ر.س`;
}

export function formatServicePickerPriceText(args: {
  basePrice: any;
  seasonPrice?: any;
  appSettings: any;
  dateISO: string;
}) {
  const eff = resolveEffectiveSeasonPrice({
    basePrice: Number(args.basePrice || 0),
    seasonPrice: Number(args.seasonPrice || 0) || undefined,
    appSettings: args.appSettings,
    dateISO: String(args.dateISO || "").trim(),
  });
  return formatSarDisplay(eff.price, 0);
}

export function formatItemToolsNoteText(
  toolsSourceRaw: any,
  toolsFeeAppliedRaw: any,
  defaultToolsFeeRaw: any
) {
  const source = String(toolsSourceRaw || "").trim() === "salon" ? "salon" : "client";
  if (source === "salon") {
    const fee = Math.max(0, Number(toolsFeeAppliedRaw || defaultToolsFeeRaw || 0));
    return `الأدوات: من المشغل (+${fee} ريال)`;
  }
  return "الأدوات: من العميلة (بدون رسوم)";
}
