# Changelog

## 2.0.0 - 2026-07-14
- Refactored app into maintainable modular structure.
- Added centralized state management (`js/state.js`).
- Added constants and structured defaults (`js/constants.js`, `data/default-staff.js`, `data/default-rules.js`).
- Separated concerns for solver, validation, scoring, rendering, weekly inputs, and history.
- Added storage versioning and migration-safe persistence while preserving legacy keys.
- Added browser-compatible test harness and modular test files.
- Added project specification and state documentation.
- Preserved static hosting compatibility for GitHub Pages.
