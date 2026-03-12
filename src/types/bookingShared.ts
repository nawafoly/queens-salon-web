import type { PackageServiceItem } from "../services/firestorePackages";

export type CartItem = {
  id: string; // local id
  packageRunId?: string;
  serviceId: string;
  serviceName: string;
  offerSourceId?: string;
  offerSourceCode?: string;
  offerSourceTitle?: string;
  packageId?: string;
  packageSnapshot?: {
    packageId: string;
    packageName: string;
    finalPriceAtBooking: number;
    baseTotalPriceAtBooking: number;
    totalDurationMinAtBooking: number;
    serviceIds: string[];
    services: PackageServiceItem[];
  };
  serviceSectionId: string; // ✅ القسم الحقيقي للخدمة وقت الإضافة
  serviceSectionTitle?: string; // ✅ اسم القسم وقت الإضافة (للقواعد المرنة)
  serviceCategoryId?: string; // ✅ للتوافق (اختياري)
  serviceCategoryName?: string; // ✅ لو التصنيف نصي (للـ legacy)

  serviceBasePrice?: number; // ✅ سعر الخدمة الأساسي قبل أي رسوم إضافية
  basePrice: number;
  priceText: string;
  durationMin: number;

  employeeId: string; // staff_public doc id
  employeeUid?: string; // linkedUid
  employeeName?: string;

  date: string; // YYYY-MM-DD
  time: string; // ✅ نخزن 24h "HH:MM" (value24)

  locked?: boolean; // ✅ هل الكرت تم تأكيده؟
  toolsSource?: "client" | "salon"; // ✅ أدوات الخدمة: من العميلة أو من الصالون
  toolsFeeApplied?: number; // ✅ الرسوم المضافة بسبب الأدوات (إن وجدت)
  sequenceOfferId?: string;
  sequenceOfferTitle?: string;
  sequenceStepsSnapshot?: Array<{
    serviceId: string;
    orderIndex: number;
    gapAfterMin: number;
    titleSnapshot?: string;
    serviceNameAtBooking: string;
    priceAtBooking: number;
    durationAtBooking: number;
    sectionIdAtBooking?: string;
  }>;
};

export interface BookingFormData {
  name: string;
  phone: string;
  note?: string;

  // ✅ سلة خدمات: كل خدمة لها (موظفة/تاريخ/وقت)
  items: CartItem[];
}
