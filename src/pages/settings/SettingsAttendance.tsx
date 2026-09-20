import DashboardNumberInputV2 from "../../components/dashboard-v2/DashboardNumberInputV2";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFingerprint,
  faLocationDot,
  faPlus,
  faRotateRight,
  faSave,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";

import {
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import { AppSettingsService, type AppSettings } from "../../services/AppSettingsService";
import {
  getBrowserPosition,
  listWorkZones,
  removeWorkZone,
  saveWorkZone,
  type WorkZone,
} from "../../services/attendanceSettingsService";
import {
  deleteWorkZoneFromAttendanceWorker,
  upsertWorkZoneInAttendanceWorker,
} from "../../services/attendanceWorkerService";
import "../../styles/dashboard-v2/dashboard-v2.css";
import { settingsText, type DashboardLanguage } from "../../helpers/dashboardSettingsLanguage";

type Props = {
  hasAdminPower: boolean;
  language?: DashboardLanguage;
};

const emptyZone = {
  id: "",
  name: "",
  lat: 24.48914,
  lng: 39.5897,
  radiusMeters: 100,
  active: true,
};

const RADIUS_PRESETS = [25, 50, 100, 150, 200, 300];
const MIN_RADIUS_METERS = 10;
const MAX_RADIUS_METERS = 5000;
const GOOGLE_MAPS_API_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
let googleMapsLoader: Promise<any> | null = null;

function clampRadius(value: number, fallback = 100) {
  const normalized = Number.isFinite(value) ? value : fallback;
  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.round(normalized)));
}

function numberInput(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function attendanceErrorMessage(error: unknown, fallback: string, language: DashboardLanguage = "ar") {
  const err = (error || {}) as { code?: string; message?: string };
  const code = String(err.code || "").toLowerCase();
  const message = String(err.message || "").trim();

  if (code.includes("permission-denied")) {
    return settingsText(language, "حساب هذه النافذة لا يملك صلاحية قراءة مناطق العمل. سجّل الدخول بحساب Owner / Admin / HR / Reception أو حددي نطاقًا مسموحًا للموظفة.");
  }
  if (code.includes("unavailable")) {
    return settingsText(language, "تعذر الاتصال بـ Firestore مؤقتًا. جرّبي التحديث بعد لحظات.");
  }
  if (code.includes("failed-precondition")) {
    return settingsText(language, "استعلام مناطق العمل يحتاج إعدادًا في Firestore. راجعي الـ console لمعرفة رابط الـ index إن وجد.");
  }

  return message || settingsText(language, fallback);
}

function loadGoogleMaps(language: DashboardLanguage) {
  const win = window as any;
  if (win.google?.maps) return Promise.resolve(win.google);
  if (!GOOGLE_MAPS_API_KEY) return Promise.reject(new Error("missing_google_maps_key"));
  if (googleMapsLoader) return googleMapsLoader;

  googleMapsLoader = new Promise((resolve, reject) => {
    const callbackName = `__qsGoogleMapsReady_${Date.now()}`;
    win[callbackName] = () => {
      resolve(win.google);
      delete win[callbackName];
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&language=${language === "en" ? "en" : "ar"}&region=SA&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("google_maps_load_failed"));
    document.head.appendChild(script);
  });

  return googleMapsLoader;
}

export default function SettingsAttendance({ hasAdminPower, language = "ar" }: Props) {
  const t = (text: string) => settingsText(language, text);
  const [settings, setSettings] = useState<AppSettings>(() => AppSettingsService.getCached());
  const [zones, setZones] = useState<WorkZone[]>([]);
  const [zoneDraft, setZoneDraft] = useState(emptyZone);
  const [mapReady, setMapReady] = useState(false);
  const [draggingMap, setDraggingMap] = useState(false);
  const [manualPickMode, setManualPickMode] = useState(false);
  const [manualMarkerOffset, setManualMarkerOffset] = useState({ x: 0, y: 0 });
  const [mapZoom, setMapZoom] = useState(18);
  const [nudgeMeters, setNudgeMeters] = useState(5);
  const [mapFrameCenter, setMapFrameCenter] = useState({ lat: emptyZone.lat, lng: emptyZone.lng });
  const [loading, setLoading] = useState(true);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [zonesError, setZonesError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const googleMapEl = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<any>(null);
  const googleMarkerRef = useRef<any>(null);
  const googleCircleRef = useRef<any>(null);
  const manualMapRef = useRef<HTMLDivElement | null>(null);
  const radiusOverlayRef = useRef<HTMLSpanElement | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number; lat: number; lng: number } | null>(null);
  const latestZoneDraftRef = useRef(zoneDraft);
  const manualPickModeRef = useRef(manualPickMode);

  const attendance = settings.attendance || AppSettingsService.getDefaults().attendance!;
  const activeZones = zones.filter((zone) => zone.active).length;
  const zoneLatRadians = (zoneDraft.lat * Math.PI) / 180;
  const metersPerPixel = (156543.03392 * Math.max(0.08, Math.cos(zoneLatRadians))) / 2 ** mapZoom;
  const visibleRadiusSize = Math.min(
    520,
    Math.max(38, (Math.max(10, zoneDraft.radiusMeters) * 2) / metersPerPixel),
  );
  const googleMapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${mapFrameCenter.lat},${mapFrameCenter.lng}`)}&z=${mapZoom}&output=embed`;
  const googleMapsOpenUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${zoneDraft.lat},${zoneDraft.lng}`)}`;
  const zoneDraftHasChanges =
    Boolean(zoneDraft.id) ||
    Boolean(zoneDraft.name.trim()) ||
    zoneDraft.lat !== emptyZone.lat ||
    zoneDraft.lng !== emptyZone.lng ||
    zoneDraft.radiusMeters !== emptyZone.radiusMeters ||
    zoneDraft.active !== emptyZone.active;

  const stats = [
    {
      label: t("حالة النظام"),
      value: attendance.enabled ? t("مفعّل") : t("متوقف"),
      hint: t("زر الحضور في بوابة الموظف"),
      tone: attendance.enabled ? "dsv2-metric-card--success" : "dsv2-metric-card--danger",
    },
    {
      label: t("البصمة"),
      value: attendance.requireBiometric ? t("إلزامية") : t("اختيارية"),
      hint: t("تحقق داخلي مخصص للحضور فقط"),
      tone: "dsv2-metric-card--gold",
    },
    {
      label: t("GPS وRadius"),
      value: attendance.requireWorkZone ? t("إلزامي") : t("غير إلزامي"),
      hint: `${activeZones} ${t("مناطق نشطة")}`,
      tone: "dsv2-metric-card--dark",
    },
    {
      label: t("الدقة المطلوبة"),
      value: `${attendance.maxLocationAccuracyMeters} ${language === "en" ? "m" : "م"}`,
      hint: t("أعلى هامش خطأ مسموح للموقع"),
      tone: "dsv2-metric-card--dark",
    },
  ];

  const applyZonesResult = (remoteZones: WorkZone[]) => {
    setZones(remoteZones);
    setZonesError("");
  };

  const loadZones = async () => {
    setZonesLoading(true);
    setZonesError("");
    try {
      applyZonesResult(await listWorkZones());
    } catch (error) {
      setZones([]);
      setZonesError(attendanceErrorMessage(error, "تعذر تحميل مناطق العمل.", language));
    } finally {
      setZonesLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setZonesLoading(true);
    setMessage("");
    setZonesError("");

    try {
      const [settingsResult, zonesResult] = await Promise.allSettled([
        AppSettingsService.fetchRemote(),
        listWorkZones(),
      ]);

      if (settingsResult.status === "fulfilled") {
        setSettings(settingsResult.value);
      } else {
        setMessage(attendanceErrorMessage(settingsResult.reason, "تعذر تحميل إعدادات الحضور.", language));
      }

      if (zonesResult.status === "fulfilled") {
        applyZonesResult(zonesResult.value);
      } else {
        setZones([]);
        setZonesError(attendanceErrorMessage(zonesResult.reason, "تعذر تحميل مناطق العمل.", language));
      }
    } finally {
      setZonesLoading(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    latestZoneDraftRef.current = zoneDraft;
  }, [zoneDraft]);

  useEffect(() => {
    manualPickModeRef.current = manualPickMode;
  }, [manualPickMode]);

  useEffect(() => {
    if (manualMapRef.current) {
      manualMapRef.current.style.setProperty("--attendance-map-x", `${manualMarkerOffset.x}px`);
      manualMapRef.current.style.setProperty("--attendance-map-y", `${manualMarkerOffset.y}px`);
    }
    if (radiusOverlayRef.current) {
      radiusOverlayRef.current.style.width = `${visibleRadiusSize}px`;
      radiusOverlayRef.current.style.height = `${visibleRadiusSize}px`;
    }
  }, [manualMarkerOffset.x, manualMarkerOffset.y, visibleRadiusSize]);

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !googleMapEl.current) return;
    let disposed = false;

    loadGoogleMaps(language)
      .then((google) => {
        if (disposed || !googleMapEl.current) return;
        const center = { lat: zoneDraft.lat, lng: zoneDraft.lng };
        const map = new google.maps.Map(googleMapEl.current, {
          center,
          zoom: mapZoom,
          mapTypeId: "roadmap",
          clickableIcons: true,
          streetViewControl: true,
          fullscreenControl: true,
          mapTypeControl: true,
          gestureHandling: "greedy",
          styles: [
            {
              featureType: "poi.business",
              elementType: "labels",
              stylers: [{ visibility: "on" }],
            },
          ],
        });

        const marker = new google.maps.Marker({
          map,
          position: center,
          draggable: hasAdminPower,
          title: "منطقة العمل",
        });

        const computed = getComputedStyle(document.documentElement);
        const zoneColor = computed.getPropertyValue("--dsv2-green").trim() || "rgb(22 132 91)";
        const circle = new google.maps.Circle({
          map,
          center,
          radius: zoneDraft.radiusMeters,
          strokeColor: zoneColor,
          strokeOpacity: 0.85,
          strokeWeight: 2,
          fillColor: zoneColor,
          fillOpacity: 0.16,
        });

        map.addListener("click", (event: any) => {
          if (!hasAdminPower || !event.latLng || manualPickModeRef.current) return;
          const nextCenter = {
            lat: Number(event.latLng.lat().toFixed(7)),
            lng: Number(event.latLng.lng().toFixed(7)),
          };
          setZoneDraft((current) => ({ ...current, ...nextCenter }));
          setMapFrameCenter(nextCenter);
        });

        map.addListener("idle", () => {
          const centerValue = map.getCenter?.();
          if (!centerValue) return;
          setMapFrameCenter({
            lat: Number(centerValue.lat().toFixed(7)),
            lng: Number(centerValue.lng().toFixed(7)),
          });
        });

        marker.addListener("dragend", (event: any) => {
          if (!hasAdminPower || !event.latLng) return;
          const nextCenter = {
            lat: Number(event.latLng.lat().toFixed(7)),
            lng: Number(event.latLng.lng().toFixed(7)),
          };
          setZoneDraft((current) => ({ ...current, ...nextCenter }));
          setMapFrameCenter(nextCenter);
        });

        googleMapRef.current = map;
        googleMarkerRef.current = marker;
        googleCircleRef.current = circle;
        setMapReady(true);
      })
      .catch(() => setMapReady(false));

    return () => {
      disposed = true;
    };
  }, [hasAdminPower, language]);

  useEffect(() => {
    const center = { lat: zoneDraft.lat, lng: zoneDraft.lng };
    googleMapRef.current?.setCenter(center);
    googleMarkerRef.current?.setPosition(center);
    googleCircleRef.current?.setCenter(center);
    googleCircleRef.current?.setRadius(zoneDraft.radiusMeters);
  }, [zoneDraft.lat, zoneDraft.lng, zoneDraft.radiusMeters]);

  useEffect(() => {
    googleMapRef.current?.setZoom(mapZoom);
  }, [mapZoom]);

  const patchAttendance = (patch: Partial<typeof attendance>) => {
    if (!hasAdminPower) return;
    setSettings((current) => ({
      ...current,
      attendance: {
        ...(current.attendance || AppSettingsService.getDefaults().attendance!),
        ...patch,
      },
    }));
  };

  const syncZonesToAttendanceWorker = async (sourceZones: WorkZone[]) => {
    const zonesById = new Map<string, WorkZone>();

    sourceZones.forEach((zone) => {
      if (zone.id) zonesById.set(zone.id, zone);
    });

    for (const zone of zonesById.values()) {
      await upsertWorkZoneInAttendanceWorker(zone);
    }
  };

  const saveSettings = async () => {
    if (!hasAdminPower) return;
    setSaving(true);
    setMessage("");

    try {
      let latestZones = zones;
      if (zoneDraftHasChanges) {
        const savedZone = await saveWorkZone({
          ...zoneDraft,
          name: zoneDraft.name.trim() || t("منطقة عمل جديدة"),
        });
        await upsertWorkZoneInAttendanceWorker(savedZone);
        latestZones = await listWorkZones();
        applyZonesResult(latestZones);
      } else if (!latestZones.length) {
        latestZones = await listWorkZones();
        applyZonesResult(latestZones);
      }

      await syncZonesToAttendanceWorker(latestZones);

      const saved = await AppSettingsService.saveRemote(settings);
      setSettings(saved);
      setMessage(t("تم حفظ إعدادات الحضور والبصمة."));
    } catch (error) {
      setMessage((error as any)?.message || t("تعذر حفظ الإعدادات."));
    } finally {
      setSaving(false);
    }
  };

  const editZone = (zone: WorkZone) => {
    setZoneDraft({
      id: zone.id,
      name: zone.name,
      lat: zone.lat,
      lng: zone.lng,
      radiusMeters: zone.radiusMeters,
      active: zone.active,
    });
    setMapFrameCenter({ lat: zone.lat, lng: zone.lng });
    setManualMarkerOffset({ x: 0, y: 0 });
  };

  const resetZoneDraft = () => {
    setZoneDraft(emptyZone);
    setMapFrameCenter({ lat: emptyZone.lat, lng: emptyZone.lng });
    setManualMarkerOffset({ x: 0, y: 0 });
    setManualPickMode(false);
  };

  const saveZone = async () => {
    if (!hasAdminPower) return;
    setSaving(true);
    setMessage("");

    try {
      const savedZone = await saveWorkZone({
        ...zoneDraft,
        name: zoneDraft.name.trim() || t("منطقة عمل جديدة"),
      });
      await upsertWorkZoneInAttendanceWorker(savedZone);
      resetZoneDraft();
      applyZonesResult(await listWorkZones());
      setMessage(t("تم حفظ منطقة العمل."));
    } catch (error) {
      setMessage((error as any)?.message || t("تعذر حفظ منطقة العمل."));
    } finally {
      setSaving(false);
    }
  };

  const deleteZone = async (id: string) => {
    if (!hasAdminPower) return;
    setSaving(true);
    setMessage("");

    try {
      await deleteWorkZoneFromAttendanceWorker(id);
      await removeWorkZone(id);
      setZones((current) => current.filter((zone) => zone.id !== id));
      if (zoneDraft.id === id) resetZoneDraft();
      setMessage(t("تم حذف منطقة العمل."));
    } catch (error) {
      setMessage((error as any)?.message || t("تعذر حذف منطقة العمل."));
    } finally {
      setSaving(false);
    }
  };

  const useCurrentLocation = async () => {
    if (!hasAdminPower) return;
    setSaving(true);
    setMessage(t("جاري قراءة موقع الجهاز..."));

    try {
      const location = await getBrowserPosition();
      setZoneDraft((current) => ({ ...current, lat: location.lat, lng: location.lng }));
      setMapFrameCenter({ lat: location.lat, lng: location.lng });
      setManualMarkerOffset({ x: 0, y: 0 });
      setMessage(language === "en" ? `${t("تم تحديد الموقع بدقة")} ${location.accuracy || 0} m.` : `تم تحديد الموقع بدقة ${location.accuracy || 0} م.`);
    } catch (error) {
      setMessage((error as any)?.message || t("تعذر قراءة الموقع."));
    } finally {
      setSaving(false);
    }
  };

  const setRadiusMeters = (value: number) => {
    if (!hasAdminPower) return;
    setZoneDraft((current) => ({
      ...current,
      radiusMeters: clampRadius(value, current.radiusMeters),
    }));
  };

  const changeRadius = (delta: number) => {
    if (!hasAdminPower) return;
    setZoneDraft((current) => ({
      ...current,
      radiusMeters: clampRadius(current.radiusMeters + delta, current.radiusMeters),
    }));
  };

  const nudgeDraft = (northMeters: number, eastMeters: number) => {
    if (!hasAdminPower) return;
    const current = latestZoneDraftRef.current;
    const latitudeRadians = (current.lat * Math.PI) / 180;
    const next = {
      lat: Number((current.lat + northMeters / 110540).toFixed(7)),
      lng: Number(
        (current.lng + eastMeters / (111320 * Math.max(0.08, Math.cos(latitudeRadians)))).toFixed(7),
      ),
    };
    setZoneDraft({ ...current, ...next });
    setMapFrameCenter(next);
    setManualMarkerOffset({ x: 0, y: 0 });
  };

  const adoptMapCenter = () => {
    if (!hasAdminPower) return;
    const googleCenter = googleMapRef.current?.getCenter?.();
    const next = googleCenter
      ? {
          lat: Number(googleCenter.lat().toFixed(7)),
          lng: Number(googleCenter.lng().toFixed(7)),
        }
      : {
          lat: Number(mapFrameCenter.lat.toFixed(7)),
          lng: Number(mapFrameCenter.lng.toFixed(7)),
        };

    setZoneDraft((current) => ({ ...current, ...next }));
    setMapFrameCenter(next);
    setManualMarkerOffset({ x: 0, y: 0 });
    setManualPickMode(false);
    setMessage(t("تم اعتماد مركز الخريطة كموقع المنطقة."));
  };

  const moveDraftByPixels = (event: PointerEvent<HTMLElement>) => {
    if (!hasAdminPower) return;
    const origin = dragOriginRef.current;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    const latRad = (origin.lat * Math.PI) / 180;
    const dragMetersPerPixel =
      (156543.03392 * Math.max(0.08, Math.cos(latRad))) / 2 ** mapZoom;
    const dLat = -(dy * dragMetersPerPixel) / 110540;
    const dLng = (dx * dragMetersPerPixel) / (111320 * Math.max(0.08, Math.cos(latRad)));

    setManualMarkerOffset({ x: dx, y: dy });
    setZoneDraft((current) => ({
      ...current,
      lat: Number((origin.lat + dLat).toFixed(6)),
      lng: Number((origin.lng + dLng).toFixed(6)),
    }));
  };

  const startEmbedDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!hasAdminPower || !manualPickMode) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOriginRef.current = {
      x: event.clientX,
      y: event.clientY,
      lat: latestZoneDraftRef.current.lat,
      lng: latestZoneDraftRef.current.lng,
    };
    setManualMarkerOffset({ x: 0, y: 0 });
    setDraggingMap(true);
  };

  const moveEmbedDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (draggingMap) moveDraftByPixels(event);
  };

  const stopEmbedDrag = () => {
    if (!dragOriginRef.current) {
      setDraggingMap(false);
      return;
    }
    const latest = latestZoneDraftRef.current;
    setMapFrameCenter({ lat: latest.lat, lng: latest.lng });
    setManualMarkerOffset({ x: 0, y: 0 });
    dragOriginRef.current = null;
    setDraggingMap(false);
  };

  if (loading) {
    return (
      <main className="dsv2-page settings-attendance-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
        <section className="dsv2-card dsv2-card--padded settings-attendance-v2-state">
          <DashboardSkeletonV2 variant="title" width="36%" />
          <DashboardSkeletonV2 lines={3} width="100%" />
          <DashboardSkeletonV2 variant="block" height={320} />
        </section>
      </main>
    );
  }

  return (
    <main className="dsv2-page settings-attendance-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <section className="dsv2-card settings-attendance-v2-hero">
        <div className="settings-attendance-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">{t("إعدادات الحضور")}</span>
          <h1 className="dsv2-page-title">{t("الحضور والبصمة")}</h1>
          <p className="dsv2-page-subtitle">
            {t("إدارة التحقق بالبصمة، دقة GPS، ومناطق العمل الجغرافية المتزامنة مع Attendance Worker.")}
          </p>
          <div className="settings-attendance-v2-hero__badges">
            <span className={`dsv2-badge ${attendance.requireBiometric ? "dsv2-badge--success" : ""}`}>
              <FontAwesomeIcon icon={faFingerprint} /> {attendance.requireBiometric ? t("البصمة إلزامية") : t("البصمة اختيارية")}
            </span>
            <span className="dsv2-badge">
              <FontAwesomeIcon icon={faLocationDot} /> {activeZones} {t("مناطق نشطة")}
            </span>
          </div>
        </div>
      </section>

      <section className="settings-attendance-v2-metrics" aria-label={t("ملخص إعدادات الحضور")}>
        {stats.map((item) => (
          <article key={item.label} className={`dsv2-metric-card ${item.tone}`}>
            <p className="dsv2-metric-card__label">{item.label}</p>
            <p className="dsv2-metric-card__value">{item.value}</p>
            <p className="dsv2-metric-card__meta">{item.hint}</p>
          </article>
        ))}
      </section>

      {message ? (
        <section className="dsv2-card dsv2-card--padded settings-attendance-v2-message" role="status">
          <span className="dsv2-badge dsv2-badge--gold">{t("حالة العملية")}</span>
          <p>{message}</p>
        </section>
      ) : null}

      <section className="dsv2-card dsv2-card--padded settings-attendance-v2-panel">
        <header className="settings-attendance-v2-panel__head">
          <div>
            <span className="settings-attendance-v2-panel__eyebrow">01</span>
            <h2>{t("سياسة تسجيل الحضور")}</h2>
            <p>{t("هذه الإعدادات تتحكم مباشرة بزر تسجيل الحضور داخل بوابة الموظف.")}</p>
          </div>
          <span className={`dsv2-badge ${hasAdminPower ? "dsv2-badge--success" : ""}`}>
            {hasAdminPower ? t("قابل للتعديل") : t("عرض فقط")}
          </span>
        </header>

        <div className="settings-attendance-v2-toggle-grid">
          {[
            {
              key: "enabled",
              enabled: attendance.enabled,
              title: "تفعيل تسجيل الحضور",
              hint: "عند الإيقاف لا يستطيع الموظف تسجيل حضور أو انصراف.",
              status: attendance.enabled ? "مفعل" : "متوقف",
              patch: { enabled: !attendance.enabled },
            },
            {
              key: "biometric",
              enabled: attendance.requireBiometric,
              title: "إلزام البصمة",
              hint: "يطلب الجهاز تحقق آمن قبل حفظ السجل.",
              status: attendance.requireBiometric ? "إلزامي" : "اختياري",
              patch: { requireBiometric: !attendance.requireBiometric },
            },
            {
              key: "zone",
              enabled: attendance.requireWorkZone,
              title: "إلزام منطقة العمل",
              hint: "يتحقق من GPS وRadius قبل البصمة والحفظ.",
              status: attendance.requireWorkZone ? "إلزامي" : "اختياري",
              patch: { requireWorkZone: !attendance.requireWorkZone },
            },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className={`settings-attendance-v2-toggle ${item.enabled ? "is-on" : ""}`}
              disabled={!hasAdminPower}
              aria-pressed={item.enabled}
              onClick={() => patchAttendance(item.patch)}
            >
              <span className="settings-attendance-v2-toggle__mark" aria-hidden="true">
                {item.enabled ? "✓" : ""}
              </span>
              <span className="settings-attendance-v2-toggle__copy">
                <strong>{t(item.title)}</strong>
                <small>{t(item.hint)}</small>
              </span>
              <span className="settings-attendance-v2-toggle__status">{t(item.status)}</span>
            </button>
          ))}
        </div>

        <div className="settings-attendance-v2-accuracy">
          <DashboardFieldV2 id="attendance-max-accuracy" label={t("أقصى دقة مسموحة للموقع بالمتر")}>
            <DashboardNumberInputV2
              id="attendance-max-accuracy"
              className="dsv2-input"
              min={10}
              step={5}
              value={attendance.maxLocationAccuracyMeters}
              disabled={!hasAdminPower}
              onChange={(event) =>
                patchAttendance({
                  maxLocationAccuracyMeters: Math.max(
                    10,
                    numberInput(Number(event.target.value), 120),
                  ),
                })
              }
            />
          </DashboardFieldV2>
        </div>
      </section>

      <section className="dsv2-card dsv2-card--padded settings-attendance-v2-panel">
        <header className="settings-attendance-v2-panel__head">
          <div>
            <span className="settings-attendance-v2-panel__eyebrow">02</span>
            <h2>{t("مناطق العمل Radius")}</h2>
            <p>{t("أضف كل فرع أو مشروع كنطاق مستقل. الموظفة تسجل فقط إذا كانت داخل أي نطاق نشط.")}</p>
          </div>
          <span className="dsv2-badge">{zones.length} {t("مناطق محفوظة")}</span>
        </header>

        <div className="settings-attendance-v2-zones-layout">
          <div className="settings-attendance-v2-zone-editor">
            <div className="settings-attendance-v2-map-card">
              {GOOGLE_MAPS_API_KEY ? (
                <div
                  className={`settings-attendance-v2-map settings-attendance-v2-map--google ${manualPickMode ? "is-center-pick" : ""}`}
                  ref={googleMapEl}
                >
                  {!mapReady ? (
                    <span className="settings-attendance-v2-map__loading">{t("جاري تحميل Google Maps...")}</span>
                  ) : null}
                  {manualPickMode ? (
                    <>
                      <span className="settings-attendance-v2-center-sight" aria-hidden="true"><i /></span>
                      <span className="settings-attendance-v2-center-instruction">
                        {t("حرّك الخريطة حتى يصبح المؤشر فوق المكان المطلوب، ثم اضغط اعتماد المركز.")}
                      </span>
                    </>
                  ) : null}
                  <span className="settings-attendance-v2-radius-label">
                    {t("النطاق")} {zoneDraft.radiusMeters} {language === "en" ? "m" : "م"}
                  </span>
                </div>
              ) : (
                <div
                  ref={manualMapRef}
                  className="settings-attendance-v2-map settings-attendance-v2-map--embed"
                >
                  <iframe
                    title="Google Maps"
                    src={googleMapsUrl}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    allowFullScreen
                  />
                  <span className="settings-attendance-v2-marker">
                    <FontAwesomeIcon icon={faLocationDot} />
                  </span>
                  <button
                    type="button"
                    className={`settings-attendance-v2-drag-surface ${manualPickMode ? "is-enabled" : ""} ${draggingMap ? "is-dragging" : ""}`}
                    disabled={!hasAdminPower}
                    onPointerDown={startEmbedDrag}
                    onPointerMove={moveEmbedDrag}
                    onPointerUp={stopEmbedDrag}
                    onPointerCancel={stopEmbedDrag}
                    aria-label={t("تحريك موقع منطقة العمل")}
                  />
                  <span ref={radiusOverlayRef} className="settings-attendance-v2-radius-overlay" aria-hidden="true" />
                  <span className="settings-attendance-v2-radius-label">Radius {zoneDraft.radiusMeters} {language === "en" ? "m" : "م"}</span>
                  <span className="settings-attendance-v2-map__warning">
                    {t("أضف VITE_GOOGLE_MAPS_API_KEY للتحديد بالسحب والضغط داخل الخريطة.")}
                  </span>
                </div>
              )}

              <div className="settings-attendance-v2-precision">
                <div className="settings-attendance-v2-precision__head">
                  <div>
                    <strong>{t("تحديد مركز المنطقة بدقة")}</strong>
                    <small>{t("ضغط أو سحب ثم تحريك متري للوصول للنقطة المطلوبة.")}</small>
                  </div>
                  <span className="dsv2-badge dsv2-badge--gold">{t("7 منازل عشرية")}</span>
                </div>

                <div className="settings-attendance-v2-control-grid">
                  <article className="settings-attendance-v2-control-card settings-attendance-v2-control-card--location">
                    <header>
                      <div><strong>{t("الموقع")}</strong><small>{t("اختيار سريع أو اعتماد مركز الخريطة")}</small></div>
                      <FontAwesomeIcon icon={faLocationDot} />
                    </header>
                    <div className="settings-attendance-v2-actions">
                      <button className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" type="button" disabled={!hasAdminPower || saving} onClick={useCurrentLocation}>
                        <FontAwesomeIcon icon={faLocationDot} /> {t("استخدام موقعي الحالي")}
                      </button>
                      <button
                        className={`dsv2-btn dsv2-btn--sm ${manualPickMode ? "dsv2-btn--primary" : "dsv2-btn--secondary"}`}
                        type="button"
                        disabled={!hasAdminPower || saving}
                        onClick={() => {
                          setManualMarkerOffset({ x: 0, y: 0 });
                          setManualPickMode((value) => !value);
                        }}
                      >
                        {manualPickMode ? t("إلغاء وضع المركز") : t("التحديد من مركز الخريطة")}
                      </button>
                      <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" disabled={!hasAdminPower || saving || !manualPickMode} onClick={adoptMapCenter}>
                        {t("اعتماد مركز الخريطة")}
                      </button>
                    </div>

                    <div className="settings-attendance-v2-nudge">
                      <div className="settings-attendance-v2-nudge__copy">
                        <strong>{t("تحريك دقيق")}</strong>
                        <small>{t("كل ضغطة تحرّك الموقع بالمقدار المحدد.")}</small>
                        <div className="settings-attendance-v2-chip-row" aria-label={t("مقدار التحريك")}>
                          {[1, 5, 10].map((step) => (
                            <button
                              key={step}
                              type="button"
                              className={nudgeMeters === step ? "is-active" : ""}
                              disabled={!hasAdminPower || saving}
                              onClick={() => setNudgeMeters(step)}
                            >
                              {step} {language === "en" ? "m" : "م"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-attendance-v2-direction-pad" aria-label={t("تحريك موقع المنطقة")}>
                        <button type="button" className="is-north" disabled={!hasAdminPower || saving} onClick={() => nudgeDraft(nudgeMeters, 0)} aria-label={`${t("تحريك شمال")} ${nudgeMeters} ${t("متر")}`}>↑<small>{t("شمال")}</small></button>
                        <button type="button" className="is-west" disabled={!hasAdminPower || saving} onClick={() => nudgeDraft(0, -nudgeMeters)} aria-label={`${t("تحريك غرب")} ${nudgeMeters} ${t("متر")}`}>←<small>{t("غرب")}</small></button>
                        <span>{nudgeMeters}{language === "en" ? "m" : "م"}</span>
                        <button type="button" className="is-east" disabled={!hasAdminPower || saving} onClick={() => nudgeDraft(0, nudgeMeters)} aria-label={`${t("تحريك شرق")} ${nudgeMeters} ${t("متر")}`}>→<small>{t("شرق")}</small></button>
                        <button type="button" className="is-south" disabled={!hasAdminPower || saving} onClick={() => nudgeDraft(-nudgeMeters, 0)} aria-label={`${t("تحريك جنوب")} ${nudgeMeters} ${t("متر")}`}>↓<small>{t("جنوب")}</small></button>
                      </div>
                    </div>
                  </article>

                  <article className="settings-attendance-v2-control-card settings-attendance-v2-control-card--radius">
                    <header><div><strong>{t("حجم النطاق")}</strong><small>{t("يتحدث على الخريطة فورًا")}</small></div><span>{zoneDraft.radiusMeters} {language === "en" ? "m" : "م"}</span></header>
                    <label className="settings-attendance-v2-radius-input">
                      <span>{t("نصف القطر بالمتر")}</span>
                      <DashboardNumberInputV2
                        className="dsv2-input"
                        min={MIN_RADIUS_METERS}
                        max={MAX_RADIUS_METERS}
                        step={1}
                        value={zoneDraft.radiusMeters}
                        disabled={!hasAdminPower}
                        onChange={(event) => setRadiusMeters(Number(event.target.value))}
                      />
                    </label>
                    <input
                      className="settings-attendance-v2-radius-range"
                      type="range"
                      min={MIN_RADIUS_METERS}
                      max={1000}
                      step={5}
                      value={Math.min(1000, zoneDraft.radiusMeters)}
                      disabled={!hasAdminPower}
                      onChange={(event) => setRadiusMeters(Number(event.target.value))}
                      aria-label={t("تغيير نصف قطر المنطقة")}
                    />
                    <div className="settings-attendance-v2-chip-row">
                      {RADIUS_PRESETS.map((radius) => (
                        <button
                          key={radius}
                          type="button"
                          className={zoneDraft.radiusMeters === radius ? "is-active" : ""}
                          disabled={!hasAdminPower || saving}
                          onClick={() => setRadiusMeters(radius)}
                        >
                          {radius} {language === "en" ? "m" : "م"}
                        </button>
                      ))}
                    </div>
                    <div className="settings-attendance-v2-fine-row">
                      <button type="button" disabled={!hasAdminPower || saving} onClick={() => changeRadius(-1)}>− 1 {language === "en" ? "m" : "م"}</button>
                      <button type="button" disabled={!hasAdminPower || saving} onClick={() => changeRadius(1)}>+ 1 {language === "en" ? "m" : "م"}</button>
                      <button type="button" disabled={!hasAdminPower || saving} onClick={() => changeRadius(-5)}>− 5 {language === "en" ? "m" : "م"}</button>
                      <button type="button" disabled={!hasAdminPower || saving} onClick={() => changeRadius(5)}>+ 5 {language === "en" ? "m" : "م"}</button>
                    </div>
                    <p>{t("قطر التغطية الكامل")}: <strong>{zoneDraft.radiusMeters * 2} {t("متر")}</strong></p>
                  </article>

                  <article className="settings-attendance-v2-control-card settings-attendance-v2-control-card--view">
                    <header><div><strong>{t("عرض الخريطة")}</strong><small>{t("التكبير لا يغيّر الموقع المحفوظ")}</small></div><span>Zoom {mapZoom}</span></header>
                    <div className="settings-attendance-v2-actions">
                      <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" disabled={saving} onClick={() => setMapZoom((value) => Math.max(3, value - 1))}>− {t("تصغير")}</button>
                      <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" disabled={saving} onClick={() => setMapZoom((value) => Math.min(21, value + 1))}>+ {t("تكبير")}</button>
                      <a className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" href={googleMapsOpenUrl} target="_blank" rel="noreferrer">{t("فتح في Google Maps")}</a>
                    </div>
                  </article>
                </div>

                <div className="settings-attendance-v2-selected-location">
                  <div><small>{t("الموقع المحدد")}</small><strong dir="ltr">{Number(zoneDraft.lat).toFixed(7)}, {Number(zoneDraft.lng).toFixed(7)}</strong></div>
                  <div><small>{t("نصف القطر")}</small><strong>{zoneDraft.radiusMeters} {t("متر")}</strong></div>
                  <div><small>{t("طريقة التعديل")}</small><strong>{manualPickMode ? t("مركز الخريطة") : t("ضغط / سحب / تحريك متري")}</strong></div>
                </div>
              </div>
            </div>

            <DashboardFieldV2 id="attendance-zone-name" label={t("اسم المنطقة")}>
              <input
                id="attendance-zone-name"
                className="dsv2-input"
                value={zoneDraft.name}
                disabled={!hasAdminPower}
                onChange={(event) => setZoneDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={t("مثال: الفرع الرئيسي")}
              />
            </DashboardFieldV2>

            <details className="settings-attendance-v2-advanced">
              <summary>{t("الإعدادات المتقدمة والإحداثيات اليدوية")}</summary>
              <div className="settings-attendance-v2-advanced__grid">
                <DashboardFieldV2 id="attendance-zone-lat" label={t("خط العرض lat")}>
                  <DashboardNumberInputV2
                    id="attendance-zone-lat"
                    className="dsv2-input"
                    step="0.0000001"
                    value={zoneDraft.lat}
                    disabled={!hasAdminPower}
                    onChange={(event) => setZoneDraft((current) => ({ ...current, lat: numberInput(Number(event.target.value), current.lat) }))}
                  />
                </DashboardFieldV2>
                <DashboardFieldV2 id="attendance-zone-lng" label={t("خط الطول lng")}>
                  <DashboardNumberInputV2
                    id="attendance-zone-lng"
                    className="dsv2-input"
                    step="0.0000001"
                    value={zoneDraft.lng}
                    disabled={!hasAdminPower}
                    onChange={(event) => setZoneDraft((current) => ({ ...current, lng: numberInput(Number(event.target.value), current.lng) }))}
                  />
                </DashboardFieldV2>
                <DashboardFieldV2 id="attendance-zone-radius" label={t("نصف القطر بالمتر")}>
                  <DashboardNumberInputV2
                    id="attendance-zone-radius"
                    className="dsv2-input"
                    min={MIN_RADIUS_METERS}
                    max={MAX_RADIUS_METERS}
                    value={zoneDraft.radiusMeters}
                    disabled={!hasAdminPower}
                    onChange={(event) => setRadiusMeters(Number(event.target.value))}
                  />
                </DashboardFieldV2>
              </div>
            </details>

            <button
              type="button"
              className={`settings-attendance-v2-toggle settings-attendance-v2-active-toggle ${zoneDraft.active ? "is-on" : ""}`}
              disabled={!hasAdminPower}
              aria-pressed={zoneDraft.active}
              onClick={() => setZoneDraft((current) => ({ ...current, active: !current.active }))}
            >
              <span className="settings-attendance-v2-toggle__mark">{zoneDraft.active ? "✓" : ""}</span>
              <span className="settings-attendance-v2-toggle__copy">
                <strong>{zoneDraft.active ? t("منطقة مفعلة") : t("منطقة متوقفة")}</strong>
                <small>{t("المناطق المتوقفة لا تستخدم في تحقق الموظفات.")}</small>
              </span>
              <span className="settings-attendance-v2-toggle__status">{zoneDraft.active ? t("نشطة") : t("متوقفة")}</span>
            </button>

            <div className="settings-attendance-v2-form-actions">
              <button className="dsv2-btn dsv2-btn--primary" type="button" disabled={!hasAdminPower || saving} onClick={saveZone}>
                <FontAwesomeIcon icon={faSave} /> {t("حفظ المنطقة")}
              </button>
              <button className="dsv2-btn dsv2-btn--secondary" type="button" disabled={!hasAdminPower || saving} onClick={useCurrentLocation}>
                <FontAwesomeIcon icon={faLocationDot} /> {t("استخدام موقعي")}
              </button>
              <button className="dsv2-btn dsv2-btn--secondary" type="button" disabled={!hasAdminPower || saving} onClick={resetZoneDraft}>
                <FontAwesomeIcon icon={faPlus} /> {t("منطقة جديدة")}
              </button>
            </div>
          </div>

          <aside className="settings-attendance-v2-zones-list">
            <div className="settings-attendance-v2-zones-list__head">
              <div>
                <strong>{t("المناطق المحفوظة")}</strong>
                <small>Firestore + Attendance Worker</small>
              </div>
              <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" disabled={zonesLoading} onClick={() => void loadZones()}>
                <FontAwesomeIcon icon={faRotateRight} /> {t("تحديث")}
              </button>
            </div>

            {zonesError ? (
              <DashboardErrorStateV2
                title={t("تعذر قراءة مناطق العمل")}
                description={zonesError}
                compact
              />
            ) : zonesLoading ? (
              <div className="settings-attendance-v2-zones-loading">
                <DashboardSkeletonV2 lines={3} width="100%" />
              </div>
            ) : zones.length ? (
              zones.map((zone) => (
                <article key={zone.id} className={`settings-attendance-v2-zone ${zone.active ? "is-active" : ""}`}>
                  <div className="settings-attendance-v2-zone__copy">
                    <div className="settings-attendance-v2-zone__title-row">
                      <strong>{zone.name}</strong>
                      <span className={`dsv2-badge ${zone.active ? "dsv2-badge--success" : ""}`}>
                        {zone.active ? t("مفعلة") : t("متوقفة")}
                      </span>
                    </div>
                    <small>ID: {zone.id}</small>
                    <span dir="ltr">{zone.lat.toFixed(5)}, {zone.lng.toFixed(5)}</span>
                    <span>Radius {zone.radiusMeters} {language === "en" ? "m" : "م"}</span>
                  </div>
                  <div className="settings-attendance-v2-zone__actions">
                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={!hasAdminPower || saving} onClick={() => editZone(zone)}>
                      {t("تعديل")}
                    </button>
                    <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={!hasAdminPower || saving} onClick={() => void deleteZone(zone.id)}>
                      <FontAwesomeIcon icon={faTrash} /> {t("حذف")}
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <DashboardEmptyStateV2
                title={t("لا توجد مناطق عمل")}
                description={t("أضف أول منطقة حتى يعمل تحقق GPS بشكل صحيح.")}
                tone="gold"
                compact
              />
            )}
          </aside>
        </div>
      </section>

      <section className="dsv2-card dsv2-card--padded settings-attendance-v2-savebar">
        <div>
          <strong>{t("تطبيق إعدادات الحضور")}</strong>
          <p>{t("الحفظ يزامن المناطق مع Attendance Worker ويحدّث إعدادات بوابة الموظف.")}</p>
        </div>
        <div className="settings-attendance-v2-savebar__actions">
          <button className="dsv2-btn dsv2-btn--secondary" type="button" disabled={saving} onClick={() => void load()}>
            <FontAwesomeIcon icon={faRotateRight} /> {t("تحديث")}
          </button>
          <button className="dsv2-btn dsv2-btn--primary" type="button" disabled={!hasAdminPower || saving} onClick={saveSettings}>
            <FontAwesomeIcon icon={faSave} /> {saving ? t("جاري الحفظ...") : t("حفظ إعدادات الحضور")}
          </button>
        </div>
      </section>
    </main>
  );
}
