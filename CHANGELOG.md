# Changelog

## 2.2.0 - 2026-07-17
- Replaced the permanently expanded staff table with a compact **Chefs** list that shows only chef name, role, and one small status badge where useful.
- Added a reusable chef editor popup for add, edit, and remove flows, with grouped sections for profile, section skills, availability/preferences, and advanced settings.
- Moved destructive chef removal into the popup and added explicit confirmation before deleting a chef.
- Added stable chef IDs plus schema v5 storage migration so existing saved staff profiles keep their skills, preferences, weekly inputs, and history references.
- Updated rename and removal handling so active MIO selections and persistent availability entries stay safe when staff records change.
- Expanded browser UI coverage for compact list rendering, popup editing, persistence, rename/remove safety, empty-state behaviour, keyboard focus, and mobile overflow.
- Underlying rota-generation rules, solver behaviour, validation logic, scoring, fairness rules, MIO rules, and default staff behaviour were not changed.

## 2.1.1 - 2026-07-16
- Modernised the results UI with compact status cards, lighter section spacing, and simplified validation presentation.
- Removed successful hard-rule and soft-preference checks from the normal results interface.
- Added separate failed hard-rule and soft-compromise sections, plus collapsed technical details with full validation data and rule IDs.
- Added multi-week checks overview, compact chef-hours summary rows, and slimmer fairness presentation.
- Updated print/mobile behavior so technical details and navigation stay hidden while failed checks remain printable.
- Expanded UI tests to cover filtered validation rendering, technical details, multi-week issue summaries, and infeasible messaging.

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
