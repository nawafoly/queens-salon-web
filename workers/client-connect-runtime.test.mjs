import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  conversationStatusForSecurityReview,
  isActiveConnectConversationStatus,
  sendConnectMessage,
} from './core/repositories/client-connect.js';
import { inspectContactExchange } from './core/repositories/contact-exchange-guard.js';

async function setupConnectRuntime() {
  const script = 'export default { fetch(){ return new Response("ok") } }';
  const mf = new Miniflare({
    workers: [
      {
        config: {
          type: 'worker',
          name: 'client-connect-runtime-test',
          compatibilityDate: '2026-06-24',
          manifest: {
            mainModule: 'script-0.mjs',
            modulesRoot: process.cwd(),
            modules: {
              'script-0.mjs': { type: 'esm', contents: script },
            },
          },
          env: {
            CORE_DB: { type: 'd1', id: 'client-connect-runtime' },
          },
          exports: {},
        },
        dev: { rootPath: process.cwd() },
      },
    ],
  });

  const db = await mf.getD1Database('CORE_DB');
  for (const name of [
    '0001_core_schema.sql',
    '0080_client_connect_foundation.sql',
  ]) {
    const raw = await readFile(
      new URL(`../migrations/core/${name}`, import.meta.url),
      'utf8'
    );
    const sql = raw
      .replace(/\r/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    for (const statement of sql
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }

  await db.prepare(`
    CREATE TABLE app_users (
      id TEXT PRIMARY KEY,
      firebase_uid TEXT,
      salon_id TEXT NOT NULL,
      primary_role TEXT NOT NULL,
      status TEXT NOT NULL,
      deleted_at TEXT
    )
  `).run();

  await db.prepare(`
    CREATE TABLE employee_notifications (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      target_uid TEXT,
      target_employee_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      route TEXT,
      created_by_uid TEXT,
      read_at TEXT,
      read_by_uid TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  const now = '2026-09-21T14:00:00.000Z';
  await db.prepare(`
    INSERT INTO clients
      (id, salon_id, name, status, created_at, updated_at)
    VALUES ('client-connect-1', 'main', 'Connect Client', 'active', ?, ?)
  `).bind(now, now).run();

  await db.prepare(`
    INSERT INTO client_connect_conversations
      (id, salon_id, client_id, status, created_at, updated_at)
    VALUES ('conversation-1', 'main', 'client-connect-1', 'open', ?, ?)
  `).bind(now, now).run();

  await db.prepare(`
    INSERT INTO app_users
      (id, firebase_uid, salon_id, primary_role, status, deleted_at)
    VALUES ('admin-1', 'uid-admin', 'main', 'admin', 'active', NULL)
  `).run();

  return { mf, db };
}

test('MALIKAT Connect security review maps to conversation lifecycle', () => {
  assert.equal(conversationStatusForSecurityReview('under_review'), 'review');
  assert.equal(conversationStatusForSecurityReview('safe'), 'open');
  assert.equal(conversationStatusForSecurityReview('warning_issued'), 'open');
  assert.equal(conversationStatusForSecurityReview('restricted'), 'restricted');
  assert.equal(conversationStatusForSecurityReview('closed'), 'closed');
  assert.equal(isActiveConnectConversationStatus('open'), true);
  assert.equal(isActiveConnectConversationStatus('restricted'), true);
  assert.equal(isActiveConnectConversationStatus('closed'), false);
});

test('MALIKAT Connect blocks sender-side contact leakage before delivery', () => {
  const direct = inspectContactExchange({ body: 'رقمي ٠٥٤ ٦٥٣ ٥٤٠٤' });
  assert.equal(direct.blocked, true);

  const social = inspectContactExchange({
    recentBodies: ['عندي سناب'],
    body: '@client_name',
  });
  assert.equal(social.blocked, true);
  assert.equal(social.detectionType, 'social_handle');
});

test('MALIKAT Connect runtime is Core-authoritative and audits security review access', () => {
  const worker = readFileSync('workers/core/index.js', 'utf8');
  const repository = readFileSync('workers/core/repositories/client-connect.js', 'utf8');

  assert.match(worker, /client-connect:client-conversations/);
  assert.match(worker, /client-connect:client-messages/);
  assert.match(worker, /client-connect:staff-conversations/);
  assert.match(worker, /client-connect:security-events/);
  assert.match(worker, /client_connect_security_review_opened/);
  assert.match(worker, /client_connect_security_review_updated/);

  assert.match(repository, /delivery_status = 'sent'/);
  assert.match(repository, /'blocked'/);
  assert.match(repository, /client_connect_security_events/);
  assert.match(repository, /managementNotificationRecipients/);
  assert.match(repository, /conversation_restricted/);
  assert.doesNotMatch(repository, /firestore|firebase\/firestore/i);
});


test('MALIKAT Connect guard uses same-sender bounded history and redacts personal contact fields', () => {
  const repository = readFileSync('workers/core/repositories/client-connect.js', 'utf8');

  assert.match(
    repository,
    /conversation_id = \? AND sender_uid = \? ORDER BY created_at DESC, id DESC LIMIT 12/
  );
  assert.doesNotMatch(
    repository,
    /cl\.phone_normalized AS client_phone/
  );
  assert.match(
    repository,
    /c\.assigned_staff_id = \?/
  );
});


test('MALIKAT Connect allows explicit time, date, amount and quantity contexts', () => {
  for (const body of [
    '6:30',
    '18:45',
    '21/9',
    '150 ريال',
    '2 جلسات',
  ]) {
    const result = inspectContactExchange({ body });
    assert.equal(result.blocked, false, `expected benign numeric context: ${body}`);
  }

  assert.equal(
    inspectContactExchange({ body: '05' }).blocked,
    true,
    'bare suspicious numeric fragments must still be blocked before delivery'
  );
});

test('MALIKAT Connect withholds blocked PII and restricts repeated same-sender attempts', async (t) => {
  const { mf, db } = await setupConnectRuntime();
  t.after(() => mf.dispose());

  const actor = { uid: 'uid-client' };
  const access = {
    clientId: 'client-connect-1',
    actorKind: 'client',
  };

  const first = await sendConnectMessage(
    db,
    'main',
    'conversation-1',
    { id: 'blocked-1', body: '05' },
    actor,
    access
  );
  const second = await sendConnectMessage(
    db,
    'main',
    'conversation-1',
    { id: 'blocked-2', body: '46' },
    actor,
    access
  );
  const third = await sendConnectMessage(
    db,
    'main',
    'conversation-1',
    { id: 'blocked-3', body: '53' },
    actor,
    access
  );

  assert.equal(first.blocked, true);
  assert.equal(first.conversationStatus, 'review');
  assert.equal(second.conversationStatus, 'review');
  assert.equal(third.conversationStatus, 'restricted');
  assert.equal(third.cooldownApplied, true);

  const storedMessages = await db.prepare(`
    SELECT id, body, delivery_status
      FROM client_connect_messages
     WHERE salon_id = 'main'
       AND conversation_id = 'conversation-1'
     ORDER BY created_at ASC, id ASC
  `).all();

  assert.equal(storedMessages.results.length, 3);
  for (const row of storedMessages.results) {
    assert.equal(row.delivery_status, 'blocked');
    assert.equal(row.body, 'تم حجب محتوى الرسالة أمنيًا.');
    assert.doesNotMatch(String(row.body), /05|46|53/);
  }

  const events = await db.prepare(`
    SELECT evidence_text
      FROM client_connect_security_events
     WHERE salon_id = 'main'
       AND conversation_id = 'conversation-1'
     ORDER BY detected_at ASC, id ASC
  `).all();

  assert.equal(events.results.length, 3);
  for (const event of events.results) {
    assert.match(String(event.evidence_text), /content_withheld=true/);
    assert.doesNotMatch(String(event.evidence_text), /05|46|53/);
  }

  const conversation = await db.prepare(`
    SELECT status
      FROM client_connect_conversations
     WHERE salon_id = 'main'
       AND id = 'conversation-1'
  `).first();
  assert.equal(conversation.status, 'restricted');

  const notifications = await db.prepare(`
    SELECT COUNT(*) AS count
      FROM employee_notifications
     WHERE salon_id = 'main'
       AND target_uid = 'uid-admin'
  `).first();

  assert.equal(Number(notifications.count), 2);
});

test('MALIKAT Connect honors the canonical connect-enabled preference', () => {
  const repository = readFileSync('workers/core/repositories/client-connect.js', 'utf8');
  const panel = readFileSync('src/components/client/ClientConnectPanel.tsx', 'utf8');
  const profile = readFileSync('src/pages/Profile.tsx', 'utf8');

  assert.match(repository, /requireClientConnectEnabled/);
  assert.match(repository, /conversation\.client_id/);
  assert.match(repository, /core_client_connect:disabled_for_client/);
  assert.match(panel, /enabled\?: boolean/);
  assert.match(panel, /يمكنك قراءة المحادثات السابقة/);
  assert.match(profile, /preferencesData\?\.connectEnabled !== false/);
});

test('MALIKAT Connect transport inherits Core request idempotency', () => {
  const api = readFileSync('src/services/coreApiClient.ts', 'utf8');
  const service = readFileSync('src/services/ClientConnectService.ts', 'utf8');

  assert.match(api, /logicalMethod === "GET"[\s\S]*createCoreOperationId\(\)/);
  assert.match(api, /"Idempotency-Key": operationId/);
  assert.match(service, /sendClientMessage[\s\S]*method: "POST"/);
  assert.match(service, /sendStaffMessage[\s\S]*method: "POST"/);
});
