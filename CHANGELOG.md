# Changelog

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
