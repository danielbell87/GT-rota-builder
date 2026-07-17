# GT Rota Builder Specification

## App Purpose
Generate a weekly GT kitchen rota from staff capabilities, availability, hard constraints, and soft preferences, while keeping output suitable for operational review and publishing.

## Terminology
- GT day: core kitchen coverage day assignment (Pass/Sauce/Garnish/Larder/Pastry/Float support)
- Breakfast assignment: one breakfast chef per day who must also cover a core section
- MIO assignment: separate off-site/events allocation, weekday only
- Hard rule: must pass for rota validity
- Soft preference: affects score and explanation but does not override hard rules

## Staff Model
Each chef includes a stable `id`, name, role, hierarchy/seniority, structured senior flag, MIO eligibility, section strengths, fixed day constraints, preferences, and notes.

## Staff Management UI
- The normal **Chefs** panel is a compact clickable list that shows only identity-level information.
- Full chef editing lives inside a modal popup with sections for:
  - Profile
  - Section skills
  - Availability and preferences
  - Advanced settings
- Add and edit flows use the same popup.
- Remove is confirmation-gated inside the popup only.
- Save applies changes in one step, persists to localStorage, and refreshes generated rota output.
- Cancel closes the popup without mutating the saved chef.

## Week Model
Weekly inputs include week commencing date, selected MIO chef, date-based additional-chef requirements, leave/unavailability entries, and free-text rule notes.

Additional-chef requirements are stored as `additionalChefRequirements: [{ date: "YYYY-MM-DD", count: N }]`. Each entry increases the required GT staffing on that exact calendar date by `count` chefs above the normal base. Requests are week-specific and do not carry across week changes.

The "Add additional chef" flow:
1. Click **Add additional chef** button (opens compact modal)
2. Select a date within the current Monday–Sunday week
3. Choose extra chef count (1–5)
4. Click **Add** to save; the rota regenerates immediately

Edit and Remove actions are available on each saved request in the compact list.

## Rota Model
A rota is a 7-day structure with:
- `dayName`, `date`
- `chefs` (GT day allocations)
- `assignments` (section-level placements including Breakfast and MIO)

## Hard Rules
Implemented as structured hard validation checks in `js/validation.js` and rule metadata in `data/default-rules.js`, including:
- Aled no weekends
- Charlie no Tuesday
- Myles Larder-only default
- Fred Garnish-only default
- Joel Sauce-only default
- One breakfast chef daily
- Breakfast chef also core-assigned
- Senior daily cover
- Mon-Wed exactly N GT chefs (N = 4 + any additional-chef request for that date)
- Thu-Sun at least N GT chefs (N = 5 + any additional-chef request for that date)
- Pass coverage Thu-Sun
- No MIO at weekends
- MIO eligibility enforcement
- MIO weekday pattern expectation
- Max four GT days per chef
- Annual leave hourly credit checks
- Concurrent leave guardrail

## Soft Preferences
Soft scoring in `js/scoring.js` evaluates section quality fit, breakfast fairness, weekend fairness, and additional preference penalties/bonuses without permitting hard-rule breaches.

Senior-on-Pass preference is implemented as a strong soft rule:
- Thursday to Sunday, prefer assigning Pass to an available senior chef.
- Prioritize higher Pass skill among available senior chefs.
- Allow non-senior Pass coverage only when no valid senior placement exists without violating hard rules.
- Configurable via `data/default-rules.js` rule id `prefer-senior-on-pass` (weight 12).

## Scoring Approach
- Compute soft score from assignment quality and fairness metrics
- If any hard rule fails, mark invalid and cap score
- Provide explanation lines for penalties and trade-offs

## Results Presentation
- The normal results UI shows only failed hard rules and unmet soft preferences.
- Successful hard/soft checks remain available for technical inspection but are hidden from the primary workflow.
- Valid weeks use a compact success state instead of listing every passed rule.
- Multi-week results include a compact per-week checks overview and keep week navigation above the selected rota.
- Technical diagnostics use a collapsed details section and are excluded from print output.

## Publication Workflow
When weekly status is `Published`, history records are upserted by `weekStart + chef` key in `js/history.js` to avoid duplicates.

## History Workflow
History captures GT days, MIO days, hours, breakfasts, and weekend flags per chef/week.

## Data Storage
Browser localStorage stores:
- schema version
- app state snapshot
- history
- legacy compatibility maps for staff profiles and MIO eligibility

Schema version 5 adds stable chef IDs and migrates existing staff records idempotently without changing skill values, weekly inputs, fairness history, or published rota history.

## Known Limitations
- No external optimization engine; candidate generation is heuristic
- Free-text rule parsing supports common phrases but not full NLP grammar
- Test harness is browser-based and lightweight (no Node build pipeline)
