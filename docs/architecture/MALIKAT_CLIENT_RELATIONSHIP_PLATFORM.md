# MALIKAT Client Relationship Platform

Status: Core foundation and guarded messaging runtime implemented; production migration/deploy still pending.

## 1. Client Core

A single canonical Client Core serves two different experiences:

- Customer Personal Profile: the client sees only her own bookings, cashback, packages, offers, preferences and MALIKAT Connect.
- Admin Client 360: management/reception sees the operational customer record, subject to role permissions.

The two experiences must not maintain separate business truth.

## 2. Cashback Wallet

Cashback is **monetary salon store credit**, denominated in halalas.

Hard rules:

- It may only be redeemed against eligible MALIKAT salon purchases.
- It is never cash-withdrawable.
- It is never bank-transferable.
- It is never transferable to another client.
- Earn is recorded only after the qualifying booking reaches the configured completed/eligible state.
- Refunds, expiry and corrections use ledger movements. The balance is not edited as a magic mutable number.
- The reward percentage/rate is a policy value. The schema ships disabled with a zero rate until management explicitly configures it.

Canonical ledger movement types:

- earn
- redeem
- reverse
- expire
- adjustment

## 3. Preferred specialist

A client may have a preferred specialist, but no employee owns the client.

Use:

- preferred_staff_id
- preferred_staff_source = client | behavior | admin

Never model the relationship as client_owner_staff_id.

## 4. MALIKAT Connect

The communication relationship is:

Client <-> MALIKAT <-> Specialist

The salon owns the conversation. Personal employee contact data is never exposed.

A conversation can be reassigned when a specialist is off duty, leaves employment, fails to respond, or the issue belongs to reception/management.

## 5. Contact Exchange Guard

Core is authoritative. Client-side filtering is optional UX only.

Before delivery, Core checks:

- KSA phone numbers, including +966/00966/local formats.
- Numeric fragments designed to reconstruct a number across messages.
- Arabic/Persian digits and mixed digit formatting.
- Email addresses and common obfuscation.
- Instagram, Snapchat, WhatsApp, Telegram, TikTok and other social handles.
- External links except explicitly allowlisted MALIKAT domains.
- Contact-exchange language in conversation context.

A blocked message is not delivered to the other party.

When a security trigger fires:

1. Store the attempted message as blocked evidence for authorized security review.
2. Create a client_connect_security_event.
3. Mark the conversation review/restricted as policy requires.
4. Notify authorized management.
5. Management may open the full conversation context and resolve the event.
6. Opening/reviewing the conversation must be auditable.

Security review statuses:

- new
- under_review
- safe
- warning_issued
- restricted
- closed

## 6. Privacy boundary

Ordinary conversations are not surfaced to management merely for curiosity. Management access is role-gated and security-review access is audited. Marketing consent is distinct from service communication consent.


## 7. Runtime contract

Implemented Core routes cover:

- Client: open/list owned conversations and read/send owned messages.
- Staff: list assigned conversations and read/send when the conversation is assigned to the linked employee.
- Management: view all operational conversations when authorized by messages.manage, reassign a conversation, list security events, open full security context, and resolve the review.
- Security access: opening a flagged conversation creates an audit event. Updating the review creates a second audit event.
- Delivery boundary: ordinary participants only read messages whose delivery_status is sent. Blocked evidence is visible only through the authorized security-review endpoint.
- Alerting: a blocked contact-exchange attempt creates management notifications and never delivers the message to the other party.

The runtime remains inactive in production until migration 0080 is applied and the Core Worker is explicitly deployed.
