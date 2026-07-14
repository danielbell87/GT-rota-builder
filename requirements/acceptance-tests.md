# Acceptance tests

These tests are designed to prove that each hard rule is enforced.

## 1. Breakfast coverage
- Given a weekly rota with no breakfast assignment on a given day,
- when the rota is validated,
- then the validation result must report a breakfast coverage failure.

## 2. Exactly one breakfast chef per day
- Given a rota where two chefs are assigned as breakfast chef for the same day,
- when the validation runs,
- then the rota must fail and the reason must identify the duplicate breakfast assignment.

## 3. Aled weekend availability
- Given a rota that places Aled on Saturday or Sunday,
- when the validation runs,
- then the rota must fail with a fixed-rule breach for the Aled weekend restriction.

## 4. Charlie Tuesday availability
- Given a rota that places Charlie on Tuesday,
- when the validation runs,
- then the rota must fail with a fixed-rule breach for the Charlie Tuesday restriction.

## 5. Minimum daily GT staffing
- Given a Monday-to-Wednesday rota with fewer than 4 GT chefs assigned,
- when the validation runs,
- then the rota must fail for understaffing.

## 6. Thursday-to-Sunday staffing
- Given a Thursday-to-Sunday rota with fewer than 5 GT chefs assigned,
- when the validation runs,
- then the rota must fail for understaffing.

## 7. Daily senior coverage
- Given a day with no senior chef assigned from the required senior pool,
- when the validation runs,
- then the rota must fail the seniority check for that day.

## 8. Required section coverage
- Given a day where a required section is left unassigned or assigned to an ineligible chef,
- when the validation runs,
- then the rota must fail the section-coverage check.

## 9. Leave and unavailability enforcement
- Given a chef who has an annual leave or unavailable entry for a date,
- when the rota is generated,
- then that chef must not be assigned to that date.

## 10. MIO weekly assignment
- Given a week with no eligible junior chef assigned to MIO,
- when the validation runs,
- then the rota must fail the MIO assignment check.

## 11. MIO pattern
- Given a rota that assigns MIO on a weekend day,
- when the validation runs,
- then the rota must fail because MIO is only permitted Monday–Wednesday and not on weekends.

## 12. MIO fallback rule
- Given a chef who is unavailable on a normal MIO day,
- when the rota is generated,
- then the MIO assignment may only move to Thursday or Friday, and the result must satisfy that constraint.

## 13. Daily core coverage requirement
- Given a day where the breakfast chef does not also appear on a core section,
- when the validation runs,
- then the rota must fail the breakfast/core-section check.

## 14. At least one of the senior core chefs each day
- Given a day where none of Aled, Charlie, Adam, or Connor is assigned,
- when the validation runs,
- then the rota must fail the daily core-chef check.

## 15. Hard-rule dominance over scoring
- Given a rota that would score higher if a hard rule were broken,
- when the scoring is calculated,
- then the result must still be treated as invalid and capped appropriately rather than accepting the higher-scoring but invalid rota.

## 16. Publish-only history update
- Given a weekly input whose status is not Published,
- when the history update process runs,
- then no history rows must be created or updated.

## 17. History uniqueness
- Given a week and chef that already have an existing history row,
- when the history update process runs,
- then the existing row must be updated rather than duplicated.
