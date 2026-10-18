// Booking catalog DTO contracts used by the Core D1 booking data source.
// Preserve the legacy Arabic field names for existing booking consumers.

export type SectionDoc = {
  id: string;
  الاسم: string;
  // حقول إضافية اختيارية
  order?: number;
  active?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export type CategoryDoc = {
  id: string;
  الاسم: string;
  sectionId: string;
  order?: number;
  active?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export type ServiceDoc = {
  id: string;
  الاسم: string;
  sectionId: string;
  categoryId?: string | null;
  promoActive?: boolean;
  catalogPriceHalalas?: number | null;
  catalogPrice?: number | null;
  promoPriceHalalas?: number | null;
  السعر: number;
  المدة: number; // بالدقائق
  active?: boolean;
  createdAt?: any;
  updatedAt?: any;
};
