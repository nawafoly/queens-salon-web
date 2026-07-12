import { useMemo, useState, type ReactNode, type RefObject } from "react";

export type PriceListPanelRow = {
  id: string;
  kind: "service" | "package";
  name: string;
  price: number;
  categoryName?: string;
  sectionId?: string;
};

type PriceListPanelProps<T extends PriceListPanelRow> = {
  rows: T[];
  selectedId: string;
  query: string;
  loading: boolean;
  modeLabel: string;
  emptyText: string;
  guideButtonRef: RefObject<HTMLButtonElement | null>;
  renderIcon: (name: string) => { node: ReactNode; label: string };
  onQueryChange: (value: string) => void;
  onSelect: (row: T) => void;
  onOpenGuide: () => void;
  onCloseMobile?: () => void;
};

function categoryLabel(row: PriceListPanelRow) {
  const explicit = String(row.categoryName || "").trim();
  if (explicit && !/^[a-z0-9_-]+$/i.test(explicit)) return explicit;
  const raw = `${explicit} ${String(row.sectionId || "")}`.toLowerCase();
  if (raw.includes("package")) return "الباقات";
  if (raw.includes("hair-color")) return "صبغات وعلاجات الشعر";
  if (raw.includes("hair")) return "الشعر";
  if (raw.includes("nail")) return "الأظافر";
  if (raw.includes("makeup") || raw.includes("make-up")) return "المكياج";
  if (raw.includes("lash") || raw.includes("رمش")) return "الرموش";
  if (raw.includes("skin") || raw.includes("care") || raw.includes("service")) return "العناية";
  return "خدمات الصالون";
}

export default function PriceListPanel<T extends PriceListPanelRow>({
  rows,
  selectedId,
  query,
  loading,
  modeLabel,
  emptyText,
  guideButtonRef,
  renderIcon,
  onQueryChange,
  onSelect,
  onOpenGuide,
  onCloseMobile,
}: PriceListPanelProps<T>) {
  const [category, setCategory] = useState("الكل");
  const categories = useMemo(
    () => ["الكل", ...Array.from(new Set(rows.map(categoryLabel))).sort((a, b) => a.localeCompare(b, "ar"))],
    [rows]
  );
  const visibleRows = useMemo(
    () => (category === "الكل" ? rows : rows.filter((row) => categoryLabel(row) === category)),
    [category, rows]
  );
  return (
    <section className="card bk-panel bk-price-list-section bk-price-list-section--wide" aria-labelledby="bk-price-list-title">
      <div className="bk-price-list-toolbar">
        <div className="bk-price-list-heading">
          <span>{modeLabel}</span>
          <h2 id="bk-price-list-title">قائمة الأسعار</h2>
          <small>{visibleRows.length} نتيجة ظاهرة</small>
        </div>
        <button ref={guideButtonRef} type="button" className="bk-hair-guide-trigger" onClick={onOpenGuide}>
          دليل أطوال الشعر
        </button>
        <button type="button" className="bk-price-list-mobile-close" onClick={onCloseMobile} aria-label="إغلاق قائمة الأسعار">×</button>
        <label className="bk-price-list-search">
          <span className="visually-hidden">البحث في قائمة الأسعار</span>
          <input
            className="form-control"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={`ابحث عن ${modeLabel} أو قسم...`}
            type="search"
          />
        </label>
        <div className="bk-price-list-filters" aria-label="تصفية قائمة الأسعار">
          {categories.map((label) => (
            <button
              key={label}
              type="button"
              className={category === label ? "is-active" : ""}
              aria-pressed={category === label}
              onClick={() => setCategory(label)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bk-price-list-state" role="status">جاري تحميل {modeLabel}...</div>
      ) : visibleRows.length ? (
        <div className="bk-price-list-results">
        <div className="bk-price-list-grid" role="list">
          {visibleRows.map((row) => {
            const selected = selectedId === row.id;
            const icon = renderIcon(row.name);
            return (
              <button
                key={row.id}
                type="button"
                className={`bk-price-list-item ${selected ? "is-selected" : ""}`}
                aria-pressed={selected}
                title={row.name}
                onClick={() => onSelect(row)}
              >
                <span className="bk-price-list-thumb bk-price-list-icon" role="img" aria-label={icon.label}>{icon.node}</span>
                <span className="bk-price-list-copy">
                  <strong className="bk-price-list-name">{row.name}</strong>
                  <small>{row.categoryName || row.sectionId || "خدمة صالون"}</small>
                </span>
                <span className="bk-price-list-price">{Number(row.price || 0).toFixed(0)} <small>ريال</small></span>
                <span className="bk-price-list-check" aria-hidden="true">✓</span>
              </button>
            );
          })}
        </div>
        </div>
      ) : (
        <div className="bk-price-list-state">{emptyText}</div>
      )}
    </section>
  );
}
