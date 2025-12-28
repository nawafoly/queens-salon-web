// src/helpers/servicesCatalog.ts
export type SalonService = {
    id: string;
    name: string;
    category: string;
    price: number; // SAR
    durationMins?: number;
  };
  
  export const SALON_SERVICES: SalonService[] = [
    { id: "haircut", name: "قص الشعر", category: "الشعر", price: 80, durationMins: 30 },
    { id: "haircolor", name: "صبغة الشعر", category: "الشعر", price: 250, durationMins: 120 },
    { id: "hairstyle", name: "تسريحات الشعر", category: "الشعر", price: 150, durationMins: 60 },
    { id: "hairtreat", name: "معالجات الشعر", category: "الشعر", price: 220, durationMins: 90 },
  
    { id: "makeup", name: "مكياج", category: "مكياج", price: 200, durationMins: 75 },
  
    { id: "nails", name: "العناية بالأظافر", category: "أظافر", price: 120, durationMins: 60 },
  
    { id: "skin", name: "العناية بالبشرة", category: "بشرة", price: 180, durationMins: 60 },
  
    { id: "wax", name: "إزالة الشعر", category: "إزالة الشعر", price: 140, durationMins: 45 },
  ];
  
  export function getServiceById(id: string) {
    return SALON_SERVICES.find((s) => s.id === id) || null;
  }
  