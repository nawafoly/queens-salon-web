import { useEffect, useMemo, useState } from "react";
import {
  hasMalikatInstallPrompt,
  isMalikatInstalled,
  promptMalikatInstallation,
  subscribeToMalikatInstallPrompt,
} from "../services/appInstall";
import "../styles/Install.css";

type InstallFeedback = "idle" | "accepted" | "dismissed" | "manual";

function detectPlatform() {
  const userAgent = window.navigator.userAgent;
  const touchMac =
    window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  const ios = /iPad|iPhone|iPod/i.test(userAgent) || touchMac;
  const safari =
    /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Edg/i.test(userAgent);
  const android = /Android/i.test(userAgent);

  return { ios, safari, android };
}

export default function Install() {
  const platform = useMemo(detectPlatform, []);
  const [installed, setInstalled] = useState(isMalikatInstalled);
  const [promptAvailable, setPromptAvailable] = useState(hasMalikatInstallPrompt);
  const [feedback, setFeedback] = useState<InstallFeedback>("idle");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "تثبيت MALIKAT";

    const unsubscribe = subscribeToMalikatInstallPrompt(setPromptAvailable);
    const onInstalled = () => {
      setInstalled(true);
      setFeedback("accepted");
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      document.title = previousTitle;
      unsubscribe();
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handlePrimaryAction = async () => {
    if (installed) {
      window.location.assign("/");
      return;
    }

    if (!promptAvailable) {
      setFeedback("manual");
      return;
    }

    setBusy(true);
    try {
      const outcome = await promptMalikatInstallation();
      if (outcome === "accepted") {
        setFeedback("accepted");
      } else if (outcome === "dismissed") {
        setFeedback("dismissed");
      } else {
        setFeedback("manual");
      }
    } finally {
      setBusy(false);
    }
  };

  const actionLabel = installed
    ? "فتح MALIKAT"
    : busy
      ? "جاري فتح التثبيت..."
      : "تثبيت MALIKAT على هذا الجهاز";

  return (
    <section className="malikat-install" aria-labelledby="malikat-install-title">
      <div className="malikat-install__glow" aria-hidden="true" />
      <div className="malikat-install__card">
        <div className="malikat-install__brand">
          <img
            className="malikat-install__logo"
            src="/logo512.png"
            alt="شعار MALIKAT"
            width="144"
            height="144"
          />
          <div>
            <span className="malikat-install__eyebrow">MALIKAT</span>
            <h1 id="malikat-install-title">ثبّت النظام على جهازك</h1>
            <p>
              وصول أسرع من الشاشة الرئيسية، وفتح النظام كتطبيق مستقل بدون الحاجة
              للبحث عن الرابط كل مرة.
            </p>
          </div>
        </div>

        <button
          className="malikat-install__primary"
          type="button"
          onClick={handlePrimaryAction}
          disabled={busy}
        >
          <span aria-hidden="true">{installed ? "↗" : "↓"}</span>
          {actionLabel}
        </button>

        {feedback === "accepted" ? (
          <p className="malikat-install__notice malikat-install__notice--success" role="status">
            تم تثبيت MALIKAT بنجاح. ستجد الأيقونة بشعار ملكات على جهازك.
          </p>
        ) : null}

        {feedback === "dismissed" ? (
          <p className="malikat-install__notice" role="status">
            أُغلق طلب التثبيت. اضغط الزر مرة أخرى عندما تكون جاهزًا.
          </p>
        ) : null}

        {feedback === "manual" || (platform.ios && !installed) ? (
          <div className="malikat-install__instructions" role="status">
            <h2>
              {platform.ios
                ? platform.safari
                  ? "التثبيت على iPhone أو iPad"
                  : "افتح الصفحة في Safari أولًا"
                : "إذا لم تظهر نافذة التثبيت"}
            </h2>
            {platform.ios ? (
              <ol>
                {!platform.safari ? <li>افتح هذا الرابط باستخدام Safari.</li> : null}
                <li>اضغط زر «مشاركة» في Safari.</li>
                <li>اختر «إضافة إلى الشاشة الرئيسية».</li>
                <li>اضغط «إضافة» وستظهر أيقونة MALIKAT.</li>
              </ol>
            ) : (
              <ol>
                <li>افتح قائمة المتصفح.</li>
                <li>
                  اختر {platform.android ? "«تثبيت التطبيق»" : "«تثبيت MALIKAT»"}.
                </li>
                <li>وافق على التثبيت لتظهر أيقونة MALIKAT على جهازك.</li>
              </ol>
            )}
          </div>
        ) : null}

        <div className="malikat-install__benefits" aria-label="مزايا التثبيت">
          <div>
            <span aria-hidden="true">01</span>
            <strong>دخول سريع</strong>
            <p>من شاشة الجوال أو سطح المكتب مباشرة.</p>
          </div>
          <div>
            <span aria-hidden="true">02</span>
            <strong>تجربة مستقلة</strong>
            <p>واجهة تطبيق كاملة بدون شريط المتصفح.</p>
          </div>
          <div>
            <span aria-hidden="true">03</span>
            <strong>هوية موحّدة</strong>
            <p>الاسم والأيقونة يظهران دائمًا باسم وشعار MALIKAT.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
