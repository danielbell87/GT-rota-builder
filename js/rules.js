import { getState } from './state.js';

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSection(section) {
  const normalized = (section || '').toLowerCase().trim();
  const map = {
    pass: 'Pass',
    'pass section': 'Pass',
    sauce: 'Sauce',
    garnish: 'Garnish',
    larder: 'Larder',
    pastry: 'Pastry',
    breakfast: 'Breakfast',
    'breakfast section': 'Breakfast',
    breakie: 'Breakfast'
  };
  return map[normalized] || (section ? section.charAt(0).toUpperCase() + section.slice(1) : '');
}

function normalizeDay(day) {
  const normalized = (day || '').toLowerCase().trim();
  const map = {
    mon: 'Monday', monday: 'Monday',
    tue: 'Tuesday', tuesday: 'Tuesday',
    wed: 'Wednesday', wednesday: 'Wednesday',
    thu: 'Thursday', thursday: 'Thursday',
    fri: 'Friday', friday: 'Friday',
    sat: 'Saturday', saturday: 'Saturday',
    sun: 'Sunday', sunday: 'Sunday'
  };
  return map[normalized] || (day ? day.charAt(0).toUpperCase() + day.slice(1) : '');
}

export function getRuleOverrides(text) {
  const state = getState();
  const overrides = { dayOffs: {}, preferredSections: {}, avoidedSections: {} };
  if (!text) return overrides;

  const phrases = text.split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
  for (const phrase of phrases) {
    const lowerPhrase = phrase.toLowerCase();
    for (const staff of state.staff) {
      const name = staff.name;
      const namePattern = escapeRegex(name.toLowerCase());
      const dayPatterns = [
        new RegExp(`${namePattern}\\s+(?:is\\s+)?(?:off|day off|not working|not available|not on|free on|away on)\\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)`),
        new RegExp(`${namePattern}\\s+(?:should|must|needs?|wants?)\\s+be\\s+(?:off|day off)\\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)`),
        new RegExp(`${namePattern}\\s+(?:has|needs?|wants?)\\s+(?:a\\s+)?day\\s+off(?:\\s+on)?\\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)`)
      ];

      for (const pattern of dayPatterns) {
        const dayMatch = lowerPhrase.match(pattern);
        if (dayMatch) {
          const day = normalizeDay(dayMatch[1]);
          overrides.dayOffs[name] = [...(overrides.dayOffs[name] || []), day];
          break;
        }
      }

      const prefPatterns = [
        new RegExp(`${namePattern}\\s+(?:prefer(?:s)?|would like|wants? to work|should work|must work|needs? to work|is best on|is good on|should be on)\\s+(pass|sauce|garnish|larder|pastry|breakfast|pass section|breakfast section)`),
        new RegExp(`${namePattern}\\s+for\\s+(pass|sauce|garnish|larder|pastry|breakfast|pass section|breakfast section)`)
      ];
      for (const pattern of prefPatterns) {
        const prefMatch = lowerPhrase.match(pattern);
        if (prefMatch) {
          const section = normalizeSection(prefMatch[1]);
          const weight = lowerPhrase.includes('must work') || lowerPhrase.includes('needs to work') ? 3 : 2;
          overrides.preferredSections[name] = {
            ...(overrides.preferredSections[name] || {}),
            [section]: (overrides.preferredSections[name]?.[section] || 0) + weight
          };
          break;
        }
      }

      const avoidPatterns = [
        new RegExp(`${namePattern}\\s+(?:avoid|does not want|doesn't want|should not work|must not work|cannot work|can't work|is not suited to|is not on)\\s+(pass|sauce|garnish|larder|pastry|breakfast|pass section|breakfast section)`),
        new RegExp(`${namePattern}\\s+(?:does not want|doesn't want|should not work|must not work)\\s+(?:to\\s+)?work\\s+(?:on\\s+)?(pass|sauce|garnish|larder|pastry|breakfast|pass section|breakfast section)`)
      ];
      for (const pattern of avoidPatterns) {
        const avoidMatch = lowerPhrase.match(pattern);
        if (avoidMatch) {
          const section = normalizeSection(avoidMatch[1] || avoidMatch[2]);
          overrides.avoidedSections[name] = {
            ...(overrides.avoidedSections[name] || {}),
            [section]: (overrides.avoidedSections[name]?.[section] || 0) + 3
          };
          break;
        }
      }
    }
  }

  return overrides;
}
