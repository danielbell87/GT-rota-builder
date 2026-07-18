# GT Rota Builder

A web-based chef scheduling application that generates weekly rotas based on availability, section levels, and business rules.

## Features

- **Live rota generation** with real-time updates as inputs change
- **Chef scheduling** with descriptive section-level assignments
- **Compact chefs list** with click-to-edit popup profiles
- **Availability management** for annual leave and unavailable dates
- **Additional chef requests** via compact date-based list and modal dialog
- **Breakfast shift scheduling** with eligibility, core coupling, and fairness scoring
- **Exact weekly GT target enforcement** with explicit Float assignments
- **Deterministic whole-rota optimisation** after the first hard-valid weekly plan
- **Hours tracking** with adjusted calculations for breakfast shifts
- **Rule-based configuration** for customizing shift preferences
- **Validation alerts** that show only failed hard rules and unmet soft preferences in the main UI, with full diagnostics kept in technical details

## How to Use

1. Open `index.html` in a web browser (or use the legacy `GT Rota builder.html` bookmark, which redirects to `index.html`)
2. Enter the week commencing date
3. Use the **Chefs** list to add staff or open a chef popup for profile, section-level, and preference edits
4. Select a MIO (Management Improvement Officer) chef, or choose **No MIO chef**
5. Add any additional chef requests (e.g., private events) using the **Add additional chef** button
6. Review the generated rota, chef-hours summary, and any failed checks

## Chefs UI

- The **Chefs** section shows a compact staff list with chef name, role, and every applicable badge in a consistent order: Senior, MIO, Breakfast, then the active soft-preference count.
- The Preferences badge counts each valid Preferred Day Off plus a valid Preferred breakfast day and provides a concise summary without exposing detailed profile data on the list.
- Click **Add chef** to open the staff editor in creation mode.
- Click any chef row to open the full editable popup profile.
- The popup keeps profile fields, section suitability, availability preferences, and advanced settings in one place.
- **Remove chef** is only available inside the popup and requires confirmation.
- Saving a chef updates browser storage and refreshes rota generation without changing solver rules or defaults.
- The popup uses four section levels everywhere: **Should not cover**, **In training**, **Competent**, **Preferred**.
- **Preferred** combines strongest suitability and generic section preference; there is no separate preferred-section field.
- **Preferred Days Off** is the sole day-off preference mechanism and supports every day from Monday through Sunday.
- **Preferred breakfast day** optionally favours one weekday when breakfast fairness and all hard constraints permit it.
- **Breakfast eligible** is the only breakfast qualification; Breakfast is not a section competency.
- Role is display-only. The **Senior chef** checkbox is the sole source of senior-cover eligibility.
- Service pace has been removed because it is not used by rota generation.

## Results UI

- Valid rotas show a single compact success status.
- Failed hard rules are shown only when something needs attention.
- Soft scheduling compromises are listed separately from hard-rule failures.
- Full validation data, successful checks, and rule IDs remain available under **View technical details**.
- Whole-rota initial/final scores, candidate counts, accepted moves, and search limits are kept in technical details.

### Adding Additional Chefs

In the **Additional chefs** section:

1. Click **Add additional chef**
2. A dialog opens — pick a date within the current week and set the number of extra chefs (1–5)
3. Click **Add** to save; the rota updates immediately
4. Use **Edit** or **Remove** on any saved request to modify or delete it

Requests are tied to a specific calendar date and do not carry across week changes.

## Scheduling Rules

### Whole-rota optimisation

The chronological greedy builder remains the feasible-solution generator, but a hard-valid week is no longer returned immediately. The solver builds deterministic starting rotas using chronological, reverse, and weekend-first planning orders; scores each complete week; then explores two-chef/two-day exchanges, affected-day section rebuilds, primary-section swaps, and Breakfast reassignments. Every neighbour is passed through the shared hard validator, and only a strict complete-score improvement can be accepted.

Single-week generation is bounded to 3 initial candidates, 8 local-search iterations per candidate, and 120 neighbour evaluations per iteration. Multi-week generation uses 2 candidates, 4 iterations, and 72 neighbours per iteration. The lower multi-week limits retain meaningful search while keeping an eight-week request responsive in a normal desktop browser. Identical inputs produce deterministic results without uncontrolled randomness.

Preferred Day Off compromises are calculated only from the final optimized rota.

### Core Constraints
- Normal chefs work exactly 4 GT days per week unless credited annual leave reduces the target
- Selected MIO chef works exactly 3 MIO days and exactly 2 GT days
- A week set to **No MIO chef** has no MIO assignments and every chef uses their normal leave-adjusted GT target
- Monday-Wednesday require exactly 4 GT chefs unless an explicit extra-chef request exists
- Thursday-Sunday require at least 5 GT chefs and may include multiple Float chefs
- Breakfast coverage every day
- MIO assignment when specified
- Pass must be covered Thursday to Sunday
- Float is an explicit GT assignment used to complete contracted weekly days after core coverage

### Breakfast Shifts
- Spread breakfast shifts across eligible chefs where possible; repeats receive a soft fairness penalty
- Breakfast is an overlay on a core GT section and does not replace the chef's primary section assignment
- 7:30am start time with adjusted hours:
  - Mon-Fri: 14 hours
  - Saturday: 14.5 hours
  - Sunday: 12.5 hours

### Regular Shift Hours
- Monday-Friday: 11.5 hours
- Saturday: 12.5 hours
- Sunday: 11 hours

### Section levels
- **Should not cover** — never assign that chef to the section
- **In training** — valid only as a lower-priority supervised/training option
- **Competent** — normal acceptable assignment level
- **Preferred** — strongest and favoured section level

The solver uses the section level as the single source of truth for both suitability and generic section preference.

### Senior On Pass Preference (Soft Rule)
- Thursday to Sunday, Pass is strongly weighted toward an available senior chef.
- Senior status is determined from structured staff data using the senior flag.
- Among valid senior candidates, stronger Pass levels are preferred first.
- If no valid senior assignment is available without breaking hard rules, non-senior Pass coverage is allowed.
- Weight is configurable in rule metadata via rule id prefer-senior-on-pass (default weight 12).

## File Structure

```
gt-rota-builder/
├── GT Rota builder.html      # Legacy redirect to index.html
├── index.html                # Canonical app entry page
├── styles.css                # Shared stylesheet
├── SPECIFICATION.md
├── PROJECT_STATE.md
├── CHANGELOG.md
├── archive/
│   └── GT-Rota-Builder-before-refactor.html
├── js/
│   ├── app.js                # Entry point and event orchestration
│   ├── state.js              # Single source of runtime state
│   ├── constants.js          # Shared constants and weights
│   ├── solver.js             # Core rota generation algorithm
│   ├── validation.js         # Hard-rule validation
│   ├── scoring.js            # Soft preference scoring
│   ├── weekly-inputs.js      # Weekly input normalization
│   ├── staff.js              # Staff mutations and validation
│   ├── history.js            # Published history upsert logic
│   ├── render.js             # DOM rendering only
│   ├── storage.js            # localStorage persistence + migrations
│   ├── rules.js              # Natural-language rule parsing
│   ├── utils.js              # Date and formatting utilities
│   └── main.js               # Compatibility shim
├── data/
│   ├── default-staff.js
│   └── default-rules.js
├── tests/
│   ├── index.html
│   ├── run-tests.js
│   ├── validation.test.js
│   ├── solver.test.js
│   └── scoring.test.js
├── README.md
└── requirements/
  ├── data-model.md
  ├── rota-rules.md
  ├── acceptance-tests.md
  └── workbook-map.md
```

## Configuration

Edit the natural-language rule field in the app to customize:
- Chef day-off preferences
- Section preferences (preferred/avoided)
- Breakfast eligibility
- Any other scheduling overrides

Example: `Increase senior cover for Friday event`

## Technology

- Pure HTML5, CSS, and modular JavaScript (ES modules)
- No external dependencies or build tools required
- Runs entirely in the browser
- Data managed in-memory (no persistence)

## Development

To modify the application:

1. Open `index.html` in a text editor
2. Edit modules under `js/`, defaults under `data/`, and styles in `styles.css`
3. Reload in browser to test changes
4. Commit changes to git: `git add . && git commit -m "description"`

## Testing

Run the Python HTTP server to serve locally:

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/index.html` in your browser.

To run the browser test suite open:

`http://127.0.0.1:8000/tests/`

Click **Run full suite**.

The generated rota is valid only when no available non-MIO chef is left below their adjusted weekly GT target.

## GitHub Pages Deployment

1. Push repository to GitHub.
2. In repository settings, enable GitHub Pages from the default branch root.
3. Ensure `index.html` remains at repository root.
4. Use only relative asset/module paths (already configured).

## Saved Data and Compatibility

Saved browser data is persisted with migration-safe localStorage keys.

- Primary state: `gtRota.state.v2`
- History: `gtRota.history.v1`
Schema version `11` preserves explicit per-week **No MIO chef** selections, normalizes the active multi-week selection map, and removes stale out-of-horizon entries. It retains version 10's Preferred breakfast migration and the version 9 consolidation of legacy senior status, Fixed Day Off, MIO eligibility, and staff-profile data. Existing notes, core section levels, Preferred Days Off, dated availability, other weekly inputs, generated rotas, and published history are preserved.

No external API keys or secrets are required.

## Recent Updates

- ✅ Simplified chef profiles to section levels only
- ✅ Removed obsolete hierarchy, service pace, and separate preferred-sections fields
- ✅ Restored Preferred breakfast day as a soft preference
- ✅ Removed Breakfast competency; Breakfast eligible is the sole qualification
- ✅ Removed role-derived seniority, named-chef rules, and duplicate staff data
- ✅ Added schema-safe migration for existing saved staff profiles
- ✅ Preserved senior-on-Pass, MIO, fairness, leave, and specialist rota rules
- ✅ Enforced exact weekly GT targets with explicit Float assignments and adjusted leave targets
- ✅ Added bounded deterministic whole-rota soft optimisation and final-only compromise reporting

## License

Internal use only

## Author

Dan Bell
