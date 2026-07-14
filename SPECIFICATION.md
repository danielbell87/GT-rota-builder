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
Each chef includes name, role, hierarchy/seniority, structured senior flag, MIO eligibility, section strengths, fixed day constraints, and notes.

## Week Model
Weekly inputs include week commencing date, selected MIO chef, daily demand overrides, leave/unavailability entries, and free-text rule notes.

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
- Mon-Wed exactly 4 GT chefs
- Thu-Sun at least 5 GT chefs
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

## Known Limitations
- No external optimization engine; candidate generation is heuristic
- Free-text rule parsing supports common phrases but not full NLP grammar
- Test harness is browser-based and lightweight (no Node build pipeline)
