import type { ReactNode, RefObject } from "react";

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
};

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
}: PriceListPanelProps<T>) {
  return (
    <section className="card bk-panel bk-price-list-section bk-price-list-section--wide" aria-labelledby="bk-price-list-title">
      <div className="bk-price-list-toolbar">
        <div className="bk-price-list-heading">
          <span>{modeLabel}</span>
          <h2 id="bk-price-list-title">قائمة الأسعار</h2>
          <small>{rows.length} نتيجة ظاهرة</small>
        </div>
        <button ref={guideButtonRef} type="button" className="bk-hair-guide-trigger" onClick={onOpenGuide}>
          دليل أطوال الشعر
        </button>
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
      </div>

      {loading ? (
        <div className="bk-price-list-state" role="status">جاري تحميل {modeLabel}...</div>
      ) : rows.length ? (
        <div className="bk-price-list-grid" role="list">
          {rows.map((row) => {
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
      ) : (
        <div className="bk-price-list-state">{emptyText}</div>
      )}
    </section>
  );
}
