# Workbook map

## Purpose of each sheet

### Dashboard
- Purpose: printable weekly summary for management.
- Shows week commencing, status, MIO chef, compliance, quality, overall tier, and key warnings.
- Summarises whether the current rota is ready to review or publish.

### Instructions
- Purpose: operating guide for using the workbook.
- Describes the workflow from editing Weekly Inputs, generating the rota with AI, reviewing the output, and publishing to History.

### Weekly Inputs
- Purpose: weekly source-of-truth inputs for the rota.
- Contains the week context, MIO allocation, special events, extra-cover requests, natural-language changes, status, and leave/unavailability entries.

### Rota
- Purpose: the actual weekly rota grid.
- Contains daily staffing rows and the chef assignments for each day/section.
- Includes breakfast and core-section placements, plus coverage and validation-related references.

### Validation
- Purpose: rule-checking sheet.
- Calculates daily staffing coverage, breakfast coverage, seniority coverage, hours variance, and fixed-rule breaches.
- Flags issues that make the rota invalid or suboptimal.

### Rota Score
- Purpose: scoring and explanation sheet.
- Calculates compliance and quality scores, overall score, tier, and a plain-English explanation.
- Uses the validation results and other rota characteristics to grade the solution.

### Staff
- Purpose: master staff database.
- Holds staff names, roles, seniority, contract hours, section levels, eligibility, editable Preferred Days Off, and notes.

### Settings
- Purpose: rule catalog and configuration.
- Stores the operating rules, required staffing levels by day, section requirements, and rule IDs with active/inactive flags.

### History
- Purpose: published rota archive.
- Stores one row per chef per published week so prior rota weeks can be compared.

### AI Prompt
- Purpose: prompt package for external AI generation.
- Contains the conversational prompt and the detailed instructions that describe how the rota should be generated.

### Version History
- Purpose: change log for the workbook.
- Documents workbook versions and the reason for each update.

### Export Summary
- Purpose: mapping from Numbers sheets/tables to Excel worksheets.
- Records the workbook export structure and is not an operational input sheet.

## Editable inputs

### Weekly Inputs
- Week commencing date
- MIO chef
- Busy service / event
- Additional GT chef request
- Natural-language changes
- Status (Draft / Ready for AI / Published)
- Annual Leave entries
- Unavailable entries

### Staff
- Staff name, role, seniority rank, contract hours, eligibility flags, section levels, Preferred Days Off, notes

### Settings
- Rule text and active flags
- Staffing requirements by day
- Section requirements by day
- Other operational defaults

## Calculated outputs

### Rota
- Daily coverage summary
- Breakfast assignment summary
- Core-section coverage references
- Chef-level assignment counts and hours estimates

### Validation
- Daily staffing status
- Breakfast coverage status
- Pass coverage status
- Seniority coverage status
- Fixed-rule breach status
- Hours variance and comments

### Rota Score
- Compliance score
- Quality score
- Overall score
- Tier
- Plain-English explanation

### Dashboard
- Compliance, quality, overall, tier, warnings, and publication guidance

## Dropdown values

The workbook uses several dropdown-style fields in the weekly input section and rule tables. The current workbook contents indicate the following likely values:

### Status dropdown
- Draft
- Ready for AI
- Published

### Weekly request / leave / unavailable type values
- Annual Leave
- Unavailable

### Staff section skill scale
- 3.0 = Preferred / can lead section
- 2.0 = Fully competent
- 1.0 = Training / emergency only
- 0.0 = Do not roster on this section

### Rule priority / severity values
- Hard
- High
- Medium
- Low

## Important formulas and logic

### Settings
- H003: Exactly one breakfast chef is assigned each day.
- H004: Monday to Wednesday require 4 GT chefs.
- H005: Thursday to Sunday require 5 GT chefs.
- H006: Exactly one eligible junior chef is assigned to MIO each week.
- H007: MIO pattern is Monday–Wednesday at MIO and Saturday–Sunday at GT.
- H008: At least one of Aled, Charlie, Adam, or Connor works each day.
- H009: Required sections must be covered by an eligible chef.
- H010: Annual leave credits are 12 hours per day; 4 days covers a full 7-day week away.

### Validation
- Daily staffing checks use the rota table and day-level staffing requirements.
- Hard-rule checks reference dated availability, rota coverage, section eligibility, and breakfast coverage; chef names do not determine recurring days off.
- Hours checks compare estimated credited hours to the 48-hour target and mark a variance when it exceeds the tolerance.

### Rota Score
- Compliance score is formula-driven and capped by hard-rule failures.
- Overall score is a weighted blend of compliance and quality.
- Tier is determined by score thresholds.
- Explanation text is generated from the score and the validation results.

## Notes and ambiguities
- The workbook appears to contain formulas and references that are not fully inspectable from the extracted package alone, especially in the Rota, Validation, and Rota Score sheets.
- The most precise interpretation of the rules comes from the AI Prompt and Settings sheets, which describe the intended logic in plain English.
- Some sheet-level formatting, colours, and hidden assumptions are not fully recoverable from the extracted data and should be treated as implementation detail unless confirmed directly in the workbook.
