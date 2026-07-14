# GT Rota Builder

A web-based chef scheduling application that generates weekly rotas based on availability, skills, and business rules.

## Features

- **Live rota generation** with real-time updates as inputs change
- **Chef scheduling** with skill-based section assignments
- **Availability management** for annual leave and unavailable dates
- **Breakfast shift scheduling** with max 1 breakfast per chef per week
- **4-day working week enforcement** for staff members
- **Hours tracking** with adjusted calculations for breakfast shifts
- **Rule-based configuration** for customizing shift preferences
- **Validation alerts** for scheduling conflicts and constraint violations

## How to Use

1. Open `GT Rota builder.html` or `index.html` in a web browser
2. Enter the week commencing date
3. Configure staff availability and skills
4. Select a MIO (Management Improvement Officer) chef if needed
5. Apply any custom rule changes
6. Review the generated rota and hours summary

## Scheduling Rules

### Core Constraints
- Each chef works a maximum of 4 shifts per week
- 4-6 chefs per day depending on weekday/weekend
- Breakfast coverage every day
- MIO assignment when specified

### Breakfast Shifts
- One breakfast shift per chef per week (hard limit)
- Breakfast counts as ONE of the 4-day working week
- 7:30am start time with adjusted hours:
  - Mon-Fri: 14 hours
  - Saturday: 14.5 hours
  - Sunday: 12.5 hours

### Regular Shift Hours
- Monday-Friday: 11.5 hours
- Saturday: 12.5 hours
- Sunday: 11 hours

## File Structure

```
gt-rota-builder/
├── GT Rota builder.html      # Legacy-compatible entry page
├── index.html                # Primary app entry page
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

Example: `Aled prefers Pass; Charlie off Tuesday; Dan breakfast eligible`

## Technology

- Pure HTML5, CSS, and modular JavaScript (ES modules)
- No external dependencies or build tools required
- Runs entirely in the browser
- Data managed in-memory (no persistence)

## Development

To modify the application:

1. Open `GT Rota builder.html` or `index.html` in a text editor
2. Edit modules under `js/`, defaults under `data/`, and styles in `styles.css`
3. Reload in browser to test changes
4. Commit changes to git: `git add . && git commit -m "description"`

## Testing

Run the Python HTTP server to serve locally:

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/GT%20Rota%20builder.html` in your browser.

To run the browser test suite open:

`http://127.0.0.1:8000/tests/`

Click **Run full suite**.

## GitHub Pages Deployment

1. Push repository to GitHub.
2. In repository settings, enable GitHub Pages from the default branch root.
3. Ensure `index.html` remains at repository root.
4. Use only relative asset/module paths (already configured).

## Saved Data and Compatibility

Saved browser data is persisted with migration-safe localStorage keys.

- Primary state: `gtRota.state.v2`
- History: `gtRota.history.v1`
- Legacy compatibility keys preserved:
  - `gtRota.mioEligibilityByChef`
  - `gtRota.staffProfilesByChef`

No external API keys or secrets are required.

## Recent Updates

- ✅ Fixed timezone-related date display issues
- ✅ Implemented breakfast shift constraints (max 1 per chef per week)
- ✅ Updated hours calculation for 7:30am breakfast start times
- ✅ Added validation for breakfast constraint violations

## License

Internal use only

## Author

Dan Bell
