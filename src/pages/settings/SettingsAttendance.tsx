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
  deleteWorkZoneFromAttendanceWorker,
  upsertWorkZoneInAttendanceWorker,
} from "../../services/attendanceWorkerService";
import {
  SettingsPageActions,
  SettingsPageHeader,
  SettingsSection,
  SettingsState,
  SettingsStats,
} from "./SettingsFrame";
import "../../styles/SettingsAttendancePrecision.css";

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

const RADIUS_PRESETS = [25, 50, 100, 150, 200, 300];
const MIN_RADIUS_METERS = 10;
const MAX_RADIUS_METERS = 5000;

function clampRadius(value: number, fallback = 100) {
  const normalized = Number.isFinite(value) ? value : fallback;
  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.round(normalized)));
}

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
  const [nudgeMeters, setNudgeMeters] = useState(5);
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
  const manualPickModeRef = useRef(manualPickMode);

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
    manualPickModeRef.current = manualPickMode;
  }, [manualPickMode]);

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
          name: zoneDraft.name.trim() || "منطقة عمل جديدة",
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
      const savedZone = await saveWorkZone({
        ...zoneDraft,
        name: zoneDraft.name.trim() || "منطقة عمل جديدة",
      });
      await upsertWorkZoneInAttendanceWorker(savedZone);
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
      await deleteWorkZoneFromAttendanceWorker(id);
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
      lng: Number((current.lng + eastMeters / (111320 * Math.max(0.08, Math.cos(latitudeRadians)))).toFixed(7)),
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
    setMessage("تم اعتماد مركز الخريطة كموقع المنطقة.");
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
                <div
                  className={`settings-attendance__map settings-attendance__map--google ${manualPickMode ? "is-center-pick" : ""}`}
                  ref={googleMapEl}
                >
                  {!mapReady ? <span className="settings-attendance__map-loading">جاري تحميل Google Maps...</span> : null}
                  {manualPickMode ? (
                    <>
                      <span className="settings-attendance__center-sight" aria-hidden="true"><i /></span>
                      <span className="settings-attendance__center-instruction">حرّك الخريطة حتى يصبح المؤشر فوق المكان المطلوب، ثم اضغط اعتماد المركز.</span>
                    </>
                  ) : null}
                  <span className="settings-attendance__radius-label settings-attendance__radius-label--google">
                    النطاق {zoneDraft.radiusMeters} م
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

              <div className="settings-attendance__precision-controls">
                <div className="settings-attendance__precision-head">
                  <div>
                    <strong>تحديد مركز المنطقة بدقة</strong>
                    <small>اضغط على الخريطة أو اسحب العلامة، ثم استخدم التحريك المتري للوصول للنقطة الدقيقة.</small>
                  </div>
                  <span className="settings-attendance__selection-state">
                    دقة الإحداثيات: 7 منازل عشرية
                  </span>
                </div>

                <div className="settings-attendance__precision-grid">
                  <section className="settings-attendance__control-card settings-attendance__control-card--location">
                    <header>
                      <div><strong>الموقع</strong><small>اختيار سريع أو اعتماد مركز الخريطة</small></div>
                      <FontAwesomeIcon icon={faLocationDot} />
                    </header>
                    <div className="settings-attendance__location-actions">
                      <button className="exp-btn primary" type="button" disabled={!hasAdminPower || saving} onClick={useCurrentLocation}>
                        <FontAwesomeIcon icon={faLocationDot} /> استخدام موقعي الحالي
                      </button>
                      <button
                        className={`exp-btn ${manualPickMode ? "primary" : ""}`}
                        type="button"
                        disabled={!hasAdminPower || saving}
                        onClick={() => {
                          setManualMarkerOffset({ x: 0, y: 0 });
                          setManualPickMode((value) => !value);
                        }}
                      >
                        {manualPickMode ? "إلغاء وضع مركز الخريطة" : "التحديد من مركز الخريطة"}
                      </button>
                      <button className="exp-btn" type="button" disabled={!hasAdminPower || saving || !manualPickMode} onClick={adoptMapCenter}>
                        اعتماد مركز الخريطة
                      </button>
                    </div>

                    <div className="settings-attendance__nudge-panel">
                      <div className="settings-attendance__nudge-copy">
                        <strong>تحريك دقيق</strong>
                        <small>كل ضغطة تحرّك الموقع بالمقدار المحدد.</small>
                        <div className="settings-attendance__nudge-steps" aria-label="مقدار التحريك">
                          {[1, 5, 10].map((step) => (
                            <button
                              key={step}
                              type="button"
                              className={nudgeMeters === step ? "is-active" : ""}
                              onClick={() => setNudgeMeters(step)}
                            >
                              {step} م
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-attendance__direction-pad" aria-label="تحريك موقع المنطقة">
                        <button type="button" className="is-north" disabled={!hasAdminPower || saving} onClick={() => nudgeDraft(nudgeMeters, 0)} aria-label={`تحريك شمال ${nudgeMeters} متر`}>↑<small>شمال</small></button>
                        <button type="button" className="is-west" disabled={!hasAdminPower || saving} onClick={() => nudgeDraft(0, -nudgeMeters)} aria-label={`تحريك غرب ${nudgeMeters} متر`}>←<small>غرب</small></button>
                        <span>{nudgeMeters}م</span>
                        <button type="button" className="is-east" disabled={!hasAdminPower || saving} onClick={() => nudgeDraft(0, nudgeMeters)} aria-label={`تحريك شرق ${nudgeMeters} متر`}>→<small>شرق</small></button>
                        <button type="button" className="is-south" disabled={!hasAdminPower || saving} onClick={() => nudgeDraft(-nudgeMeters, 0)} aria-label={`تحريك جنوب ${nudgeMeters} متر`}>↓<small>جنوب</small></button>
                      </div>
                    </div>
                  </section>

                  <section className="settings-attendance__control-card settings-attendance__control-card--radius">
                    <header><div><strong>حجم النطاق</strong><small>يتحدث على الخريطة فورًا</small></div><span>{zoneDraft.radiusMeters} م</span></header>
                    <label className="settings-attendance__radius-input">
                      <span>نصف القطر بالمتر</span>
                      <input
                        type="number"
                        min={MIN_RADIUS_METERS}
                        max={MAX_RADIUS_METERS}
                        step={1}
                        value={zoneDraft.radiusMeters}
                        disabled={!hasAdminPower}
                        onChange={(event) => setRadiusMeters(Number(event.target.value))}
                      />
                    </label>
                    <input
                      className="settings-attendance__radius-range"
                      type="range"
                      min={MIN_RADIUS_METERS}
                      max={1000}
                      step={5}
                      value={Math.min(1000, zoneDraft.radiusMeters)}
                      disabled={!hasAdminPower}
                      onChange={(event) => setRadiusMeters(Number(event.target.value))}
                      aria-label="تغيير نصف قطر المنطقة"
                    />
                    <div className="settings-attendance__radius-presets">
                      {RADIUS_PRESETS.map((radius) => (
                        <button
                          key={radius}
                          type="button"
                          className={zoneDraft.radiusMeters === radius ? "is-active" : ""}
                          disabled={!hasAdminPower || saving}
                          onClick={() => setRadiusMeters(radius)}
                        >
                          {radius} م
                        </button>
                      ))}
                    </div>
                    <div className="settings-attendance__radius-fine">
                      <button type="button" disabled={!hasAdminPower || saving} onClick={() => changeRadius(-1)}>− 1 م</button>
                      <button type="button" disabled={!hasAdminPower || saving} onClick={() => changeRadius(1)}>+ 1 م</button>
                      <button type="button" disabled={!hasAdminPower || saving} onClick={() => changeRadius(-5)}>− 5 م</button>
                      <button type="button" disabled={!hasAdminPower || saving} onClick={() => changeRadius(5)}>+ 5 م</button>
                    </div>
                    <p>قطر التغطية الكامل: <strong>{zoneDraft.radiusMeters * 2} متر</strong></p>
                  </section>

                  <section className="settings-attendance__control-card settings-attendance__control-card--view">
                    <header><div><strong>عرض الخريطة</strong><small>التكبير لا يغيّر الموقع المحفوظ</small></div><span>Zoom {mapZoom}</span></header>
                    <div className="settings-attendance__view-actions">
                      <button className="exp-btn" type="button" disabled={saving} onClick={() => setMapZoom((value) => Math.max(3, value - 1))}>− تصغير</button>
                      <button className="exp-btn" type="button" disabled={saving} onClick={() => setMapZoom((value) => Math.min(21, value + 1))}>+ تكبير</button>
                      <a className="exp-btn" href={googleMapsOpenUrl} target="_blank" rel="noreferrer">فتح في Google Maps</a>
                    </div>
                  </section>
                </div>

                <div className="settings-attendance__selected-location">
                  <div><small>الموقع المحدد</small><strong dir="ltr">{Number(zoneDraft.lat).toFixed(7)}, {Number(zoneDraft.lng).toFixed(7)}</strong></div>
                  <div><small>نصف القطر</small><strong>{zoneDraft.radiusMeters} متر</strong></div>
                  <div><small>طريقة التعديل</small><strong>{manualPickMode ? "مركز الخريطة" : "ضغط / سحب / تحريك متري"}</strong></div>
                </div>
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

            <details className="settings-attendance__advanced">
              <summary>الإعدادات المتقدمة والإحداثيات اليدوية</summary>
              <div className="settings-attendance__advanced-grid">
                <label className="settings-field">
                  <span>خط العرض lat</span>
                  <input
                    className="settings-input"
                    type="number"
                    step="0.0000001"
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
                    step="0.0000001"
                    value={zoneDraft.lng}
                    disabled={!hasAdminPower}
                    onChange={(event) => setZoneDraft((current) => ({ ...current, lng: numberInput(Number(event.target.value), current.lng) }))}
                  />
                </label>
                <label className="settings-field">
                  <span>نصف القطر بالمتر</span>
                  <input
                    className="settings-input"
                    type="number"
                    min={MIN_RADIUS_METERS}
                    max={MAX_RADIUS_METERS}
                    value={zoneDraft.radiusMeters}
                    disabled={!hasAdminPower}
                    onChange={(event) => setRadiusMeters(Number(event.target.value))}
                  />
                </label>
              </div>
            </details>

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
