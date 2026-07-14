# GT Rota Builder

A web-based chef scheduling application that generates weekly rotas based on availability, skills, and business rules.

## Features

- **Live rota generation** with real-time updates as inputs change
- **Chef scheduling** with skill-based section assignments
- **Availability management** for annual leave and unavailable dates
- **Breakfast shift scheduling** with max 1 breakfast per chef per week
- **4-day working week enforcement** for staff members
- **Hours tracking** with adjusted calculations for breakfast shifts
- **Rule-based configuration** for customizing shift preferences
- **Validation alerts** for scheduling conflicts and constraint violations

## How to Use

1. Open `GT Rota builder.html` in a web browser
2. Enter the week commencing date
3. Configure staff availability and skills
4. Select a MIO (Management Improvement Officer) chef if needed
5. Apply any custom rule changes
6. Review the generated rota and hours summary

## Scheduling Rules

### Core Constraints
- Each chef works a maximum of 4 shifts per week
- 4-6 chefs per day depending on weekday/weekend
- Breakfast coverage every day
- MIO assignment when specified

### Breakfast Shifts
- One breakfast shift per chef per week (hard limit)
- Breakfast counts as ONE of the 4-day working week
- 7:30am start time with adjusted hours:
  - Mon-Fri: 14 hours
  - Saturday: 14.5 hours
  - Sunday: 12.5 hours

### Regular Shift Hours
- Monday-Friday: 11.5 hours
- Saturday: 12.5 hours
- Sunday: 11 hours

## File Structure

```
gt-rota-builder/
├── GT Rota builder.html      # Main application (all CSS/JS embedded)
├── README.md                 # This file
├── requirements/             # Supporting documentation
│   ├── data-model.md
│   ├── rota-rules.md
│   ├── acceptance-tests.md
│   └── workbook-map.md
```

## Configuration

Edit the natural-language rule field in the app to customize:
- Chef day-off preferences
- Section preferences (preferred/avoided)
- Breakfast eligibility
- Any other scheduling overrides

Example: `Aled prefers Pass; Charlie off Tuesday; Dan breakfast eligible`

## Technology

- Pure HTML5 with embedded CSS and JavaScript
- No external dependencies or build tools required
- Runs entirely in the browser
- Data managed in-memory (no persistence)

## Development

To modify the application:

1. Open `GT Rota builder.html` in a text editor
2. Edit the embedded JavaScript and CSS as needed
3. Reload in browser to test changes
4. Commit changes to git: `git add . && git commit -m "description"`

## Testing

Run the Python HTTP server to serve locally:

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/GT%20Rota%20builder.html` in your browser.

## Recent Updates

- ✅ Fixed timezone-related date display issues
- ✅ Implemented breakfast shift constraints (max 1 per chef per week)
- ✅ Updated hours calculation for 7:30am breakfast start times
- ✅ Added validation for breakfast constraint violations

## License

Internal use only

## Author

Dan Bell
