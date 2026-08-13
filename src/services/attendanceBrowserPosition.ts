export type AttendanceLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
};

export type AttendancePositionOptions = PositionOptions & {
  targetAccuracyMeters?: number;
  acceptableAccuracyMeters?: number;
  acceptableReadingDelayMs?: number;
  acceptFirstUsableReading?: boolean;
  freshCacheMaxAgeMs?: number;
  useFreshLocationCache?: boolean;
};

export type AttendanceLocationCacheEntry = AttendanceLocation & {
  capturedAt: number;
};

export type FreshAttendanceLocationCacheHit = AttendanceLocationCacheEntry & {
  ageMs: number;
};

type AttendanceLocationSource =
  | "memory-cache"
  | "browser-cache"
  | "watch"
  | "timeout-best";

export const DEFAULT_ATTENDANCE_LOCATION_CACHE_MAX_AGE_MS = 8000;

const MAX_BROWSER_CACHE_AGE_MS = 10000;
const MAX_LOCATION_TIMEOUT_MS = 30000;
const DEFAULT_LOCATION_TIMEOUT_MS = 20000;

let latestSuccessfulLocation: AttendanceLocationCacheEntry | null = null;

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampMilliseconds(value: unknown, args: {
  fallback: number;
  min: number;
  max: number;
}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return args.fallback;
  return Math.min(args.max, Math.max(args.min, Math.round(number)));
}

function normalizeAccuracy(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.round(number))
    : undefined;
}

function isValidLatLng(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

function cloneLocation(location: AttendanceLocation): AttendanceLocation {
  return {
    lat: location.lat,
    lng: location.lng,
    accuracy: location.accuracy,
  };
}

function toCacheEntry(
  location: AttendanceLocation,
  capturedAt = Date.now()
): AttendanceLocationCacheEntry | null {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);

  if (!isValidLatLng(lat, lng)) return null;

  const accuracy = normalizeAccuracy(location?.accuracy);

  return {
    lat,
    lng,
    ...(accuracy === undefined ? {} : { accuracy }),
    capturedAt: Math.max(0, Math.round(safeNumber(capturedAt, Date.now()))),
  };
}

function isAccurateEnough(
  location: AttendanceLocation,
  acceptableAccuracyMeters: number
) {
  const accuracy = normalizeAccuracy(location.accuracy);
  return (
    accuracy !== undefined &&
    accuracy > 0 &&
    accuracy <= acceptableAccuracyMeters
  );
}

function isAttendanceLocationDebugEnabled() {
  return Boolean((import.meta as any).env?.DEV);
}

function logAttendanceLocation(message: string) {
  if (!isAttendanceLocationDebugEnabled()) return;
  console.info(`[attendance-location] ${message}`);
}

function geolocationErrorCode(error: GeolocationPositionError | null | undefined) {
  return Number(error?.code || 0);
}

function geolocationPermissionDeniedCode(
  error: GeolocationPositionError | null | undefined
) {
  return Number((error as any)?.PERMISSION_DENIED || 1);
}

function geolocationTimeoutCode(error: GeolocationPositionError | null | undefined) {
  return Number((error as any)?.TIMEOUT || 3);
}

function cacheEntryFromPosition(
  position: GeolocationPosition,
  capturedAtFallback = Date.now()
) {
  const timestamp = safeNumber(position.timestamp, capturedAtFallback);
  return toCacheEntry(
    {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
    },
    timestamp > 0 ? timestamp : capturedAtFallback
  );
}

export function clearAttendanceLocationCache() {
  latestSuccessfulLocation = null;
}

export function rememberAttendanceLocation(
  location: AttendanceLocation,
  capturedAt = Date.now()
) {
  const entry = toCacheEntry(location, capturedAt);
  if (!entry) return null;

  latestSuccessfulLocation = entry;
  return { ...entry };
}

export function readFreshAttendanceLocationCache(args: {
  now?: number;
  maxAgeMs?: number;
  acceptableAccuracyMeters?: number;
} = {}): FreshAttendanceLocationCacheHit | null {
  if (!latestSuccessfulLocation) return null;

  const now = Math.max(0, Math.round(safeNumber(args.now, Date.now())));
  const maxAgeMs = Math.max(
    0,
    Math.round(
      safeNumber(
        args.maxAgeMs,
        DEFAULT_ATTENDANCE_LOCATION_CACHE_MAX_AGE_MS
      )
    )
  );
  const acceptableAccuracyMeters = Math.max(
    0,
    Math.round(safeNumber(args.acceptableAccuracyMeters, 150))
  );
  const ageMs = Math.max(0, now - latestSuccessfulLocation.capturedAt);

  if (maxAgeMs <= 0 || ageMs > maxAgeMs) return null;
  if (
    !isAccurateEnough(
      latestSuccessfulLocation,
      acceptableAccuracyMeters
    )
  ) {
    return null;
  }

  return {
    ...latestSuccessfulLocation,
    ageMs,
  };
}

export function getBrowserPosition(
  options?: AttendancePositionOptions
): Promise<AttendanceLocation> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new Error("الموقع غير مدعوم في هذا المتصفح."));
  }

  const timeoutMs = clampMilliseconds(options?.timeout, {
    fallback: DEFAULT_LOCATION_TIMEOUT_MS,
    min: 5000,
    max: MAX_LOCATION_TIMEOUT_MS,
  });
  const explicitMaximumAge = Number(options?.maximumAge);
  const maximumAgeMs =
    Number.isFinite(explicitMaximumAge) && explicitMaximumAge >= 0
      ? Math.min(MAX_BROWSER_CACHE_AGE_MS, Math.round(explicitMaximumAge))
      : DEFAULT_ATTENDANCE_LOCATION_CACHE_MAX_AGE_MS;
  const targetAccuracyMeters = Math.max(
    10,
    Math.round(safeNumber(options?.targetAccuracyMeters, 50))
  );
  const acceptableAccuracyMeters = Math.max(
    targetAccuracyMeters,
    Math.round(safeNumber(options?.acceptableAccuracyMeters, 150))
  );
  const acceptableReadingDelayMs = Math.min(
    3500,
    Math.max(
      400,
      Math.round(safeNumber(options?.acceptableReadingDelayMs, 1200))
    )
  );
  const freshCacheMaxAgeMs =
    options?.useFreshLocationCache === false
      ? 0
      : clampMilliseconds(options?.freshCacheMaxAgeMs, {
          fallback: DEFAULT_ATTENDANCE_LOCATION_CACHE_MAX_AGE_MS,
          min: 0,
          max: MAX_BROWSER_CACHE_AGE_MS,
        });
  const acceptFirstUsableReading = options?.acceptFirstUsableReading === true;
  const startedAt = Date.now();
  const memoryCacheHit = readFreshAttendanceLocationCache({
    now: startedAt,
    maxAgeMs: freshCacheMaxAgeMs,
    acceptableAccuracyMeters,
  });

  if (memoryCacheHit) {
    logAttendanceLocation(
      `source=memory-cache age=${memoryCacheHit.ageMs}ms accuracy=${memoryCacheHit.accuracy}`
    );
    logAttendanceLocation(`resolved-in=${Date.now() - startedAt}ms`);
    return Promise.resolve(cloneLocation(memoryCacheHit));
  }

  const browserMaximumAgeMs = Math.max(maximumAgeMs, freshCacheMaxAgeMs);
  const positionOptions: PositionOptions = {
    enableHighAccuracy: options?.enableHighAccuracy !== false,
    timeout: timeoutMs,
    maximumAge: browserMaximumAgeMs,
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let watchId: number | null = null;
    let stopTimer: number | null = null;
    let acceptableReadingTimer: number | null = null;
    let readingCount = 0;
    let bestLocation: AttendanceLocation | null = null;
    let bestLocationSource: AttendanceLocationSource = "watch";

    const cleanup = () => {
      if (stopTimer !== null) {
        window.clearTimeout(stopTimer);
        stopTimer = null;
      }

      if (acceptableReadingTimer !== null) {
        window.clearTimeout(acceptableReadingTimer);
        acceptableReadingTimer = null;
      }

      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    };

    const finishSuccess = (source: AttendanceLocationSource) => {
      if (settled || !bestLocation) return;

      settled = true;

      const resolvedLocation = cloneLocation(bestLocation);
      const shouldCache = isAccurateEnough(
        resolvedLocation,
        acceptableAccuracyMeters
      );

      if (shouldCache) {
        rememberAttendanceLocation(resolvedLocation);
      }

      cleanup();
      logAttendanceLocation(
        `source=${source} accuracy=${resolvedLocation.accuracy}`
      );
      logAttendanceLocation(`resolved-in=${Date.now() - startedAt}ms`);
      resolve(resolvedLocation);
    };

    const finishError = (message: string) => {
      if (settled) return;

      settled = true;
      cleanup();
      logAttendanceLocation(`resolved-in=${Date.now() - startedAt}ms error=1`);
      reject(new Error(message));
    };

    const handlePosition = (
      position: GeolocationPosition,
      source: AttendanceLocationSource
    ) => {
      if (settled) return;

      const capturedAtFallback = Date.now();
      const entry = cacheEntryFromPosition(position, capturedAtFallback);
      if (!entry) return;

      if (
        source === "browser-cache" &&
        capturedAtFallback - entry.capturedAt > browserMaximumAgeMs
      ) {
        logAttendanceLocation(
          `source=browser-cache ignored=stale age=${capturedAtFallback - entry.capturedAt}ms`
        );
        return;
      }

      const nextLocation = cloneLocation(entry);
      const nextAccuracy = nextLocation.accuracy ?? Number.MAX_SAFE_INTEGER;
      const bestAccuracy =
        bestLocation?.accuracy ?? Number.MAX_SAFE_INTEGER;

      readingCount += 1;

      if (!bestLocation || nextAccuracy < bestAccuracy) {
        bestLocation = nextLocation;
        bestLocationSource = source;
      }

      logAttendanceLocation(
        `sample=${readingCount} source=${source} accuracy=${nextLocation.accuracy} best=${bestLocation.accuracy}`
      );

      if (
        nextAccuracy > 0 &&
        nextAccuracy <= targetAccuracyMeters
      ) {
        finishSuccess(source);
        return;
      }

      if (
        nextAccuracy > 0 &&
        nextAccuracy <= acceptableAccuracyMeters
      ) {
        if (acceptFirstUsableReading) {
          finishSuccess(source);
          return;
        }

        if (acceptableReadingTimer === null) {
          acceptableReadingTimer = window.setTimeout(
            () => finishSuccess(bestLocationSource),
            acceptableReadingDelayMs
          );
        }
      }
    };

    stopTimer = window.setTimeout(() => {
      if (bestLocation) {
        finishSuccess("timeout-best");
        return;
      }

      finishError(
        "تعذر الحصول على قراءة دقيقة للموقع. فعّل GPS وWi-Fi ثم حاول مرة أخرى."
      );
    }, timeoutMs + 1500);

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => handlePosition(position, "browser-cache"),
        (error) => {
          if (
            geolocationErrorCode(error) ===
            geolocationPermissionDeniedCode(error)
          ) {
            finishError(
              "اسمح بالوصول إلى الموقع حتى يتم تسجيل الحضور."
            );
          }
        },
        {
          ...positionOptions,
          timeout: Math.min(1200, timeoutMs),
        }
      );

      if (settled) return;

      watchId = navigator.geolocation.watchPosition(
        (position) => handlePosition(position, "watch"),
        (error) => {
          if (
            geolocationErrorCode(error) ===
            geolocationPermissionDeniedCode(error)
          ) {
            finishError(
              "اسمح بالوصول إلى الموقع حتى يتم تسجيل الحضور."
            );
            return;
          }

          if (bestLocation) {
            finishSuccess(bestLocationSource);
            return;
          }

          if (
            geolocationErrorCode(error) ===
            geolocationTimeoutCode(error)
          ) {
            finishError(
              "انتهت مهلة تحديد الموقع. فعّل GPS وWi-Fi ثم حاول مرة أخرى."
            );
            return;
          }

          finishError(
            "تعذر قراءة موقعك الحالي. فعّل GPS وWi-Fi ثم حاول مرة أخرى."
          );
        },
        positionOptions
      );

      if (settled && watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    } catch {
      finishError(
        "تعذر تشغيل خدمة الموقع في هذا الجهاز."
      );
    }
  });
}
