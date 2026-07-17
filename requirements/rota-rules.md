# Rota rules

## Hard constraints

These are treated as hard requirements and should be enforced before any soft preferences are considered.

1. Exactly one breakfast chef is assigned each day.
2. At least one of Aled, Charlie, Adam, or Connor works each day.
3. Aled does not work Saturday or Sunday.
4. Charlie is always off Tuesday.
5. **Weekly GT targets are exact, not maximum-only**:
   - Normal chef: exactly 4 GT days.
   - Normal chef with annual leave: exactly `max(0, 4 - annual-leave days credited that week)` GT days.
   - Selected MIO chef: exactly 3 MIO days and exactly 2 GT days.
6. **Monday to Wednesday require 4 GT chefs** (not 5) unless an event requires extra cover (specified in event field).
7. **Thursday to Sunday require at least 5 GT chefs** and may include extra Float chefs to complete weekly targets.
8. **Pass section is NOT required Monday-Wednesday** (only Sauce, Garnish, Larder, Pastry).
9. **Float section**:
   - When all core sections are assigned, additional target-filling or explicitly requested chefs must be assigned to **Float**.
   - Float counts as a GT day and GT hours, appears in `day.chefs`, and is stored explicitly in `day.assignments`.
   - More than one Float chef may be used on the same day.
   - A Float chef must not also hold another primary GT section that day.
10. Required sections must be covered by an eligible chef.
11. A breakfast chef must also appear on a core section for that day.
12. The rota must respect fixed availability, annual leave, and section eligibility.
13. The rota must not invent sickness or make up unavailable time; only the provided leave/unavailability data should be used.
14. Exactly one eligible junior chef is assigned to MIO each week.
15. MIO pattern is Monday–Wednesday at MIO and exactly two non-overlapping GT days in the same week; if annual leave makes that impossible, the week is infeasible.
16. If a chef is unavailable on a normal MIO day, the MIO assignment may move only to Thursday or Friday, per the AI prompt.
17. The rota must preserve the workbook's layout, formulas, and rules when updated.
18. At least one Sous Chef or higher must work in the kitchen each day.
19. Chefs marked as "MIO not eligible" must never be assigned to MIO.

## Soft preferences

These are scoring and quality objectives rather than hard blocking rules.

1. Target about 48 credited hours per chef each week, with a tolerance of about ±2 hours.
2. Prefer two consecutive days off where possible.
3. Prefer assigning chefs at Preferred level before Competent level, and Competent level before In training.
4. Use fair Friday/Saturday/Sunday rotation where possible.
5. Provide useful training opportunities without weakening service.
6. Avoid more than one breakfast assignment per chef in a week unless required.
7. Brooke should ideally work 3 pastry shifts and 1 larder shift in a normal GT week.
8. Aled prefers Monday breakfast.
9. Charlie prefers Sunday breakfast.
10. Friday, Saturday, and Sunday duties should rotate fairly among interchangeable chefs.
11. Friday–Sunday should preferably include at least two senior chefs.
12. The rota should avoid unnecessary overstaffing, but must use Float whenever extra GT days are required to satisfy exact weekly chef targets.
13. Thursday to Sunday, Pass should be assigned to an available senior chef where this can be achieved without breaking hard constraints.

## Important notes from the workbook

- The workbook's AI prompt says the AI should generate at least three candidate rotas, score them, and select the highest-scoring valid rota.
- The workbook's scoring sheet explicitly states that hard-rule failures cap the overall score at 80.
- The workbook indicates that the AI prompt and scoring sheet are intended to be used as the source of truth for rule interpretation.

## Clarifications (confirmed from workbook)

### Daily sections
- **Core sections**: Pass, Sauce, Garnish, Larder, Pastry
- **Float** (if overstaffed or target-filling): One or more additional chefs across any section
- **Breakfast**: One chef who is already assigned to a core section that day (not separate)
- **MIO**: A separate kitchen for events (chefs loaned from GT); requires an eligible junior chef assigned Mon-Wed at MIO and exactly two GT days elsewhere in the same week

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
