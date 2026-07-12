import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

type HairLengthGuideDrawerProps = {
  open: boolean;
  imageUrl: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  canUpload: boolean;
  uploading: boolean;
  onUpload: (file: File) => void;
  onClose: () => void;
};

export default function HairLengthGuideDrawer({
  open,
  imageUrl,
  triggerRef,
  canUpload,
  uploading,
  onUpload,
  onClose,
}: HairLengthGuideDrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [loadedUrl, setLoadedUrl] = useState("");
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const triggerElement = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        ) || []
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      triggerElement?.focus();
    };
  }, [onClose, open, triggerRef]);

  if (!open || typeof document === "undefined") return null;
  const imageLoaded = !!imageUrl && loadedUrl === imageUrl;

  return createPortal(
    <div className="bk-hair-guide-overlay" role="presentation" onMouseDown={onClose}>
      <section
        ref={panelRef}
        className="bk-hair-guide-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bk-hair-guide-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="bk-hair-guide-drawer__header">
          <div>
            <span>مرجع سريع</span>
            <h2 id="bk-hair-guide-title">دليل أطوال الشعر</h2>
          </div>
          <button ref={closeRef} type="button" className="bk-hair-guide-close" onClick={onClose} aria-label="إغلاق دليل أطوال الشعر">
            ×
          </button>
        </header>

        <button
          type="button"
          className={`bk-hair-guide-drawer__image ${imageLoaded ? "is-loaded" : "is-placeholder"} ${zoomed ? "is-zoomed" : ""}`}
          onClick={() => imageLoaded && setZoomed((value) => !value)}
          aria-label={zoomed ? "تصغير صورة دليل أطوال الشعر" : "تكبير صورة دليل أطوال الشعر"}
        >
          <div className="bk-hair-guide-placeholder" aria-hidden={imageLoaded}>دليل أطوال الشعر</div>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="دليل توضيحي لأطوال الشعر"
              loading="lazy"
              decoding="async"
              onLoad={() => setLoadedUrl(imageUrl)}
              onError={() => setLoadedUrl("")}
            />
          ) : null}
        </button>

        {canUpload ? (
          <footer className="bk-hair-guide-drawer__admin">
            <span>خيارات الإدارة</span>
            <label className="bk-hair-guide-upload">
              {uploading ? "جاري الرفع..." : "تغيير صورة الدليل"}
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body
  );
}
