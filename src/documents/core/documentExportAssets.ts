export type DocumentExportImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: "image/png";
};

function loadDirectImage(source: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve(null), 8000);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    image.src = source;
  });
}

async function sourceBlob(source: string) {
  try {
    const response = await fetch(source, {
      cache: "force-cache",
      credentials: source.startsWith("data:") ? "omit" : "same-origin",
    });
    if (!response.ok && !source.startsWith("data:")) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

export async function loadDocumentExportImageElement(src?: string) {
  const source = String(src || "").trim();
  if (!source || typeof window === "undefined") return null;

  const blob = await sourceBlob(source);
  if (blob) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await loadDirectImage(objectUrl);
      if (image) return image;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return loadDirectImage(source);
}

export function documentImageCanvas(image: HTMLImageElement, black = false) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth || image.width);
  canvas.height = Math.max(1, image.naturalHeight || image.height);
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (black) {
    context.globalCompositeOperation = "source-in";
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "source-over";
  }
  return canvas;
}

export function documentCanvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("تعذر تجهيز صورة المستند."))),
      type,
      quality
    );
  });
}

export async function documentCanvasToJpegBytes(canvas: HTMLCanvasElement) {
  const blob = await documentCanvasToBlob(canvas, "image/jpeg", 0.94);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildDocumentExportPng(
  src?: string,
  options: { black?: boolean } = {}
): Promise<DocumentExportImage | null> {
  const image = await loadDocumentExportImageElement(src);
  if (!image) return null;
  const canvas = documentImageCanvas(image, Boolean(options.black));
  if (!canvas) return null;
  const blob = await documentCanvasToBlob(canvas, "image/png");
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
    mimeType: "image/png",
  };
}
