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
14. The rota must preserve the workbook’s layout, formulas, and rules when updated.

## Soft preferences

These are scoring and quality objectives rather than hard blocking rules.

1. Target about 48 credited hours per chef each week, with a tolerance of about ±2 hours.
2. Prefer two consecutive days off where possible.
3. Prefer assigning chefs to their preferred sections before assigning them to merely competent sections.
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

- The workbook’s AI prompt says the AI should generate at least three candidate rotas, score them, and select the highest-scoring valid rota.
- The workbook’s scoring sheet explicitly states that hard-rule failures cap the overall score at 80.
- The workbook indicates that the AI prompt and scoring sheet are intended to be used as the source of truth for rule interpretation.

## Ambiguities to flag

The following points are present in the workbook but are not fully specified enough to implement without guessing:

1. The exact daily section layout for each day is not fully visible from the extracted workbook data alone; the Rota sheet layout must be preserved as-is.
2. The exact formula for the “preferred sections” quality score is not fully recoverable from the extracted data, so it should be treated as an AI-judgement or manual scoring input unless confirmed directly in the workbook.
3. The exact definition of “seniority” in the daily staffing check is partially inferred from the Staff table and validation logic but should be confirmed against the workbook if precise implementation is required.
4. The exact mapping between section names in the staff table and the rota’s daily section roles is partly inferred and should be confirmed before implementation.
5. The exact treatment of “MIO eligible” and “MIO pattern” for chefs not listed as eligible is not fully explicit in the extracted data.
