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
- Leave and unavailable handling
- MIO assignment and eligibility handling
- Hard-rule validation pass/fail model
- Soft-preference scoring with hard-failure cap
- Published history upsert (week+chef uniqueness)
- Browser test page and modular tests

## Unfinished Features
- Advanced multi-candidate optimization and explainability beyond current heuristics
- Extended fairness analytics across long history windows

## Known Bugs
- Legacy and v2 state can diverge if localStorage is manually edited outside app controls
- Free-text rule parser is intentionally narrow and pattern-based

## localStorage Keys
- `gtRota.schemaVersion`: schema/migration marker
- `gtRota.state.v2`: primary persisted application state snapshot
- `gtRota.history.v1`: published history records
- `gtRota.mioEligibilityByChef`: legacy compatibility map for MIO eligibility by chef name
- `gtRota.staffProfilesByChef`: legacy compatibility map for staff role/skills by chef name

## Deployment Method
- Static site served from repository root files via GitHub Pages
- Relative paths only; no external API requirement

## Next Recommended Task
Add deterministic snapshot tests for known weeks and compare expected rota outputs to detect algorithm regressions quickly.
