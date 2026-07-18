# Rota rules

## Hard constraints

These are treated as hard requirements and should be enforced before any soft preferences are considered.

1. Exactly one breakfast chef is assigned each day.
2. At least one chef with **Senior chef** selected works each day.
3. **Weekly GT targets are exact, not maximum-only**:
   - Normal chef: exactly 4 GT days.
   - Normal chef with annual leave: exactly `max(0, 4 - annual-leave days credited that week)` GT days.
   - Selected MIO chef: exactly 3 MIO days and exactly 2 GT days.
4. **Monday to Wednesday require 4 GT chefs** (not 5) unless an event requires extra cover (specified in event field).
5. **Thursday to Sunday require at least 5 GT chefs** and may include extra Float chefs to complete weekly targets.
6. **Pass section is NOT required Monday-Wednesday** (only Sauce, Garnish, Larder, Pastry).
7. **Float section**:
   - When all core sections are assigned, additional target-filling or explicitly requested chefs must be assigned to **Float**.
   - Float counts as a GT day and GT hours, appears in `day.chefs`, and is stored explicitly in `day.assignments`.
   - More than one Float chef may be used on the same day.
   - A Float chef must not also hold another primary GT section that day.
8. Required sections must be covered by an eligible chef.
9. A breakfast chef must also appear on a core section or Float for that day.
10. The rota must respect dated annual leave, approved unavailability, and section eligibility.
11. The rota must not invent sickness or make up unavailable time; only the provided leave/unavailability data should be used.
12. Each week independently selects either one eligible MIO chef or **No MIO chef**.
13. When a MIO chef is selected, the pattern is exactly three weekday MIO shifts and exactly two non-overlapping GT days in the same week; if availability makes that impossible, the week is infeasible. When **No MIO chef** is selected, no MIO shifts are created and all chefs use normal leave-adjusted GT targets.
14. If a chef is unavailable on a normal MIO day, the MIO assignment may move only to Thursday or Friday, per the AI prompt.
15. The rota must preserve the workbook's layout, formulas, and rules when updated.
16. At least one Sous Chef or higher must work in the kitchen each day.
17. Chefs marked as "MIO not eligible" must never be assigned to MIO.

## Soft preferences

These are scoring and quality objectives rather than hard blocking rules.

1. Target about 48 credited hours per chef each week, with a tolerance of about ±2 hours.
2. Prefer two consecutive days off where possible.
3. Prefer assigning chefs at Preferred level before Competent level, and Competent level before In training.
4. Use fair Friday/Saturday/Sunday rotation where possible.
5. Provide useful training opportunities without weakening service.
6. Avoid more than one breakfast assignment per chef in a week unless required.
7. Friday, Saturday, and Sunday duties should rotate fairly among interchangeable chefs.
8. Friday–Sunday should preferably include at least two senior chefs.
9. The rota should avoid unnecessary overstaffing, but must use Float whenever extra GT days are required to satisfy exact weekly chef targets.
10. Thursday to Sunday, Pass should be assigned to an available chef marked Senior chef where this can be achieved without breaking hard constraints.
11. Preferred Days Off may contain any Monday-to-Sunday combination. They should be honoured where feasible, but may be overridden for coverage, senior cover, section strength, exact weekly targets, or overall feasibility.
12. Preferred breakfast day remains soft, but Breakfast duties must be reassigned across the complete week to honour every feasible match before rotation fairness is used as a tie-breaker.

## Important notes from the workbook

- The workbook's AI prompt says the AI should generate at least three candidate rotas, score them, and select the highest-scoring valid rota.
- The workbook's scoring sheet explicitly states that hard-rule failures cap the overall score at 80.
- The workbook indicates that the AI prompt and scoring sheet are intended to be used as the source of truth for rule interpretation.

## Whole-rota search

- The greedy Monday-to-Sunday builder supplies initial feasible rotas; it is not the final decision-maker.
- Single-week search evaluates up to 3 deterministic initial candidates, with at most 8 local-search iterations and 120 neighbour evaluations per iteration.
- Multi-week search uses 2 candidates, 4 iterations, and 72 neighbours per iteration for each week.
- Neighbours include two-chef/two-day exchanges, affected-day section rebuilds, and primary-section exchanges.
- A separate complete-week Breakfast matching pass runs on every candidate and can use direct swaps or augmenting-path multi-day reassignments.
- Every neighbour is passed through the shared hard validator. Only a strict improvement from the shared complete soft scorer can be accepted.
- A selected MIO chef's feasible 3 MIO + 2 GT day plan is locked during local search; no chef is locked or reserved in a no-MIO week.
- Soft compromises are reported only from the final selected rota.

## Clarifications (confirmed from workbook)

### Daily sections
- **Core sections**: Pass, Sauce, Garnish, Larder, Pastry
- **Float** (if overstaffed or target-filling): One or more additional chefs across any section
- **Breakfast**: One eligible chef who is already assigned to a core section or Float that day (not separate)
- **MIO**: A separate kitchen for events (chefs loaned from GT). When used, it requires an eligible chef assigned exactly three weekday MIO shifts and exactly two GT days elsewhere in the same week. A week may instead select **No MIO chef**.

### Section levels
- **Should not cover (0)**: Chef cannot work this section
- **In training (1)**: Chef is training on this section
- **Competent (2)**: Chef is proficient on this section
- **Preferred (3)**: Chef is proficient and this is their strongest/favoured section

**Strategy**: Prioritize Preferred chefs on each section, then Competent, then In training. Display explanation text using level names rather than raw numeric values.

### Seniority validation
- **Daily requirement**: At least one Sous Chef or higher must work in the kitchen each day
- **Seniority levels** (from staff table):
  - 1-3: Junior, Commis, Junior CDP (not senior)
  - 4-5: CDP, Senior CDP (mid-level)
  - 6-10: Junior Sous, Sous, Senior Sous, Head Chef, Executive Chef (senior)

### MIO eligibility
- Chefs marked as "MIO not eligible" must never be assigned to MIO
- Only junior chefs (seniority 1-3) are eligible for MIO

### Section mapping
- Section names in Staff table (Pass, Sauce, Garnish, Larder, Pastry) map directly to rota sections
- Chef section level 0-3 indicates capability/preference for that section
