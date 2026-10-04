import { readFileSync, writeFileSync } from "node:fs";

const path = "src/pages/hr/EmployeeRequests.tsx";
let source = readFileSync(path, "utf8");

function once(before, after, label) {
  if (source.includes(after)) return;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing employee request feedback anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Non-unique employee request feedback anchor: ${label}`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

once(
  '  onCreated: (request: EmployeeRequest) => void;',
  '  onCreated: (request: EmployeeRequest, warning?: string) => void;',
  'callback type'
);

once(
  '      if (attachment) {\n        try {',
  '      let creationWarning = "";\n      if (attachment) {\n        try {',
  'warning state'
);

const attachmentPattern = /        \} catch \(uploadError\) \{\n          window\.alert\([\s\S]*?\);\n        \}\n      \}\n      onCreated\(request\);/;
if (!source.includes('onCreated(request, creationWarning || undefined);')) {
  if (!attachmentPattern.test(source)) throw new Error('Missing employee request attachment alert block');
  source = source.replace(
    attachmentPattern,
    `        } catch (uploadError) {\n          const reason = String((uploadError as Error)?.message || pick(language, "خطأ غير معروف", "Unknown error"));\n          creationWarning =\n            pick(language, "تم إنشاء الطلب", "Request created") +\n            " " + request.request_number + "، " +\n            pick(language, "لكن لم يكتمل رفع المرفق", "but the attachment upload did not complete") +\n            ": " + reason;\n        }\n      }\n      onCreated(request, creationWarning || undefined);`
  );
}

once(
  '  const [success, setSuccess] = useState<EmployeeRequest | null>(null);',
  '  const [success, setSuccess] = useState<EmployeeRequest | null>(null);\n  const [successWarning, setSuccessWarning] = useState("");',
  'success warning state'
);

once(
  'onCreated={(request) => { setSuccess(request); closeForm(); void load(); void onPortalChange?.(); }}',
  'onCreated={(request, warning) => { setSuccess(request); setSuccessWarning(warning || ""); closeForm(); void load(); void onPortalChange?.(); }}',
  'success callback'
);

const statusSpan = '<span>{requestStatusLabel(success.status, language)} • {formatDateTime(success.submitted_at, language)}</span><div>';
const statusWithWarning = '<span>{requestStatusLabel(success.status, language)} • {formatDateTime(success.submitted_at, language)}</span>{successWarning ? <div className="employee-request-error"><FontAwesomeIcon icon={faTriangleExclamation} /> {successWarning}</div> : null}<div>';
once(statusSpan, statusWithWarning, 'success dialog warning');

once(
  'onClick={() => setSuccess(null)}',
  'onClick={() => { setSuccess(null); setSuccessWarning(""); }}',
  'success close clears warning'
);

writeFileSync(path, source, "utf8");
console.log("Applied contextual EmployeeRequests attachment feedback.");
