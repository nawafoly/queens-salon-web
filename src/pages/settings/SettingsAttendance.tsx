import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFingerprint,
  faLocationDot,
  faPlus,
  faRotateRight,
  faSave,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { AppSettingsService, type AppSettings } from "../../services/AppSettingsService";
import {
  getBrowserPosition,
  listWorkZones,
  removeWorkZone,
  saveWorkZone,
  type WorkZone,
} from "../../services/attendanceSettingsService";
import {
  SettingsPageActions,
  SettingsPageHeader,
  SettingsSection,
  SettingsState,
  SettingsStats,
} from "./SettingsFrame";

import "../../styles/stylesSettings/DashboardSettings.css";

type Props = {
  hasAdminPower: boolean;
};

const emptyZone = {
  id: "",
  name: "",
  lat: 24.48914,
  lng: 39.5897,
  radiusMeters: 100,
  active: true,
};

const GOOGLE_MAPS_API_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
let googleMapsLoader: Promise<any> | null = null;

function numberInput(value: number, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function attendanceErrorMessage(error: unknown, fallback: string) {
  const err = (error || {}) as { code?: string; message?: string };
  const code = String(err.code || "").toLowerCase();
  const message = String(err.message || "").trim();

  if (code.includes("permission-denied")) {
    return "حساب هذه النافذة لا يملك صلاحية قراءة مناطق العمل. سجّل الدخول بحساب Owner / Admin / HR / Reception أو حددي نطاقًا مسموحًا للموظفة.";
  }
  if (code.includes("unavailable")) {
    return "تعذر الاتصال بـ Firestore مؤقتًا. جرّبي التحديث بعد لحظات.";
  }
  if (code.includes("failed-precondition")) {
    return "استعلام مناطق العمل يحتاج إعدادًا في Firestore. راجعي الـ console لمعرفة رابط الـ index إن وجد.";
  }

  return message || fallback;
}

function loadGoogleMaps() {
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&language=ar&region=SA&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("google_maps_load_failed"));
    document.head.appendChild(script);
  });

  return googleMapsLoader;
}

export default function SettingsAttendance({ hasAdminPower }: Props) {
  const [settings, setSettings] = useState<AppSettings>(() => AppSettingsService.getCached());
  const [zones, setZones] = useState<WorkZone[]>([]);
  const [zoneDraft, setZoneDraft] = useState(emptyZone);
  const [mapReady, setMapReady] = useState(false);
  const [draggingMap, setDraggingMap] = useState(false);
  const [manualPickMode, setManualPickMode] = useState(false);
  const [manualMarkerOffset, setManualMarkerOffset] = useState({ x: 0, y: 0 });
  const [mapZoom, setMapZoom] = useState(18);
  const [mapFrameCenter, setMapFrameCenter] = useState({
    lat: emptyZone.lat,
    lng: emptyZone.lng,
  });
  const [loading, setLoading] = useState(true);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [zonesError, setZonesError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const googleMapEl = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<any>(null);
  const googleMarkerRef = useRef<any>(null);
  const googleCircleRef = useRef<any>(null);
  const dragOriginRef = useRef<{ x: number; y: number; lat: number; lng: number } | null>(null);
  const latestZoneDraftRef = useRef(zoneDraft);

  const attendance = settings.attendance || AppSettingsService.getDefaults().attendance!;
  const activeZones = zones.filter((zone) => zone.active).length;
  const zoneLatRadians = (zoneDraft.lat * Math.PI) / 180;
  const metersPerPixel = (156543.03392 * Math.max(0.08, Math.cos(zoneLatRadians))) / 2 ** mapZoom;
  const visibleRadiusSize = Math.min(520, Math.max(38, (Math.max(10, zoneDraft.radiusMeters) * 2) / metersPerPixel));
  const googleMapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${mapFrameCenter.lat},${mapFrameCenter.lng}`)}&z=${mapZoom}&output=embed`;
  const googleMapsOpenUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${zoneDraft.lat},${zoneDraft.lng}`)}`;
  const manualMapStyle = {
    "--attendance-map-x": `${manualMarkerOffset.x}px`,
    "--attendance-map-y": `${manualMarkerOffset.y}px`,
  } as CSSProperties;
  const zoneDraftHasChanges =
    Boolean(zoneDraft.id) ||
    Boolean(zoneDraft.name.trim()) ||
    zoneDraft.lat !== emptyZone.lat ||
    zoneDraft.lng !== emptyZone.lng ||
    zoneDraft.radiusMeters !== emptyZone.radiusMeters ||
    zoneDraft.active !== emptyZone.active;

  const stats =
    [
      {
        label: "حالة النظام",
        value: attendance.enabled ? "مفعّل" : "متوقف",
        hint: "زر الحضور في بوابة الموظف",
      },
      {
        label: "البصمة",
        value: attendance.requireBiometric ? "إلزامية" : "اختيارية",
        hint: "تحقق داخلي مخصص للحضور فقط",
      },
      {
        label: "GPS وRadius",
        value: attendance.requireWorkZone ? "إلزامي" : "غير إلزامي",
        hint: `${activeZones} مناطق نشطة`,
      },
      {
        label: "الدقة المطلوبة",
        value: `${attendance.maxLocationAccuracyMeters} م`,
        hint: "أعلى هامش خطأ مسموح للموقع",
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
      setZonesError(attendanceErrorMessage(error, "تعذر تحميل مناطق العمل."));
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
        setMessage(attendanceErrorMessage(settingsResult.reason, "تعذر تحميل إعدادات الحضور."));
      }

      if (zonesResult.status === "fulfilled") {
        applyZonesResult(zonesResult.value);
      } else {
        setZones([]);
        setZonesError(attendanceErrorMessage(zonesResult.reason, "تعذر تحميل مناطق العمل."));
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
    if (!GOOGLE_MAPS_API_KEY || !googleMapEl.current) return;
    let disposed = false;

    loadGoogleMaps()
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

        const circle = new google.maps.Circle({
          map,
          center,
          radius: zoneDraft.radiusMeters,
          strokeColor: "#10b981",
          strokeOpacity: 0.85,
          strokeWeight: 2,
          fillColor: "#10b981",
          fillOpacity: 0.16,
        });

        map.addListener("click", (event: any) => {
          if (!hasAdminPower || !event.latLng) return;
          setZoneDraft((current) => ({
            ...current,
            lat: Number(event.latLng.lat().toFixed(6)),
            lng: Number(event.latLng.lng().toFixed(6)),
          }));
        });

        marker.addListener("dragend", (event: any) => {
          if (!hasAdminPower || !event.latLng) return;
          setZoneDraft((current) => ({
            ...current,
            lat: Number(event.latLng.lat().toFixed(6)),
            lng: Number(event.latLng.lng().toFixed(6)),
          }));
        });

        googleMapRef.current = map;
        googleMarkerRef.current = marker;
        googleCircleRef.current = circle;
        setMapReady(true);
      })
      .catch(() => {
        setMapReady(false);
      });

    return () => {
      disposed = true;
    };
  }, [hasAdminPower]);

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

  const saveSettings = async () => {
    if (!hasAdminPower) return;
    setSaving(true);
    setMessage("");
    try {
      if (zoneDraftHasChanges) {
        await saveWorkZone({
          ...zoneDraft,
          name: zoneDraft.name.trim() || "منطقة عمل جديدة",
        });
        applyZonesResult(await listWorkZones());
      }
      const saved = await AppSettingsService.saveRemote(settings);
      setSettings(saved);
      setMessage("تم حفظ إعدادات الحضور والبصمة.");
    } catch (error) {
      setMessage((error as any)?.message || "تعذر حفظ الإعدادات.");
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

  const saveZone = async () => {
    if (!hasAdminPower) return;
    if (false && !zoneDraft.name.trim()) {
      setMessage("اكتب اسم منطقة العمل أولاً.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await saveWorkZone({
        ...zoneDraft,
        name: zoneDraft.name.trim() || "منطقة عمل جديدة",
      });
      setZoneDraft(emptyZone);
      setMapFrameCenter({ lat: emptyZone.lat, lng: emptyZone.lng });
      setManualMarkerOffset({ x: 0, y: 0 });
      const nextZones = await listWorkZones();
      applyZonesResult(nextZones);
      setMessage("تم حفظ منطقة العمل.");
    } catch (error) {
      setMessage((error as any)?.message || "تعذر حفظ منطقة العمل.");
    } finally {
      setSaving(false);
    }
  };

  const deleteZone = async (id: string) => {
    if (!hasAdminPower) return;
    setSaving(true);
    setMessage("");
    try {
      await removeWorkZone(id);
      setZones((current) => current.filter((zone) => zone.id !== id));
      if (zoneDraft.id === id) setZoneDraft(emptyZone);
      setMessage("تم حذف منطقة العمل.");
    } catch (error) {
      setMessage((error as any)?.message || "تعذر حذف منطقة العمل.");
    } finally {
      setSaving(false);
    }
  };

  const useCurrentLocation = async () => {
    if (!hasAdminPower) return;
    setSaving(true);
    setMessage("جاري قراءة موقع الجهاز...");
    try {
      const location = await getBrowserPosition();
      setZoneDraft((current) => ({
        ...current,
        lat: location.lat,
        lng: location.lng,
      }));
      setMapFrameCenter({ lat: location.lat, lng: location.lng });
      setManualMarkerOffset({ x: 0, y: 0 });
      setMessage(`تم تحديد الموقع بدقة ${location.accuracy || 0} م.`);
    } catch (error) {
      setMessage((error as any)?.message || "تعذر قراءة الموقع.");
    } finally {
      setSaving(false);
    }
  };

  const changeRadius = (delta: number) => {
    if (!hasAdminPower) return;
    setZoneDraft((current) => ({
      ...current,
      radiusMeters: Math.max(10, Math.round(current.radiusMeters + delta)),
    }));
  };

  const moveDraftByPixels = (event: PointerEvent<HTMLElement>) => {
    if (!hasAdminPower) return;
    const origin = dragOriginRef.current;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    const latRad = (origin.lat * Math.PI) / 180;
    const dragMetersPerPixel = (156543.03392 * Math.max(0.08, Math.cos(latRad))) / 2 ** mapZoom;
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
    if (!draggingMap) return;
    moveDraftByPixels(event);
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
      <div className="settings-attendance">
        <SettingsState title="جاري تحميل الحضور والبصمة..." loading />
      </div>
    );
  }

  return (
    <div className="settings-attendance">
      <SettingsPageHeader
        eyebrow="الوحدة 06"
        title="الحضور والبصمة"
        hint="إدارة بصمة الموظفات، GPS، ومناطق Radius من صفحة واحدة واضحة."
        badges={
          <>
            <span className="settings-shell__pill settings-shell__pill--success">
              <FontAwesomeIcon icon={faFingerprint} /> بصمة مفعلة
            </span>
            <span className="settings-shell__pill settings-shell__pill--outline">
              <FontAwesomeIcon icon={faLocationDot} /> {activeZones} مناطق نشطة
            </span>
          </>
        }
      />

      <SettingsStats items={stats} />

      {message ? <div className="settings-attendance__message">{message}</div> : null}

      <SettingsSection
        eyebrow="01"
        title="سياسة تسجيل الحضور"
        hint="هذه الإعدادات تتحكم مباشرة بزر تسجيل الحضور داخل بوابة الموظف."
        className="settings-attendance__panel"
      >
        <div className="settings-toggle-grid settings-toggle-grid--policies">
          <button
            type="button"
            className={`settings-toggle-card ${attendance.enabled ? "is-on" : ""}`}
            disabled={!hasAdminPower}
            onClick={() => patchAttendance({ enabled: !attendance.enabled })}
          >
            <span className="settings-toggle-card__mark">{attendance.enabled ? "✓" : ""}</span>
            <span className="settings-toggle-card__copy">
              <strong>تفعيل تسجيل الحضور</strong>
              <small>عند الإيقاف لا يستطيع الموظف تسجيل حضور أو انصراف.</small>
            </span>
            <span className="settings-toggle-card__status">{attendance.enabled ? "مفعل" : "متوقف"}</span>
          </button>

          <button
            type="button"
            className={`settings-toggle-card ${attendance.requireBiometric ? "is-on" : ""}`}
            disabled={!hasAdminPower}
            onClick={() => patchAttendance({ requireBiometric: !attendance.requireBiometric })}
          >
            <span className="settings-toggle-card__mark">{attendance.requireBiometric ? "✓" : ""}</span>
            <span className="settings-toggle-card__copy">
              <strong>إلزام البصمة</strong>
              <small>يطلب الجهاز تحقق آمن قبل حفظ السجل.</small>
            </span>
            <span className="settings-toggle-card__status">{attendance.requireBiometric ? "إلزامي" : "اختياري"}</span>
          </button>

          <button
            type="button"
            className={`settings-toggle-card ${attendance.requireWorkZone ? "is-on" : ""}`}
            disabled={!hasAdminPower}
            onClick={() => patchAttendance({ requireWorkZone: !attendance.requireWorkZone })}
          >
            <span className="settings-toggle-card__mark">{attendance.requireWorkZone ? "✓" : ""}</span>
            <span className="settings-toggle-card__copy">
              <strong>إلزام منطقة العمل</strong>
              <small>يتحقق من GPS وRadius قبل البصمة والحفظ.</small>
            </span>
            <span className="settings-toggle-card__status">{attendance.requireWorkZone ? "إلزامي" : "اختياري"}</span>
          </button>
        </div>

        <div className="settings-attendance__accuracy">
          <label className="settings-field">
            <span>أقصى دقة مسموحة للموقع بالمتر</span>
            <input
              className="settings-input"
              type="number"
              min={10}
              step={5}
              value={attendance.maxLocationAccuracyMeters}
              disabled={!hasAdminPower}
              onChange={(event) =>
                patchAttendance({
                  maxLocationAccuracyMeters: Math.max(10, numberInput(Number(event.target.value), 120)),
                })
              }
            />
          </label>
        </div>
      </SettingsSection>

      <SettingsSection
        eyebrow="02"
        title="مناطق العمل Radius"
        hint="أضيفي كل فرع أو مشروع كنطاق مستقل. الموظفة تسجل فقط إذا كانت داخل أي نطاق نشط."
        className="settings-attendance__panel"
      >
        <div className="settings-attendance__zones-layout">
          <div className="settings-attendance__zone-form">
            <div className="settings-attendance__map-card">
              {GOOGLE_MAPS_API_KEY ? (
                <div className="settings-attendance__map settings-attendance__map--google" ref={googleMapEl}>
                  {!mapReady ? <span className="settings-attendance__map-loading">جاري تحميل Google Maps...</span> : null}
                  <span
                    className="settings-attendance__radius-overlay"
                    style={{ width: visibleRadiusSize, height: visibleRadiusSize }}
                    aria-hidden="true"
                  />
                  <span className="settings-attendance__marker" aria-hidden="true">
                    <FontAwesomeIcon icon={faLocationDot} />
                  </span>
                  <span className="settings-attendance__radius-label">
                    Radius {zoneDraft.radiusMeters} م
                  </span>
                </div>
              ) : (
                <div className="settings-attendance__map settings-attendance__map--embed" style={manualMapStyle}>
                  <iframe
                    title="Google Maps"
                    src={googleMapsUrl}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    allowFullScreen
                  />
                  <span className="settings-attendance__marker settings-attendance__marker--embed">
                    <FontAwesomeIcon icon={faLocationDot} />
                  </span>
                  <button
                    type="button"
                    className={`settings-attendance__drag-surface ${manualPickMode ? "is-enabled" : ""} ${draggingMap ? "is-dragging" : ""}`}
                    disabled={!hasAdminPower}
                    onPointerDown={startEmbedDrag}
                    onPointerMove={moveEmbedDrag}
                    onPointerUp={stopEmbedDrag}
                    onPointerCancel={stopEmbedDrag}
                    aria-label="تحريك موقع منطقة العمل"
                  />
                  <span
                    className="settings-attendance__radius-overlay"
                    style={{ width: visibleRadiusSize, height: visibleRadiusSize }}
                    aria-hidden="true"
                  />
                  <span className="settings-attendance__radius-label">
                    Radius {zoneDraft.radiusMeters} م
                  </span>
                  <span className="settings-attendance__map-key-warning">
                    أضيفي VITE_GOOGLE_MAPS_API_KEY للتحديد بالسحب والضغط داخل الخريطة.
                  </span>
                </div>
              )}

              <div className="settings-attendance__map-tools">
                <button
                  className={`exp-btn ${manualPickMode ? "primary" : ""}`}
                  type="button"
                  disabled={!hasAdminPower || saving}
                  onClick={() => {
                    setManualMarkerOffset({ x: 0, y: 0 });
                    setManualPickMode((value) => !value);
                  }}
                >
                  {manualPickMode ? "إيقاف التحديد اليدوي" : "تحديد يدوي"}
                </button>
                <button className="exp-btn" type="button" disabled={saving} onClick={() => setMapZoom((value) => Math.max(3, value - 1))}>
                  - خريطة
                </button>
                <button className="exp-btn" type="button" disabled={saving} onClick={() => setMapZoom((value) => Math.min(21, value + 1))}>
                  + خريطة
                </button>
                <button className="exp-btn" type="button" disabled={!hasAdminPower || saving} onClick={useCurrentLocation}>
                  <FontAwesomeIcon icon={faLocationDot} /> استخدام موقعي
                </button>
                <button className="exp-btn" type="button" disabled={!hasAdminPower || saving} onClick={() => changeRadius(-10)}>
                  - Radius
                </button>
                <button className="exp-btn" type="button" disabled={!hasAdminPower || saving} onClick={() => changeRadius(10)}>
                  + Radius
                </button>
                <a className="exp-btn" href={googleMapsOpenUrl} target="_blank" rel="noreferrer">
                  فتح في Google Maps
                </a>
                <span className="settings-attendance__map-coords">
                  lat {Number(zoneDraft.lat).toFixed(5)} | lng {Number(zoneDraft.lng).toFixed(5)} | Radius {zoneDraft.radiusMeters} م
                </span>
              </div>
            </div>

            <label className="settings-field settings-field--wide">
              <span>اسم المنطقة</span>
              <input
                className="settings-input"
                value={zoneDraft.name}
                disabled={!hasAdminPower}
                onChange={(event) => setZoneDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="مثال: الفرع الرئيسي"
              />
            </label>

            <label className="settings-field">
              <span>خط العرض lat</span>
              <input
                className="settings-input"
                type="number"
                value={zoneDraft.lat}
                disabled={!hasAdminPower}
                onChange={(event) => setZoneDraft((current) => ({ ...current, lat: numberInput(Number(event.target.value), current.lat) }))}
              />
            </label>

            <label className="settings-field">
              <span>خط الطول lng</span>
              <input
                className="settings-input"
                type="number"
                value={zoneDraft.lng}
                disabled={!hasAdminPower}
                onChange={(event) => setZoneDraft((current) => ({ ...current, lng: numberInput(Number(event.target.value), current.lng) }))}
              />
            </label>

            <label className="settings-field">
              <span>Radius بالمتر</span>
              <input
                className="settings-input"
                type="number"
                min={10}
                value={zoneDraft.radiusMeters}
                disabled={!hasAdminPower}
                onChange={(event) => setZoneDraft((current) => ({ ...current, radiusMeters: Math.max(10, numberInput(Number(event.target.value), 100)) }))}
              />
            </label>

            <button
              type="button"
              className={`settings-toggle-card settings-attendance__active-toggle ${zoneDraft.active ? "is-on" : ""}`}
              disabled={!hasAdminPower}
              onClick={() => setZoneDraft((current) => ({ ...current, active: !current.active }))}
            >
              <span className="settings-toggle-card__mark">{zoneDraft.active ? "✓" : ""}</span>
              <span className="settings-toggle-card__copy">
                <strong>{zoneDraft.active ? "منطقة مفعلة" : "منطقة متوقفة"}</strong>
                <small>المناطق المتوقفة لا تستخدم في تحقق الموظفات.</small>
              </span>
            </button>

            <div className="settings-attendance__form-actions">
              <button className="exp-btn primary" type="button" disabled={!hasAdminPower || saving} onClick={saveZone}>
                <FontAwesomeIcon icon={faSave} /> حفظ المنطقة
              </button>
              <button className="exp-btn" type="button" disabled={!hasAdminPower || saving} onClick={useCurrentLocation}>
                <FontAwesomeIcon icon={faLocationDot} /> استخدام موقعي
              </button>
              <button
                className="exp-btn"
                type="button"
                disabled={!hasAdminPower || saving}
                onClick={() => {
                  setZoneDraft(emptyZone);
                  setMapFrameCenter({ lat: emptyZone.lat, lng: emptyZone.lng });
                  setManualMarkerOffset({ x: 0, y: 0 });
                }}
              >
                <FontAwesomeIcon icon={faPlus} /> منطقة جديدة
              </button>
            </div>
          </div>

          <div className="settings-attendance__zones-list">
            {zonesError ? (
              <div className="settings-attendance__zones-alert">
                <strong>تعذر قراءة مناطق العمل</strong>
                <span>{zonesError}</span>
                <button className="exp-btn" type="button" disabled={zonesLoading} onClick={() => void loadZones()}>
                  <FontAwesomeIcon icon={faRotateRight} /> إعادة المحاولة
                </button>
              </div>
            ) : zonesLoading ? (
              <SettingsState title="جاري تحميل مناطق العمل..." loading />
            ) : zones.length ? (
              zones.map((zone) => (
                <article key={zone.id} className={`settings-attendance__zone ${zone.active ? "is-active" : ""}`}>
                  <div>
                    <strong>{zone.name}</strong>
                    <small>ID: {zone.id}</small>
                    <span>{zone.lat.toFixed(5)}, {zone.lng.toFixed(5)} · Radius {zone.radiusMeters} م</span>
                  </div>
                  <div className="settings-attendance__zone-actions">
                    <span className={`settings-shell__pill ${zone.active ? "settings-shell__pill--success" : "settings-shell__pill--outline"}`}>
                      {zone.active ? "مفعلة" : "متوقفة"}
                    </span>
                    <button type="button" className="exp-btn" disabled={!hasAdminPower || saving} onClick={() => editZone(zone)}>
                      تعديل
                    </button>
                    <button type="button" className="exp-btn danger" disabled={!hasAdminPower || saving} onClick={() => void deleteZone(zone.id)}>
                      <FontAwesomeIcon icon={faTrash} /> حذف
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <SettingsState title="لا توجد مناطق عمل" hint="أضيفي أول منطقة حتى يعمل تحقق GPS بشكل صحيح." />
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsPageActions
        note="الحفظ هنا يطبق مباشرة على بوابة الموظف وزر تسجيل الحضور."
        actions={
          <>
            <button className="exp-btn" type="button" disabled={saving} onClick={() => void load()}>
              <FontAwesomeIcon icon={faRotateRight} /> تحديث
            </button>
            <button className="exp-btn primary" type="button" disabled={!hasAdminPower || saving} onClick={saveSettings}>
              <FontAwesomeIcon icon={faSave} /> حفظ إعدادات الحضور
            </button>
          </>
        }
      />
    </div>
  );
}
