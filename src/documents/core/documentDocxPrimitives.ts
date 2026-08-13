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

export function docxRun(
  value: unknown,
  options: { bold?: boolean; size?: number; color?: string } = {}
) {
  const size = options.size || 22;
  return `<w:r><w:rPr><w:rFonts w:ascii="${DOCUMENT_DOCX_FONT}" w:hAnsi="${DOCUMENT_DOCX_FONT}" w:cs="${DOCUMENT_DOCX_FONT}"/><w:rtl/><w:lang w:val="${DOCUMENT_DOCX_LOCALE}" w:bidi="${DOCUMENT_DOCX_LOCALE}"/>${options.bold ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${options.color ? `<w:color w:val="${options.color}"/>` : ""}</w:rPr><w:t xml:space="preserve">${docxText(value)}</w:t></w:r>`;
}

export function docxParagraph(
  value: unknown,
  options: {
    bold?: boolean;
    size?: number;
    align?: "left" | "center" | "right";
    after?: number;
    before?: number;
    color?: string;
  } = {}
) {
  return `<w:p><w:pPr><w:bidi/><w:jc w:val="${options.align || "right"}"/><w:spacing w:before="${options.before || 0}" w:after="${options.after ?? 70}" w:line="275" w:lineRule="auto"/></w:pPr>${docxRun(value, options)}</w:p>`;
}

export function docxEmpty(after = 0) {
  return `<w:p><w:pPr><w:bidi/><w:spacing w:after="${after}"/></w:pPr></w:p>`;
}

export function docxImage(
  asset: DocumentExportImage | null,
  relId: string,
  fallback: string,
  options: {
    align?: "left" | "center" | "right";
    maxWidth?: number;
    maxHeight?: number;
    id?: number;
  } = {}
) {
  if (!asset) {
    return docxParagraph(fallback || "—", {
      align: options.align || "right",
      after: 0,
    });
  }
  const { cx, cy } = docxImageExtent(
    asset,
    options.maxWidth || 1800000,
    options.maxHeight || 700000
  );
  const id = options.id || 1;
  return `<w:p><w:pPr><w:bidi/><w:jc w:val="${options.align || "right"}"/><w:spacing w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="image-${id}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="image-${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

export function docxCell(content: string, width: number, bottom = false) {
  const border = bottom
    ? '<w:tcBorders><w:bottom w:val="single" w:sz="7" w:color="333333"/></w:tcBorders>'
    : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="top"/>${border}<w:tcMar><w:top w:w="55" w:type="dxa"/><w:right w:w="75" w:type="dxa"/><w:bottom w:w="55" w:type="dxa"/><w:left w:w="75" w:type="dxa"/></w:tcMar></w:tcPr>${content}</w:tc>`;
}

export function docxTable(
  rows: string[],
  widths: number[],
  after = 70,
  rtl = false
) {
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/>${rtl ? "<w:bidiVisual/>" : ""}</w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>${docxEmpty(after)}`;
}

export function docxField(label: string, value: unknown) {
  return `${docxParagraph(label, {
    size: 17,
    bold: true,
    color: "555555",
    after: 20,
  })}${docxParagraph(value, { size: 21, bold: true, after: 0 })}`;
}

export function documentDocxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:rtl/><w:lang w:val="ar-SA" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/><w:rtl/><w:lang w:val="ar-SA" w:bidi="ar-SA"/></w:rPr></w:style></w:styles>`;
}

export function documentDocxSettingsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:displayBackgroundShape/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
}
