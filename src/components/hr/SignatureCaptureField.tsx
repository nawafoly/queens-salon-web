import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { EmployeePortalLanguage } from "../../features/employee-portal/EmployeePortalLanguage";
import "../../styles/SignatureCaptureField.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  signerName?: string;
  required?: boolean;
  compact?: boolean;
  disabled?: boolean;
  allowUpload?: boolean;
  language?: EmployeePortalLanguage;
};

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 300;

function prepareCanvas(canvas: HTMLCanvasElement) {
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.strokeStyle = "#111111";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.lineJoin = "round";
  return context;
}

function pointFromEvent(canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLCanvasElement>) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
  };
}

export default function SignatureCaptureField({
  value,
  onChange,
  label,
  signerName = "",
  required = false,
  compact = false,
  disabled = false,
  allowUpload = false,
  language = "ar",
}: Props) {
  const tr = (ar: string, en: string) => language === "en" ? en : ar;
  const displayLabel = label || tr("التوقيع", "Signature");
  const [open, setOpen] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = prepareCanvas(canvas);
    if (!context) return;
    setError("");
    setHasInk(false);

    if (value) {
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setHasInk(true);
      };
      image.src = value;
    }
  }, [open, value]);

  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    const context = canvas.getContext("2d");
    if (!context) return;
    const point = pointFromEvent(canvas, event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    drawingRef.current = true;
    setHasInk(true);
    setError("");
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    const context = canvas.getContext("2d");
    if (!context) return;
    const point = pointFromEvent(canvas, event);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const end = (event?: React.PointerEvent<HTMLCanvasElement>) => {
    if (event && canvasRef.current?.hasPointerCapture?.(event.pointerId)) {
      canvasRef.current.releasePointerCapture?.(event.pointerId);
    }
    drawingRef.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    prepareCanvas(canvas);
    drawingRef.current = false;
    setHasInk(false);
    setError("");
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) {
      setError(tr("ارسم توقيعك داخل اللوحة قبل الحفظ.", "Draw your signature before saving."));
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    onChange(dataUrl);
    setOpen(false);
  };
  const uploadSignature = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError(tr("يجب اختيار صورة PNG أو JPG أو WebP للتوقيع.", "Choose a PNG, JPG or WebP image for your signature."));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError(tr("حجم صورة التوقيع يجب ألا يتجاوز 5 ميجابايت.", "Signature images must be under 5 MB."));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = String(reader.result || "");

      if (!dataUrl.startsWith("data:image/")) {
        setError(tr("تعذر قراءة صورة التوقيع.", "Could not read the signature image."));
        return;
      }

      onChange(dataUrl);
      setError("");
      setOpen(false);
    };

    reader.onerror = () => {
      setError(tr("تعذر قراءة ملف التوقيع.", "Could not read the signature file."));
    };

    reader.readAsDataURL(file);
  };

  return (
    <div className={`signature-capture-field ${compact ? "is-compact" : ""}`} dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <div className="signature-capture-field__head">
        <strong>{displayLabel}{required ? " *" : ""}</strong>
        {value ? <span>{tr("تم التوقيع", "Signed")}</span> : <span className="is-required">{tr("مطلوب", "Required")}</span>}
      </div>
      <button
        type="button"
        className={`signature-capture-field__preview ${value ? "has-signature" : ""}`}
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
      >
        {value ? (
          <img src={value} alt={`${tr("توقيع", "Signature of")} ${signerName || tr("المستخدم", "user")}`} />
        ) : (
          <span>{tr("اضغط لفتح لوحة التوقيع", "Tap to open the signature pad")}</span>
        )}
      </button>
      <div className="signature-capture-field__actions">
        {value && !disabled ? (
          <button
            type="button"
            className="signature-capture-field__edit"
            onClick={() => setOpen(true)}
          >
            {tr("تعديل التوقيع اليدوي", "Edit handwritten signature")}
          </button>
        ) : null}

        {allowUpload && !disabled ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={uploadSignature}
            />
            <button
              type="button"
              className="signature-capture-field__edit signature-capture-field__upload"
              onClick={() => fileInputRef.current?.click()}
            >
              {tr("رفع صورة توقيع", "Upload signature image")}
            </button>
          </>
        ) : null}
      </div>

      {open ? createPortal(
        <div className="signature-pad-modal" role="dialog" aria-modal="true" aria-label={displayLabel} lang={language}>
          <button type="button" className="signature-pad-modal__backdrop" aria-label={tr("إغلاق", "Close")} onClick={() => setOpen(false)} />
          <section className="signature-pad-modal__panel" dir={language === "en" ? "ltr" : "rtl"}>
            <header>
              <div>
                <small>{signerName || tr("التوقيع الإلكتروني", "Electronic signature")}</small>
                <h2>{displayLabel}</h2>
                <p>{tr("اكتب توقيعك بيدك داخل المساحة البيضاء باستخدام الماوس أو الإصبع.", "Draw your signature in the white area using your finger or mouse.")}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={tr("إغلاق", "Close")}>×</button>
            </header>
            <div className="signature-pad-modal__board">
              <canvas
                ref={canvasRef}
                onPointerDown={begin}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                onPointerLeave={(event) => {
                  if (event.buttons === 0) end(event);
                }}
              />
              <span>{tr("وقّع هنا", "Sign here")}</span>
            </div>
            {error ? <div className="signature-pad-modal__error">{error}</div> : null}
            <footer>
              <button type="button" className="is-secondary" onClick={clear}>{tr("مسح اللوحة", "Clear pad")}</button>
              <button type="button" className="is-secondary" onClick={() => setOpen(false)}>{tr("إلغاء", "Cancel")}</button>
              <button type="button" className="is-primary" onClick={save}>{tr("اعتماد التوقيع", "Save signature")}</button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
