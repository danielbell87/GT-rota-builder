# Changelog

## 2.1.0 - 2026-07-16
- Replaced seven-row daily-staffing-overrides table with compact date-based additional-chef list.
- Added "Add additional chef" modal dialog (accessible, keyboard-navigable, mobile-friendly).
- Added Edit and Remove actions for each saved additional-chef request.
- Introduced `additionalChefRequirements: [{ date, count }]` state field replacing day-name-based `extraChefs`.
- Added schema v3 migration: converts non-zero `dailyOverrides.extraChefs` entries to date-based records using the saved `weekStart`.
- Additional-chef requests are tied to exact calendar dates; they do not carry across week changes.
- Updated `getRequiredChefCount` and `getWeeklyContextAdjustments` to use date-based lookup.
- Updated hard validation rules H009 and H010 to dynamically respect the required count per day.
- Removed old `renderDailyOverrides`, `updateDailyOverrideFromRow` functions.
- Removed obsolete `.override-*` CSS classes; added `.chef-req-row`, `.chef-req-label`, `.chef-req-error` styles.
- Added `tests/additional-chef.test.js` covering 18 additional-chef scenarios.
- Solver behaviour and all existing hard/soft rules remain unchanged.
- Bumped solver engine version to `2026-07-16-additional-chef-modal`.

## 2.0.1 - 2026-07-14
- Added strong soft rule prefer-senior-on-pass (weight 12) to prioritize senior chefs on Pass Thursday-Sunday.
- Updated solver heuristics to prefer senior and highest Pass-skilled candidates for Pass assignments without violating hard constraints.
- Added soft validation reporting for senior-on-Pass preference outcomes.
- Extended scoring explanations and tests for senior-on-Pass behavior.

## 2.0.0 - 2026-07-14
- Refactored app into maintainable modular structure.
- Added centralized state management (`js/state.js`).
- Added constants and structured defaults (`js/constants.js`, `data/default-staff.js`, `data/default-rules.js`).
- Separated concerns for solver, validation, scoring, rendering, weekly inputs, and history.
- Added storage versioning and migration-safe persistence while preserving legacy keys.
- Added browser-compatible test harness and modular test files.
- Added project specification and state documentation.
- Preserved static hosting compatibility for GitHub Pages.
