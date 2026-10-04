import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing package feedback codemod anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Package feedback codemod anchor is not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const path = "src/features/internal-booking-v2/PackageSessionsManager.tsx";
let source = readFileSync(path, "utf8");

source = replaceOnce(
  source,
  `import {\n  DashboardDatePickerV2,\n  DashboardDrawerV2,\n  DashboardModalV2,\n  DashboardSelectV2,\n} from "../../components/dashboard-v2";`,
  `import {\n  DashboardActionFeedbackV2,\n  DashboardConfirmV2,\n  DashboardDatePickerV2,\n  DashboardDrawerV2,\n  DashboardModalV2,\n  DashboardSelectV2,\n} from "../../components/dashboard-v2";`,
  "dashboard imports"
);

source = replaceOnce(
  source,
  `  const [detailsError, setDetailsError] = useState("");\n  const [detailsForm, setDetailsForm] = useState({`,
  `  const [detailsError, setDetailsError] = useState("");\n  const [deletePackageDraft, setDeletePackageDraft] =\n    useState<PackageSessionDashboardPackage | null>(null);\n  const [deletePackageError, setDeletePackageError] = useState("");\n  const [packageListFeedback, setPackageListFeedback] = useState<{\n    tone: "success" | "danger";\n    message: string;\n  } | null>(null);\n  const [detailsForm, setDetailsForm] = useState({`,
  "delete state"
);

source = replaceOnce(
  source,
  `  const deletePackage = async (pkg: PackageSessionDashboardPackage) => {\n    if (mutationLoading) return;\n    const ok = window.confirm(language === "en"\n      ? \`Permanently delete package \${pkg.packageName} from Cloudflare D1 along with its movement history?\`\n      : \`حذف باقة \${pkg.packageName} نهائيًا من Cloudflare D1 مع سجل حركاتها؟\`);\n    if (!ok) return;\n    try {\n      setMutationLoading(true);\n      await PackageOperationsService.deleteClientPackage(pkg.id);\n      await load();\n    } catch (error: any) {\n      window.alert(String(error?.message || t("تعذر حذف الباقة.")));\n    } finally {\n      setMutationLoading(false);\n    }\n  };`,
  `  const openDeletePackageDialog = (pkg: PackageSessionDashboardPackage) => {\n    if (mutationLoading) return;\n    setDeletePackageError("");\n    setPackageListFeedback(null);\n    setDeletePackageDraft(pkg);\n  };\n\n  const confirmDeletePackage = async () => {\n    if (!deletePackageDraft || mutationLoading) return;\n    const target = deletePackageDraft;\n    try {\n      setMutationLoading(true);\n      setDeletePackageError("");\n      await PackageOperationsService.deleteClientPackage(target.id);\n      setDeletePackageDraft(null);\n      setPackageListFeedback({\n        tone: "success",\n        message: language === "en"\n          ? \`Package \${target.packageName} was permanently deleted.\`\n          : \`تم حذف باقة \${target.packageName} نهائيًا.\`,\n      });\n      await load();\n    } catch (error: any) {\n      setDeletePackageError(\n        String(error?.message || (language === "en" ? "Unable to delete the package." : "تعذر حذف الباقة."))\n      );\n    } finally {\n      setMutationLoading(false);\n    }\n  };`,
  "delete action"
);

source = replaceOnce(
  source,
  `      {!error && activeTab === "packages" ? (\n        <div className="bk2-session-table-wrap">`,
  `      {!error && activeTab === "packages" ? (\n        <div className="bk2-session-table-wrap">\n          {packageListFeedback ? (\n            <DashboardActionFeedbackV2\n              revealOnMount\n              tone={packageListFeedback.tone}\n              title={packageListFeedback.tone === "success"\n                ? (language === "en" ? "Package deleted" : "تم حذف الباقة")\n                : (language === "en" ? "Package action failed" : "تعذر تنفيذ إجراء الباقة")}\n              description={packageListFeedback.message}\n              className="bk2-session-list-feedback"\n            />\n          ) : null}`,
  "package list feedback"
);

source = replaceOnce(
  source,
  `                    <button type="button" className="is-delete" onClick={() => void deletePackage(pkg)} disabled={mutationLoading}>\n                      <FiTrash2 /> {t("حذف")}\n                    </button>`,
  `                    <button type="button" className="is-delete" onClick={() => openDeletePackageDialog(pkg)} disabled={mutationLoading}>\n                      <FiTrash2 /> {t("حذف")}\n                    </button>`,
  "delete button"
);

source = replaceOnce(
  source,
  `      <DashboardDrawerV2\n        open={Boolean(selectedClientId)}`,
  `      <DashboardConfirmV2\n        open={Boolean(deletePackageDraft)}\n        onClose={() => {\n          if (!mutationLoading) {\n            setDeletePackageDraft(null);\n            setDeletePackageError("");\n          }\n        }}\n        onConfirm={confirmDeletePackage}\n        title={language === "en" ? "Permanently delete package?" : "حذف الباقة نهائيًا؟"}\n        description={deletePackageDraft\n          ? (language === "en"\n              ? \`This will permanently delete \${deletePackageDraft.packageName} and its movement history.\`\n              : \`سيتم حذف باقة \${deletePackageDraft.packageName} وسجل حركاتها نهائيًا.\`)\n          : undefined}\n        tone="danger"\n        confirmLabel={language === "en" ? "Delete permanently" : "حذف نهائي"}\n        cancelLabel={language === "en" ? "Cancel" : "إلغاء"}\n        pendingLabel={language === "en" ? "Deleting..." : "جاري الحذف..."}\n      >\n        {deletePackageError ? (\n          <DashboardActionFeedbackV2\n            revealOnMount\n            focusOnMount\n            tone="danger"\n            title={language === "en" ? "Delete failed" : "تعذر حذف الباقة"}\n            description={deletePackageError}\n          />\n        ) : null}\n      </DashboardConfirmV2>\n\n      <DashboardDrawerV2\n        open={Boolean(selectedClientId)}`,
  "delete confirm"
);

writeFileSync(path, source, "utf8");
console.log("Applied contextual package deletion feedback.");
