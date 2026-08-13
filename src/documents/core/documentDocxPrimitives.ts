import { xmlEscape } from "./officeZip";
import type { DocumentExportImage } from "./documentExportAssets";

export const DOCUMENT_DOCX_FONT = "Tahoma";
export const DOCUMENT_DOCX_LOCALE = "ar-SA";

export function docxText(value: unknown) {
  return xmlEscape(value);
}

export function docxImageExtent(
  image: DocumentExportImage,
  maxWidth: number,
  maxHeight: number
) {
  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
  return {
    cx: Math.max(1, Math.round(image.width * ratio)),
    cy: Math.max(1, Math.round(image.height * ratio)),
  };
}
