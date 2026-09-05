import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/services/AppSettingsService.ts", "utf8");

test("AppSettingsService versions remote reads against successful saves", () => {
  assert.match(
    source,
    /let settingsGeneration = 0;/
  );

  assert.match(
    source,
    /const requestGeneration = settingsGeneration;/
  );

  assert.match(
    source,
    /requestGeneration !== settingsGeneration/
  );
});

test("a stale GET cannot overwrite the snapshot or local cache after a save", () => {
  const readStart = source.indexOf(
    "async function readRemoteSettingsShared"
  );
  const refreshStart = source.indexOf(
    "function refreshSettingsSubscribers",
    readStart
  );

  assert.ok(readStart >= 0);
  assert.ok(refreshStart > readStart);

  const reader = source.slice(readStart, refreshStart);

  const staleGuard = reader.indexOf(
    "requestGeneration !== settingsGeneration"
  );
  const cacheWrite = reader.indexOf("cacheWrite(remote)");
  const snapshotWrite = reader.indexOf("settingsSnapshot = remote");

  assert.ok(staleGuard >= 0);
  assert.ok(cacheWrite > staleGuard);
  assert.ok(snapshotWrite > staleGuard);

  assert.match(
    reader,
    /return settingsSnapshot \|\| remote;/
  );
});

test("successful save invalidates older GET generations before publishing", () => {
  const saveStart = source.indexOf(
    "async saveRemote(settings: AppSettings)"
  );

  assert.ok(saveStart >= 0);

  const saveBlock = source.slice(saveStart);

  const persisted = saveBlock.indexOf(
    "await CoreSettingsService.save"
  );
  const generationBump = saveBlock.indexOf(
    "settingsGeneration += 1;"
  );
  const cacheWrite = saveBlock.indexOf(
    "cacheWrite(payload)"
  );
  const publish = saveBlock.indexOf(
    "publishSettings(payload)"
  );

  assert.ok(persisted >= 0);
  assert.ok(generationBump > persisted);
  assert.ok(cacheWrite > generationBump);
  assert.ok(publish > cacheWrite);
});

test("subscriber refresh cannot republish a stale pre-save response", () => {
  assert.match(
    source,
    /readRemoteSettingsShared\(\)\s*\.then\(\(remote\) => publishSettings\(remote\)\)/
  );

  assert.match(
    source,
    /return settingsSnapshot \|\| remote;/
  );
});