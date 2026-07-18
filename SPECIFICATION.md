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
Each chef contains only `id`, `name`, display-only `role`, canonical `senior`, `breakfastEligible`, optional `preferredBreakfast`, `mioEligible`, `preferredDaysOff`, core-section `skills`, and `notes`. Only `senior === true` counts toward senior cover; role never affects generation or scoring. Preferred Days Off and Preferred breakfast day are soft and overridable. Breakfast eligibility is the only breakfast qualification; there is no Breakfast competency level.

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
Weekly inputs include week commencing date, number of weeks, an optional MIO chef selection for each week, date-based additional-chef requirements, leave/unavailability entries, and free-text rule notes. The canonical no-MIO value is an empty string.

For one week, the UI shows one labelled **MIO chef** selector. For two to eight weeks, it shows a responsive **MIO chef by week** table with one independent selector per week. Every selector includes **No MIO chef**. Saved selections are keyed by week-start date, overlapping weeks survive horizon changes, and stale entries outside the active horizon are removed.

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
- retain the greedy day builder only as the initial hard-valid solution generator
- optimize the complete week before returning or reporting soft compromises

## Hard Rules
Implemented as structured hard validation checks in `js/validation.js` and rule metadata in `data/default-rules.js`, including:
- One breakfast chef daily
- Breakfast chef also core-assigned
- Breakfast chef must be marked Breakfast eligible
- Senior daily cover
- Mon-Wed exactly N GT chefs (N = 4 + any additional-chef request for that date)
- Thu-Sun at least N GT chefs (N = 5 + any additional-chef request for that date)
- Pass coverage Thu-Sun
- No MIO at weekends
- MIO eligibility enforcement
- MIO weekday pattern expectation only when an eligible chef is selected
- No MIO assignments when **No MIO chef** is selected
- Exact weekly GT targets per chef, including annual-leave adjustments and the selected MIO chef's fixed 2 GT target; no-MIO weeks use normal leave-adjusted targets for everyone
- One primary GT assignment per chef per day (Pass/Sauce/Garnish/Larder/Pastry/Float)
- Annual leave hourly credit checks
- Concurrent leave guardrail

## Soft Preferences
Soft scoring in `js/scoring.js` evaluates core section-level fit, Preferred Days Off, matching Preferred breakfast days, breakfast fairness, weekend fairness, and additional preference penalties/bonuses without permitting hard-rule breaches. Scheduling on a Preferred Day Off or without a matching breakfast-day preference remains possible.

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
- Compute soft score across the complete Monday-to-Sunday rota from Preferred Days Off, section levels, Preferred breakfast day, breakfast fairness, weekend fairness, senior distribution, senior-on-Pass, consecutive days off, and multi-week fairness history where present
- If any hard rule fails, mark invalid and cap score
- Provide explanation lines for penalties and trade-offs

## Bounded Search

- Generate deterministic candidates from chronological, reverse-chronological, and weekend-first planning orders.
- Revalidate every candidate and neighbour with `validateRotaHardRules`; hard-invalid neighbours can never be accepted.
- Explore two-chef/two-day membership exchanges (which preserve exact weekly targets), affected-day section rebuilds, valid primary-section swaps, and Breakfast reassignment.
- Accept only strict whole-rota soft-score improvements and repeat until local convergence or the configured iteration bound.
- Compare optimized candidates with complete soft scoring, including the existing multi-week fairness context.
- When a MIO chef is selected, lock that chef's established GT-day plan during local search so exact 3 MIO + 2 GT and existing weekend-first/fallback behaviour remain unchanged. No-MIO weeks reserve no chef.

Search limits are 3 candidates × 8 iterations × 120 neighbours for a single week, and 2 × 4 × 72 per week for multi-week requests. These explicit limits bound browser work; the lower multi-week budget keeps an eight-week request practical while still performing several hundred hard-validated neighbour comparisons per week.

## Results Presentation
- The normal results UI shows only failed hard rules and unmet soft preferences.
- Successful hard/soft checks remain available for technical inspection but are hidden from the primary workflow.
- Valid weeks use a compact success state instead of listing every passed rule.
- Multi-week results include a compact per-week checks overview and keep week navigation above the selected rota.
- Technical diagnostics use a collapsed details section and are excluded from print output.
- Technical diagnostics include initial/final soft score, candidate count, accepted optimization moves, improvement status, and configured limits.
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

Schema version 11 normalizes per-week MIO selections, preserves explicit empty selections, and retains only entries inside the active planning horizon. It preserves version 10's valid `preferredBreakfast` weekdays and removal of obsolete `skills.Breakfast` competency data, plus the version 9 consolidation of `seniorStatus`, legacy `fixedDayOff`, and legacy MIO/profile maps. Other weekly inputs, dated availability, notes, generated rotas, fairness history, and published history remain intact.

## Known Limitations
- No external optimization engine; candidate generation is heuristic
- Free-text rule parsing supports common phrases but not full NLP grammar
- Test harness is browser-based and lightweight (no Node build pipeline)
