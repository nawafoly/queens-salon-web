export type DiscountType = "fixed" | "percent";

export type Offer = {
  id: string;
  title: string;
  code: string;
  discountType: DiscountType;
  value: number;
  startDate: string;
  endDate: string;
  active: boolean;
  usageCount: number;
  createdAt: string;
};

const KEY = "dashboard_offers_v1";

const uid = () => `offer_${Date.now()}_${Math.random().toString(16).slice(2)}`;

export const OfferService = {
  getAll(): Offer[] {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveAll(list: Offer[]) {
    localStorage.setItem(KEY, JSON.stringify(list));
  },

  add(data: Omit<Offer, "id" | "createdAt" | "usageCount">) {
    const list = this.getAll();
    const offer: Offer = {
      id: uid(),
      usageCount: 0,
      createdAt: new Date().toISOString(),
      ...data,
    };
    this.saveAll([...list, offer]);
  },

  update(id: string, patch: Partial<Offer>) {
    const list = this.getAll();
    const idx = list.findIndex(o => o.id === id);
    if (idx === -1) return;
    list[idx] = { ...list[idx], ...patch };
    this.saveAll(list);
  },

  remove(id: string) {
    const list = this.getAll();
    const offer = list.find(o => o.id === id);
    if (!offer || offer.usageCount > 0) return false;
    this.saveAll(list.filter(o => o.id !== id));
    return true;
  }
};
