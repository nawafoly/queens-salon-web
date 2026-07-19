import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerWhatsAppHref,
  customerPhoneDigits,
  formatCustomerLastVisit,
  formatCustomerPhone,
  getCustomerInitials,
  normalizeCustomerName,
  normalizeSaudiCustomerPhone,
} from "../src/features/customers/customerFormatters.ts";

test("normalizeCustomerName keeps clean Arabic and English names", () => {
  assert.equal(normalizeCustomerName("نورة الحربي"), "نورة الحربي");
  assert.equal(normalizeCustomerName("Nawaf Smith"), "Nawaf Smith");
});

test("normalizeCustomerName removes empty tokens, separators, extra spaces, and repeated words", () => {
  assert.equal(normalizeCustomerName("  نورة   نورة — null  "), "نورة");
  assert.equal(normalizeCustomerName("undefined   Nawaf   nawaf"), "Nawaf");
  assert.equal(normalizeCustomerName("nawaf — (11)"), "nawaf");
});

test("normalizeCustomerName uses a clear fallback for missing or numeric-only names", () => {
  assert.equal(normalizeCustomerName(null), "عميلة بدون اسم");
  assert.equal(normalizeCustomerName(" — "), "عميلة بدون اسم");
  assert.equal(normalizeCustomerName("(11)"), "عميلة بدون اسم");
});

test("phone helpers normalize Saudi numbers and preserve missing values", () => {
  assert.equal(customerPhoneDigits("050 123 4567"), "966501234567");
  assert.equal(formatCustomerPhone("+966 50 123 4567"), "0501234567");
  assert.equal(formatCustomerPhone(undefined), "—");
  assert.equal(normalizeSaudiCustomerPhone("050-123-4567"), "0501234567");
  assert.equal(normalizeSaudiCustomerPhone("+966 50 123 4567"), "0501234567");
  assert.equal(normalizeSaudiCustomerPhone("501234567"), "0501234567");
  assert.equal(normalizeSaudiCustomerPhone("123"), "");
});

test("initials and visit formatting stay meaningful", () => {
  assert.equal(getCustomerInitials("نورة محمد الحربي"), "نا");
  assert.equal(getCustomerInitials(""), "ع");
  assert.equal(formatCustomerLastVisit("", ""), "لا توجد زيارة");
  assert.match(formatCustomerLastVisit("2026-07-19", "14:30"), /2026|٢٠٢٦/);
});

test("WhatsApp URL uses the normalized number and display-safe name", () => {
  const href = buildCustomerWhatsAppHref("  نورة  نورة ", "0501234567");
  assert.ok(href.startsWith("https://wa.me/966501234567?text="));
  assert.match(decodeURIComponent(href), /مرحبًا نورة/);
});
