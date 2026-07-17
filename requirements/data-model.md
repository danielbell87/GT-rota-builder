# Proposed data model

## Core entities

### Staff
Represents each chef in the kitchen team.

Fields:
- id: unique identifier
- name: full name
- role: display-only job role or title
- senior: boolean; the sole source of senior-cover eligibility
- breakfast_eligible: boolean
- mio_eligible: boolean
- preferred_days_off: list of day names (Sunday through Saturday)
- skills: section-level map using Should not cover, In training, Competent, and Preferred
- notes: free-text notes

### WeeklyInput
Represents the weekly planning context.

Fields:
- id: unique identifier
- week_commencing: date
- mio_chef: staff id or name
- busy_service_or_event: text
- additional_gt_chef_request: text
- natural_language_changes: text
- status: enum (Draft, Ready for AI, Published)
- created_at: timestamp
- updated_at: timestamp

### AvailabilityEntry
Represents a weekly leave or unavailability record.

Fields:
- id: unique identifier
- weekly_input_id: foreign key
- staff_id: foreign key
- entry_type: enum (Annual Leave, Unavailable)
- date: date
- notes: optional free text

### Rule
Represents a configurable rule or requirement.

Fields:
- id: unique identifier
- rule_id: short code such as H002
- priority: enum (Hard, High, Medium, Low)
- active: boolean
- rule_text: long-form description
- category: optional category such as staffing, breakfast, MIO

### DayRequirement
Represents the staffing requirement for a specific day.

Fields:
- id: unique identifier
- day_name: enum (Monday–Sunday)
- gt_chefs_required: integer
- pass_required: boolean
- breakfast_required: boolean
- section_requirements: JSON or separate child rows

### SectionRequirement
Represents required section coverage for one day.

Fields:
- id: unique identifier
- day_requirement_id: foreign key
- section_name: text (Pass, Sauce, Garnish, Larder, Pastry, Breakfast, Tournant)
- required: boolean
- notes: optional text

### RotaAssignment
Represents one shift assignment in the weekly rota.

Fields:
- id: unique identifier
- weekly_input_id: foreign key
- date: date
- day_name: enum
- section_name: text
- staff_id: foreign key
- breakfast_assignment: boolean
- is_mio_assignment: boolean
- notes: optional text

### ValidationResult
Represents a calculated validation result.

Fields:
- id: unique identifier
- weekly_input_id: foreign key
- check_name: text
- status: text (OK, CHECK, BREACH, MISSING, etc.)
- details: text
- severity: enum

### RotaScoreResult
Represents the scoring output for the weekly rota.

Fields:
- id: unique identifier
- weekly_input_id: foreign key
- compliance_score: numeric
- quality_score: numeric
- overall_score: numeric
- tier: text
- explanation: text
- created_at: timestamp

### HistoryEntry
Represents the published historical record for a week.

Fields:
- id: unique identifier
- week_commencing: date
- staff_id: foreign key
- gt_days: integer
- mio_days: integer
- leave_days: integer
- hours: numeric
- breakfasts: integer
- friday_worked: boolean
- saturday_worked: boolean
- sunday_worked: boolean
- notes: text
- published_at: timestamp

## Suggested relationships

- Staff 1:N AvailabilityEntry
- WeeklyInput 1:N AvailabilityEntry
- WeeklyInput 1:N RotaAssignment
- WeeklyInput 1:N ValidationResult
- WeeklyInput 1:N RotaScoreResult
- WeeklyInput 1:N HistoryEntry
- DayRequirement 1:N SectionRequirement
- Staff 1:N RotaAssignment

## Implementation note

Where possible, store structured values rather than free text. The workbook’s natural-language changes and notes fields are still valuable, but they should be preserved as free text while the core rules remain structured.
