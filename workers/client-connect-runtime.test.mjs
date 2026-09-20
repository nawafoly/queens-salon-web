import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  conversationStatusForSecurityReview,
  isActiveConnectConversationStatus,
} from './core/repositories/client-connect.js';
import { inspectContactExchange } from './core/repositories/contact-exchange-guard.js';

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
