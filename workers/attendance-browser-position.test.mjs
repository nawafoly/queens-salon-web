import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  clearAttendanceLocationCache,
  getBrowserPosition,
  readFreshAttendanceLocationCache,
  rememberAttendanceLocation,
} from "../src/services/attendanceBrowserPosition.ts";

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator"
);
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "window"
);

function position({
  lat = 24.7136,
  lng = 46.6753,
  accuracy = 80,
  timestamp = Date.now(),
} = {}) {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy,
    },
    timestamp,
  };
}

function createTimerHost() {
  let nextId = 1;
  const pending = new Map();
  const cleared = [];

  return {
    host: {
      setTimeout(callback, delay) {
        const id = nextId++;
        pending.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        cleared.push(id);
        pending.delete(id);
      },
    },
    cleared,
    pendingCount() {
      return pending.size;
    },
    runNext() {
      const [id, timer] = pending.entries().next().value || [];
      if (!timer) return false;
      pending.delete(id);
      timer.callback();
      return true;
    },
  };
}

function installGeolocation(geolocation) {
  const timers = createTimerHost();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: timers.host,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { geolocation },
  });

  return timers;
}

function restoreGlobals() {
  clearAttendanceLocationCache();

  if (originalNavigatorDescriptor) {
    Object.defineProperty(
      globalThis,
      "navigator",
      originalNavigatorDescriptor
    );
  } else {
    delete globalThis.navigator;
  }

  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    delete globalThis.window;
  }
}

test.afterEach(restoreGlobals);

test("fresh valid cached location resolves without a new geolocation request", async () => {
  let currentCalls = 0;
  let watchCalls = 0;
  installGeolocation({
    getCurrentPosition() {
      currentCalls += 1;
    },
    watchPosition() {
      watchCalls += 1;
      return 1;
    },
    clearWatch() {},
  });

  rememberAttendanceLocation(
    { lat: 24.7136, lng: 46.6753, accuracy: 85 },
    Date.now()
  );

  const location = await getBrowserPosition({
    acceptableAccuracyMeters: 150,
    freshCacheMaxAgeMs: 8000,
  });

  assert.deepEqual(location, {
    lat: 24.7136,
    lng: 46.6753,
    accuracy: 85,
  });
  assert.equal(currentCalls, 0);
  assert.equal(watchCalls, 0);
});

test("stale cached location is ignored", async () => {
  let currentCalls = 0;
  let watchCalls = 0;
  installGeolocation({
    getCurrentPosition(success) {
      currentCalls += 1;
      success(position({ lat: 24.8, lng: 46.8, accuracy: 70 }));
    },
    watchPosition() {
      watchCalls += 1;
      return 2;
    },
    clearWatch() {},
  });

  rememberAttendanceLocation(
    { lat: 24.1, lng: 46.1, accuracy: 70 },
    Date.now() - 9000
  );

  const location = await getBrowserPosition({
    acceptableAccuracyMeters: 150,
    freshCacheMaxAgeMs: 8000,
    acceptFirstUsableReading: true,
  });

  assert.equal(location.lat, 24.8);
  assert.equal(currentCalls, 1);
  assert.equal(watchCalls, 0);
});

test("inaccurate cached location is ignored", async () => {
  let currentCalls = 0;
  installGeolocation({
    getCurrentPosition(success) {
      currentCalls += 1;
      success(position({ lat: 24.9, lng: 46.9, accuracy: 80 }));
    },
    watchPosition() {
      return 3;
    },
    clearWatch() {},
  });

  rememberAttendanceLocation(
    { lat: 24.1, lng: 46.1, accuracy: 240 },
    Date.now()
  );

  const location = await getBrowserPosition({
    acceptableAccuracyMeters: 150,
    freshCacheMaxAgeMs: 8000,
    acceptFirstUsableReading: true,
  });

  assert.equal(location.lat, 24.9);
  assert.equal(currentCalls, 1);
});

test("browser cached position is accepted through getCurrentPosition", async () => {
  let currentOptions = null;
  let watchCalls = 0;
  installGeolocation({
    getCurrentPosition(success, _error, options) {
      currentOptions = options;
      success(position({ accuracy: 85 }));
    },
    watchPosition() {
      watchCalls += 1;
      return 4;
    },
    clearWatch() {},
  });

  const location = await getBrowserPosition({
    enableHighAccuracy: true,
    maximumAge: 8000,
    acceptableAccuracyMeters: 150,
    freshCacheMaxAgeMs: 8000,
    acceptFirstUsableReading: true,
  });

  assert.equal(location.accuracy, 85);
  assert.equal(currentOptions.maximumAge, 8000);
  assert.equal(currentOptions.enableHighAccuracy, true);
  assert.equal(watchCalls, 0);
});

test("first valid watch reading resolves immediately and clears the watch", async () => {
  const clearWatchCalls = [];
  installGeolocation({
    getCurrentPosition() {},
    watchPosition(success) {
      success(position({ accuracy: 90 }));
      return 42;
    },
    clearWatch(id) {
      clearWatchCalls.push(id);
    },
  });

  const location = await getBrowserPosition({
    acceptableAccuracyMeters: 150,
    freshCacheMaxAgeMs: 8000,
    acceptFirstUsableReading: true,
  });

  assert.equal(location.accuracy, 90);
  assert.deepEqual(clearWatchCalls, [42]);
});

test("late callbacks cannot double resolve or overwrite the cache", async () => {
  let currentSuccess = null;
  let watchSuccess = null;
  const clearWatchCalls = [];

  installGeolocation({
    getCurrentPosition(success) {
      currentSuccess = success;
    },
    watchPosition(success) {
      watchSuccess = success;
      return 9;
    },
    clearWatch(id) {
      clearWatchCalls.push(id);
    },
  });

  const request = getBrowserPosition({
    acceptableAccuracyMeters: 150,
    freshCacheMaxAgeMs: 8000,
    acceptFirstUsableReading: true,
  });

  watchSuccess(position({ lat: 24.5, lng: 46.5, accuracy: 95 }));
  const resolved = await request;
  currentSuccess(position({ lat: 25.5, lng: 47.5, accuracy: 40 }));

  const cacheHit = readFreshAttendanceLocationCache({
    now: Date.now(),
    maxAgeMs: 8000,
    acceptableAccuracyMeters: 150,
  });

  assert.equal(resolved.lat, 24.5);
  assert.equal(cacheHit.lat, 24.5);
  assert.deepEqual(clearWatchCalls, [9]);
});

test("permission denied keeps the existing location permission error", async () => {
  installGeolocation({
    getCurrentPosition() {},
    watchPosition(_success, error) {
      error({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 });
      return 10;
    },
    clearWatch() {},
  });

  await assert.rejects(
    getBrowserPosition({
      acceptableAccuracyMeters: 150,
      freshCacheMaxAgeMs: 8000,
    }),
    /اسمح بالوصول إلى الموقع/
  );
});

test("fast path does not bypass geofence or worker validation", () => {
  const browserPosition = readFileSync(
    "src/services/attendanceBrowserPosition.ts",
    "utf8"
  );
  const overview = readFileSync(
    "src/pages/hr/EmployeeOverview.tsx",
    "utf8"
  );
  const attendanceWorker = readFileSync(
    "workers/attendance-worker.js",
    "utf8"
  );

  assert.doesNotMatch(browserPosition, /radiusMeters|assignedAttendanceZoneId/);
  assert.match(
    overview,
    /submitAttendanceToWorker\(\{[\s\S]*attendanceZoneId:\s*assignedAttendanceZoneId[\s\S]*location,/
  );
  assert.match(attendanceWorker, /evaluateAttendanceZones\(location/);
  assert.match(attendanceWorker, /evaluateLocationDecision\(\{/);
});
