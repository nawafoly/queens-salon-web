export type SeasonPriceResult = {
  price: number;
  label: string;
  usedSeason: boolean;
};

export function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function resolvePricingDate(dateISO?: string) {
  const raw = String(dateISO || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return todayISO();
}

export function isDateInRange(dateISO: string, startISO: string, endISO: string) {
  if (!dateISO) return false;
  if (startISO && dateISO < startISO) return false;
  if (endISO && dateISO > endISO) return false;
  return true;
}

export function isSeasonEnabledForDate(appSettings: any, dateISO: string) {
  const season = (appSettings as any)?.catalogSeasonPricing || {};
  const enabled = !!season.enabled;
  const start = String(season.startDate || season.from || "").trim();
  const end = String(season.endDate || season.to || "").trim();

  if (!enabled) return { ok: false, start, end };
  if (!start && !end) return { ok: true, start, end };
  return { ok: isDateInRange(dateISO, start, end), start, end };
}

export function isSeasonActiveNow(appSettings: any) {
  return isSeasonEnabledForDate(appSettings, todayISO()).ok;
}

export function pickEffectivePrice(args: {
  basePrice: number;
  seasonPrice?: number;
  appSettings: any;
  dateISO?: string;
}): SeasonPriceResult {
  const base = Math.max(0, Number(args.basePrice || 0));
  const season = Math.max(0, Number(args.seasonPrice || 0));
  const seasonState = isSeasonEnabledForDate(args.appSettings, resolvePricingDate(args.dateISO));

  if (seasonState.ok && season > 0) {
    return { price: season, label: "Season Price", usedSeason: true };
  }

  return {
    price: base,
    label: seasonState.ok ? "Regular Price (No Season Price)" : "Regular Price",
    usedSeason: false,
  };
}
