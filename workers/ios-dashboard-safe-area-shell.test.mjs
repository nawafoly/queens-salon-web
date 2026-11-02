import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const header = readFileSync(new URL('../src/styles/DashboardHeader.css', import.meta.url), 'utf8');
const adminShell = readFileSync(new URL('../src/styles/AdminDashboardShell.css', import.meta.url), 'utf8');
const hrMobile = readFileSync(new URL('../src/styles/AdminHrMobileShell.css', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
const hrDashboard = readFileSync(new URL('../src/pages/AdminHrDashboard.tsx', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('iOS PWA declares viewport-fit=cover and translucent status bar', () => {
  assert.match(entry, /name="viewport" content="[^"]*viewport-fit=cover"/);
  assert.match(entry, /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/);
});

test('fixed /dashboard header starts after the native safe area, while all routes reserve the same offset', () => {
  const responsive = header.slice(header.lastIndexOf('@media (max-width: 991.98px)'));
  assert.ok(responsive.length > 250, 'shared mobile shell contract must remain at the bottom of the header stylesheet');
  assert.match(responsive, /--dashboard-mobile-header-top:\s*calc\(8px \+ env\(safe-area-inset-top,\s*0px\)\)/);
  assert.match(responsive, /--dashboard-mobile-content-top:\s*calc\(96px \+ env\(safe-area-inset-top,\s*0px\)\)/);
  assert.match(responsive, /position:\s*fixed\s*!important;\s*top:\s*var\(--dashboard-mobile-header-top\)\s*!important/);
  assert.match(responsive, /padding:\s*10px 16px !important/, 'safe area belongs outside the header, not to its inner controls');
  assert.match(responsive, /> \.container-fluid\s*>\s*\.row\s*>\s*\.dashboard-main\s*\{\s*padding-top:\s*var\(--dashboard-mobile-content-top\)\s*!important/);
  assert.doesNotMatch(responsive, /top:\s*8px\s*!important/, 'do not regress to Dynamic Island overlap');
  assert.match(adminShell, /@media \(max-width:\s*767px\)[\s\S]*?\.dashboard-skin\.madan-admin-shell\.dashboard-page \.dashboard-main\s*\{[\s\S]*?padding:\s*0 0 calc\(88px \+ env\(safe-area-inset-bottom\)\) !important/);
});

test('the bar and the first card do not intersect with or without native inset', () => {
  const headerHeight = 74;
  for (const safeTop of [0, 20, 47, 59, 66]) {
    const headerTop = 8 + safeTop;
    const contentTop = 96 + safeTop;
    assert.ok(contentTop - (headerTop + headerHeight) >= 12,
      'loading tiles must clear the header on both standard browser and Dynamic Island PWA');
  }
});

test('embedded HR does not lock root scrolling, standalone HR keeps its own isolated mobile shell', () => {
  assert.match(dashboard, /<AdminHrDashboard embedded language=\{dashboardLanguage\} \/>/);
  assert.match(hrDashboard, /hr-shell--embedded/);
  assert.match(hrMobile, /html:has\(\.hr-shell:not\(\.hr-shell--embedded\)\)/);
  assert.match(hrMobile, /body:has\(\.hr-shell:not\(\.hr-shell--embedded\)\)/);
  assert.match(hrMobile, /body:has\(\.hr-shell:not\(\.hr-shell--embedded\)\) #root/);
  assert.doesNotMatch(hrMobile, /(?:html|body):has\(\.hr-shell\)(?:\s|,|#root)/,
    'embedded HR must not accidentally set body/html overflow:hidden');
  assert.match(hrDashboard, /hr-workspace-loading/, 'employee loading state remains in its route content lane');
  assert.match(dashboard, /<div className="dashboard-inner">/);
});
