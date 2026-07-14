export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const CORE_SECTIONS = ['Pass', 'Sauce', 'Garnish', 'Larder', 'Pastry'];
export const DISPLAY_SECTIONS = ['Pass', 'Sauce', 'Garnish', 'Larder', 'Pastry', 'Float', 'Breakfast', 'MIO'];

export const CHEF_ROLES = ['Executive Chef', 'Head Chef', 'Sous Chef', 'Chef de Partie', 'Demi Chef de Partie', 'Commis Chef'];

export const ROLE_WEIGHT = {
  'Commis Chef': 1,
  'Demi Chef de Partie': 2,
  'Chef de Partie': 3,
  'Sous Chef': 4,
  'Head Chef': 5,
  'Executive Chef': 6
};

export const MIO_SEQUENCE = {
  primary: ['Monday', 'Tuesday', 'Wednesday'],
  fallback: ['Thursday', 'Friday'],
  forbidden: ['Saturday', 'Sunday']
};

export const SHIFT_LENGTHS = {
  regular: { MonFri: 11.5, Saturday: 12.5, Sunday: 11 },
  breakfast: { MonFri: 14, Saturday: 14.5, Sunday: 12.5 },
  mio: 9,
  annualLeaveCreditPerDay: 12
};

export const TARGET_HOURS = {
  weekly: 48,
  tolerance: 2
};

export const SCORING_WEIGHTS = {
  preferredSection: 4,
  proficientSection: 2,
  trainingSection: 1,
  avoidedSectionPenalty: -5,
  weekendFairnessPenalty: -2,
  breakfastFairnessPenalty: -2,
  twoConsecutiveDaysOffBonus: 2,
  seniorDistributionBonus: 2
};

export const STATUS_VALUES = ['Draft', 'Ready for AI', 'Published'];
