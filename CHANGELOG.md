# Changelog

## 2.4.0 - 2026-07-17
- Finalized the chef section-level and exact weekly GT target integration on build `2026.07.17.5` / cache `20260717e`.
- Preserved full-week validation horizons (`fullWeekDates` / H024) while keeping exact GT target, explicit Float, and annual-leave-adjusted validation behavior.
- Refactored weekly GT allocation so the solver now works to exact per-chef weekly targets instead of stopping at minimum daily cover.
- Added explicit `Float` assignments that count as GT days and GT hours, support multiple Float chefs on one day, and remain visible in the final rota data and UI.
- Updated hard validation to fail both above-target and below-target weekly GT totals, plus to require exactly one primary GT assignment per chef per day.
- Preserved MIO 3+2 rules, Monday-Wednesday exact staffing, Thursday-Sunday minimum staffing, senior cover, and availability restrictions while using Float to complete contracted days.
- Expanded browser tests and documentation for exact targets, annual-leave adjustments, infeasibility reporting, additional-chef Float handling, and multi-week behavior.

## 2.3.0 - 2026-07-17
- Simplified chef profiles by removing the unused hierarchy number, service pace, and separate preferred-sections fields.
- Replaced visible numeric section scores with descriptive section levels: Should not cover, In training, Competent, Preferred.
- Centralised section-level helpers so suitability, preference, validation, and ranking all use the same mapping.
- Preserved senior-on-Pass behaviour, fairness ordering, MIO handling, leave/unavailability handling, additional-chef requests, and specialist defaults.
- Added schema v6 migration that removes obsolete staff fields while preserving stable chef IDs, section values, and weekly data.
- Expanded browser tests for popup field removal, section labels, migration idempotency, section ranking, and section-coverage warnings.

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
