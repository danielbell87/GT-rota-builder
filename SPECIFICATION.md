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
Each chef includes a stable `id`, name, role, structured senior flag, MIO eligibility, section levels, fixed day constraints, preferences, and notes. The obsolete hierarchy number, service pace field, and separate preferred-sections list are no longer part of the staff model.

## Staff Management UI
- The normal **Chefs** panel is a compact clickable list that shows only identity-level information.
- Full chef editing lives inside a modal popup with sections for:
  - Profile
  - Section suitability
  - Availability and preferences
  - Advanced settings
- Add and edit flows use the same popup.
- Remove is confirmation-gated inside the popup only.
- Save applies changes in one step, persists to localStorage, and refreshes generated rota output.
- Cancel closes the popup without mutating the saved chef.
- Each visible section selector uses the labels **Should not cover**, **In training**, **Competent**, and **Preferred**.
- No separate preferred-section control is shown; **Preferred** is the single source of truth for both strongest suitability and generic section preference.

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
- `chefs` (all GT day allocations, including Float)
- `assignments` (explicit section-level placements including Float, Breakfast, and MIO)

Weekly GT allocation is solved across the whole week rather than as seven isolated minimum-cover days:
- calculate each chef's adjusted weekly GT target first
- build valid core coverage for all seven days
- add explicit Float assignments to satisfy remaining GT deficits
- recalculate GT days, GT hours, and summary rows from the final rota data

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
- Exact weekly GT targets per chef, including annual-leave adjustments and the selected MIO chef's fixed 2 GT target
- One primary GT assignment per chef per day (Pass/Sauce/Garnish/Larder/Pastry/Float)
- Annual leave hourly credit checks
- Concurrent leave guardrail

## Soft Preferences
Soft scoring in `js/scoring.js` evaluates section-level fit, breakfast fairness, weekend fairness, and additional preference penalties/bonuses without permitting hard-rule breaches.

Senior-on-Pass preference is implemented as a strong soft rule:
- Thursday to Sunday, prefer assigning Pass to an available senior chef.
- Prioritize higher Pass skill among available senior chefs.
- Allow non-senior Pass coverage only when no valid senior placement exists without violating hard rules.
- Configurable via `data/default-rules.js` rule id `prefer-senior-on-pass` (weight 12).

Section levels are interpreted in order:
- **Should not cover** — hard-excluded from that section
- **In training** — lower-priority training option
- **Competent** — normal acceptable option
- **Preferred** — strongest and favoured option

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
- Chef-hours summary shows exact GT progress as `actual/adjustedTarget`, for example `4/4`, `3/3`, or `2/2`.

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

Schema version 6 migrates existing staff records idempotently by preserving section level values and stable IDs while removing obsolete `hierarchy`, `servicePace`, and `preferredSections` fields. Weekly inputs, leave/unavailability data, fairness history, and published rota history remain intact.

## Known Limitations
- No external optimization engine; candidate generation is heuristic
- Free-text rule parsing supports common phrases but not full NLP grammar
- Test harness is browser-based and lightweight (no Node build pipeline)
