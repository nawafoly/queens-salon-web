import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import "../../styles/SignatureCaptureField.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  signerName?: string;
  required?: boolean;
  compact?: boolean;
  disabled?: boolean;
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
  label = "التوقيع",
  signerName = "",
  required = false,
  compact = false,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
      setError("ارسم توقيعك داخل اللوحة قبل الحفظ.");
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    onChange(dataUrl);
    setOpen(false);
  };

  return (
    <div className={`signature-capture-field ${compact ? "is-compact" : ""}`}>
      <div className="signature-capture-field__head">
        <strong>{label}{required ? " *" : ""}</strong>
        {value ? <span>تم التوقيع</span> : <span className="is-required">مطلوب</span>}
      </div>
      <button
        type="button"
        className={`signature-capture-field__preview ${value ? "has-signature" : ""}`}
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
      >
        {value ? (
          <img src={value} alt={`توقيع ${signerName || "المستخدم"}`} />
        ) : (
          <span>اضغط لفتح لوحة التوقيع</span>
        )}
      </button>
      {value && !disabled ? (
        <button type="button" className="signature-capture-field__edit" onClick={() => setOpen(true)}>
          تعديل التوقيع
        </button>
      ) : null}

      {open ? createPortal(
        <div className="signature-pad-modal" role="dialog" aria-modal="true" aria-label={label}>
          <button type="button" className="signature-pad-modal__backdrop" aria-label="إغلاق" onClick={() => setOpen(false)} />
          <section className="signature-pad-modal__panel" dir="rtl">
            <header>
              <div>
                <small>{signerName || "التوقيع الإلكتروني"}</small>
                <h2>{label}</h2>
                <p>اكتب توقيعك بيدك داخل المساحة البيضاء باستخدام الماوس أو الإصبع.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق">×</button>
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
              <span>وقّع هنا</span>
            </div>
            {error ? <div className="signature-pad-modal__error">{error}</div> : null}
            <footer>
              <button type="button" className="is-secondary" onClick={clear}>مسح اللوحة</button>
              <button type="button" className="is-secondary" onClick={() => setOpen(false)}>إلغاء</button>
              <button type="button" className="is-primary" onClick={save}>اعتماد التوقيع</button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
