# Project State

## Current Architecture
- Static GitHub Pages-compatible HTML/CSS/ES modules
- Entry point: `js/app.js`
- State owner: `js/state.js`
- Rendering: `js/render.js`
- Solver/validation/scoring separated across dedicated modules

## Completed Features
- Weekly rota generation with live updates
- Staff CRUD and section-level editing
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
- Deterministic bounded whole-rota optimization after greedy feasible generation, with hard validation on every neighbour
- Complete candidate scoring includes Preferred Days Off, section fit, breakfast preferences/fairness, weekend and senior distribution, senior-on-Pass, and multi-week fairness history
- Technical details expose initial/final score and bounded-search diagnostics

## Unfinished Features
- Exact/global mathematical optimization beyond the current bounded deterministic local search
- Extended fairness analytics across long history windows

## Known Bugs
- Legacy and v2 state can diverge if localStorage is manually edited outside app controls
- Free-text rule parser is intentionally narrow and pattern-based

## localStorage Keys
- `gtRota.schemaVersion`: schema/migration marker (current: 10)
- `gtRota.state.v2`: primary persisted application state snapshot
- `gtRota.history.v1`: published history records
- Legacy per-chef MIO and profile maps are imported once by schema migration 9 and then deleted. Schema migration 10 preserves Preferred breakfast day and removes obsolete Breakfast competency values.

## Current Staff UX Notes
- The main chefs panel is intentionally compact and hides technical rule data until a chef popup is opened.
- Staff edits are draft-based inside the modal and apply only when the user clicks **Save changes**.
- Chef renames update active weekly references (for example MIO selection and persistent availability entries) while published history snapshots keep their original names.
- Staff section selectors use descriptive levels only: Should not cover, In training, Competent, Preferred.
- Preferred breakfast day is an optional soft preference; Breakfast eligible is the only breakfast qualification.
- Hierarchy, service pace, and separate preferred sections have been removed from the active staff model and storage schema.

## Deployment Method
- Static site served from repository root files via GitHub Pages
- Relative paths only; no external API requirement

## Next Recommended Task
Add lightweight performance telemetry for unusually large custom staff lists and additional-chef requests.
