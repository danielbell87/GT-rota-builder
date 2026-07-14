# Rota rules

## Hard constraints

These are treated as hard requirements and should be enforced before any soft preferences are considered.

1. Exactly one breakfast chef is assigned each day.
2. At least one of Aled, Charlie, Adam, or Connor works each day.
3. Aled does not work Saturday or Sunday.
4. Charlie is always off Tuesday.
5. Monday to Wednesday require 4 GT chefs.
6. Thursday to Sunday require 5 GT chefs.
7. Required sections must be covered by an eligible chef.
8. A breakfast chef must also appear on a core section for that day.
9. The rota must respect fixed availability, annual leave, and section eligibility.
10. The rota must not invent sickness or make up unavailable time; only the provided leave/unavailability data should be used.
11. Exactly one eligible junior chef is assigned to MIO each week.
12. MIO pattern is Monday–Wednesday at MIO and Saturday–Sunday at GT.
13. If a chef is unavailable on a normal MIO day, the MIO assignment may move only to Thursday or Friday, per the AI prompt.
14. The rota must preserve the workbook's layout, formulas, and rules when updated.
15. At least one Sous Chef or higher must work in the kitchen each day.
16. Chefs marked as "MIO not eligible" must never be assigned to MIO.

## Soft preferences

These are scoring and quality objectives rather than hard blocking rules.

1. Target about 48 credited hours per chef each week, with a tolerance of about ±2 hours.
2. Prefer two consecutive days off where possible.
3. Prefer assigning chefs to their preferred sections (strength 3) before assigning them to competent sections (strength 2) or training (strength 1).
4. Use fair Friday/Saturday/Sunday rotation where possible.
5. Provide useful training opportunities without weakening service.
6. Avoid more than one breakfast assignment per chef in a week unless required.
7. Brooke should ideally work 3 pastry shifts and 1 larder shift in a normal GT week.
8. Aled prefers Monday breakfast.
9. Charlie prefers Sunday breakfast.
10. Friday, Saturday, and Sunday duties should rotate fairly among interchangeable chefs.
11. Friday–Sunday should preferably include at least two senior chefs.
12. The rota should be efficient and avoid deliberate overstaffing unless needed for coverage.

## Important notes from the workbook

- The workbook's AI prompt says the AI should generate at least three candidate rotas, score them, and select the highest-scoring valid rota.
- The workbook's scoring sheet explicitly states that hard-rule failures cap the overall score at 80.
- The workbook indicates that the AI prompt and scoring sheet are intended to be used as the source of truth for rule interpretation.

## Clarifications (confirmed from workbook)

### Daily sections
- **Core sections**: Pass, Sauce, Garnish, Larder, Pastry
- **Float** (if overstaffed): One additional chef across any section
- **Breakfast**: One chef who is already assigned to a core section that day (not separate)
- **MIO**: A separate kitchen for events (chefs loaned from GT); requires eligible junior chef assigned Mon-Wed at MIO and Sat-Sun at GT

### Preferred sections quality score (weighted)
- **0**: Chef cannot work this section
- **1**: Chef is training on this section
- **2**: Chef is proficient on this section
- **3**: Chef is proficient AND this is their preferred/strongest section

**Strategy**: Prioritize assigning strength-3 chefs to each section, then strength-2, then strength-1. Display explanation box showing each chef's assignment and quality score.

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
- Chef strength value 0-3 indicates capability/preference for that section
