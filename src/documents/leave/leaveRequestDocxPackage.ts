import type { EmployeeRequest } from "../../services/employeeRequests";
import { DOCUMENT_BRANDING } from "../core/documentBranding";
import { buildDocumentExportPng } from "../core/documentExportAssets";
import type { DocumentExportImage } from "../core/documentExportAssets";
import {
  docxRun,
  documentDocxSettingsXml,
  documentDocxStylesXml,
} from "../core/documentDocxPrimitives";
import {
  documentDocxWatermarkHeaderXml,
  documentDocxWatermarkRelationship,
} from "../core/documentDocxWatermark";
import { zipStore, xmlEscape } from "../core/officeZip";
import { buildLeaveRequestDocumentData } from "./leaveRequestModel";
import { LEAVE_DOCUMENT_TEXT } from "./leaveRequestDocumentSpec";
import { leaveRequestDocxBody } from "./leaveRequestDocxLayout";

const PAGE = { width: 11906, height: 16838, top: 620, right: 680, bottom: 620, left: 680 };

type NamedImage = DocumentExportImage & {
  id: "logo" | "employee" | "manager";
  fileName: string;
};

function namedImage(
  image: DocumentExportImage | null,
  id: NamedImage["id"]
): NamedImage | null {
  return image ? { ...image, id, fileName: `${id}.png` } : null;
}

function documentXml(body: string, hasLogo: boolean) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr>${hasLogo ? '<w:headerReference w:type="default" r:id="rIdHeader1"/>' : ""}<w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/><w:pgMar w:top="${PAGE.top}" w:right="${PAGE.right}" w:bottom="${PAGE.bottom}" w:left="${PAGE.left}" w:header="300" w:footer="300" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>`;
}

function footerXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>${docxRun(LEAVE_DOCUMENT_TEXT.copyNote, { size: 15, color: "777777" })}</w:p></w:ftr>`;
}

function contentTypes(hasImages: boolean, hasHeader: boolean) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${hasImages ? '<Default Extension="png" ContentType="image/png"/>' : ""}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${hasHeader ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function documentRelationships(images: NamedImage[], hasHeader: boolean) {
  const ids: Record<NamedImage["id"], string> = {
    logo: "rIdLogo",
    employee: "rIdEmployeeSignature",
    manager: "rIdManagerSignature",
  };
  const imageRels = images
    .map((image) => `<Relationship Id="${ids[image.id]}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.fileName}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${hasHeader ? '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : ""}<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${imageRels}</Relationships>`;
}

function rootRelationships() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function docProps(title: string) {
  const timestamp = new Date().toISOString();
  return {
    core: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>Malikat Document Export</dc:creator><cp:lastModifiedBy>Malikat Document Export</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`,
    app: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Malikat Document Export</Application><Company>Malikat Salon</Company></Properties>`,
  };
}

export async function buildLeaveRequestDocxBytes(request: EmployeeRequest) {
  if (typeof document === "undefined") {
    throw new Error("تصدير Word يتطلب تشغيل الصفحة داخل المتصفح.");
  }
  const data = buildLeaveRequestDocumentData(request);
  const [logo, employee, manager] = await Promise.all([
    buildDocumentExportPng(DOCUMENT_BRANDING.printLogoSource, { black: true }),
    buildDocumentExportPng(data.employeeSignature.imageDataUrl),
    buildDocumentExportPng(data.managerSignature.imageDataUrl),
  ]);
  const named = {
    logo: namedImage(logo, "logo"),
    employee: namedImage(employee, "employee"),
    manager: namedImage(manager, "manager"),
  };
  const images = Object.values(named).filter((image): image is NamedImage => Boolean(image));
  const hasLogo = Boolean(named.logo);
  const props = docProps(`${data.title} ${data.requestNumber}`);
  const files = [
    { name: "[Content_Types].xml", content: contentTypes(images.length > 0, hasLogo) },
    { name: "_rels/.rels", content: rootRelationships() },
    { name: "docProps/core.xml", content: props.core },
    { name: "docProps/app.xml", content: props.app },
    { name: "word/document.xml", content: documentXml(leaveRequestDocxBody(data, named), hasLogo) },
    { name: "word/_rels/document.xml.rels", content: documentRelationships(images, hasLogo) },
    { name: "word/styles.xml", content: documentDocxStylesXml() },
    { name: "word/settings.xml", content: documentDocxSettingsXml() },
    { name: "word/footer1.xml", content: footerXml() },
    ...(hasLogo
      ? [
          { name: "word/header1.xml", content: documentDocxWatermarkHeaderXml(DOCUMENT_BRANDING.watermarkOpacity) },
          { name: "word/_rels/header1.xml.rels", content: documentDocxWatermarkRelationship(named.logo?.fileName) },
        ]
      : []),
    ...images.map((image) => ({ name: `word/media/${image.fileName}`, content: image.bytes })),
  ];
  return zipStore(files);
}
