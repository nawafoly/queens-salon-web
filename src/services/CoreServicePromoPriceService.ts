import { coreApiRequest } from "./coreApiClient";

export type ServicePromoPrice = {
  id: string;
  service_id: string;
  service_name?: string;
  service_catalog_price_halalas?: number;
  catalog_price_halalas: number;
  promo_price_halalas: number;
  starts_at: string;
  ends_at: string;
  is_active: number;
  note?: string | null;
};

export const CoreServicePromoPriceService = {
  list(query: Record<string, string> = {}) {
    return coreApiRequest<ServicePromoPrice[]>("/api/core/service-promo-prices", { query });
  },
  active(serviceId: string) {
    return coreApiRequest<ServicePromoPrice | null>("/api/core/service-promo-prices/active", { query: { serviceId } });
  },
  create(input: { id?: string; serviceId: string; promoPriceHalalas: number; startsAt: string; endsAt: string; note?: string }) {
    return coreApiRequest<ServicePromoPrice>("/api/core/service-promo-prices", { method: "POST", body: input });
  },
  deactivate(id: string) {
    return coreApiRequest<{ ok: boolean }>(`/api/core/service-promo-prices/${encodeURIComponent(id)}/deactivate`, { method: "POST" });
  },
};
