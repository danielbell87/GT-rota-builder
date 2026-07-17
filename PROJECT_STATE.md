# Project State

## Current Architecture
- Static GitHub Pages-compatible HTML/CSS/ES modules
- Entry point: `js/app.js`
- State owner: `js/state.js`
- Rendering: `js/render.js`
- Solver/validation/scoring separated across dedicated modules

## Completed Features
- Weekly rota generation with live updates
- Staff CRUD and skill editing
- Compact chefs list with modal-based staff editing and confirmed removals
- Leave and unavailable handling
- MIO assignment and eligibility handling
- Hard-rule validation pass/fail model
- Soft-preference scoring with hard-failure cap
- Strong soft preference for senior chef on Pass Thursday-Sunday, with structured soft validation
- Published history upsert (week+chef uniqueness)
- Browser test page and modular tests
- Date-based additional-chef requests via compact list and accessible modal dialog (v2.1.0)
- Results UI now filters out successful validation checks from the main interface while preserving full validation arrays for technical details and tests

## Unfinished Features
- Advanced multi-candidate optimization and explainability beyond current heuristics
- Extended fairness analytics across long history windows

## Known Bugs
- Legacy and v2 state can diverge if localStorage is manually edited outside app controls
- Free-text rule parser is intentionally narrow and pattern-based

## localStorage Keys
- `gtRota.schemaVersion`: schema/migration marker (current: 5)
- `gtRota.state.v2`: primary persisted application state snapshot
- `gtRota.history.v1`: published history records
- `gtRota.mioEligibilityByChef`: legacy compatibility map for MIO eligibility by chef name
- `gtRota.staffProfilesByChef`: legacy compatibility map for staff role/skills by chef name

## Current Staff UX Notes
- The main chefs panel is intentionally compact and hides technical rule data until a chef popup is opened.
- Staff edits are draft-based inside the modal and apply only when the user clicks **Save changes**.
- Chef renames update active weekly references (for example MIO selection and persistent availability entries) while published history snapshots keep their original names.

## Deployment Method
- Static site served from repository root files via GitHub Pages
- Relative paths only; no external API requirement

## Next Recommended Task
Add deterministic snapshot tests for known weeks and compare expected rota outputs to detect algorithm regressions quickly.
