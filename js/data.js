export const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const sections = ['Pass', 'Sauce', 'Garnish', 'Larder', 'Pastry'];

const today = new Date();
export const defaultWeek = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

export const chefRoles = ['Executive Chef', 'Head Chef', 'Sous Chef', 'Chef de Partie', 'Demi Chef de Partie', 'Commis Chef'];

export const roleWeight = {
  'Commis Chef': 1,
  'Demi Chef de Partie': 2,
  'Chef de Partie': 3,
  'Sous Chef': 4,
  'Head Chef': 5,
  'Executive Chef': 6
};

export const initialStaff = [
  { name: 'Aled', role: 'Executive Chef', seniorityRank: 1, breakfastEligible: true, fixedDayOff: '', preferredDaysOff: ['Saturday', 'Sunday'], skills: { Pass: 3, Sauce: 1, Garnish: 1, Larder: 1, Pastry: 3, Breakfast: 3 }, preferredBreakfast: 'Monday', notes: 'Prefers pass or pastry' },
  { name: 'Charlie', role: 'Head Chef', seniorityRank: 2, breakfastEligible: true, fixedDayOff: 'Tuesday', preferredDaysOff: ['Tuesday'], skills: { Pass: 3, Sauce: 2, Garnish: 2, Larder: 2, Pastry: 2, Breakfast: 2 }, preferredBreakfast: 'Sunday', notes: 'Can work any section' },
  { name: 'Adam', role: 'Sous Chef', seniorityRank: 3, breakfastEligible: true, fixedDayOff: '', preferredDaysOff: [], skills: { Pass: 3, Sauce: 3, Garnish: 1, Larder: 3, Pastry: 1, Breakfast: 2 }, preferredBreakfast: '', notes: 'Prefers pass, larder or sauce' },
  { name: 'Connor', role: 'Sous Chef', seniorityRank: 3, breakfastEligible: true, fixedDayOff: '', preferredDaysOff: [], skills: { Pass: 2, Sauce: 3, Garnish: 2, Larder: 2, Pastry: 2, Breakfast: 2 }, preferredBreakfast: '', notes: 'Prefers sauce; can work any section' },
  { name: 'Dan', role: 'Chef de Partie', seniorityRank: 4, breakfastEligible: true, fixedDayOff: '', preferredDaysOff: [], skills: { Pass: 2, Sauce: 2, Garnish: 3, Larder: 2, Pastry: 2, Breakfast: 2 }, preferredBreakfast: '', notes: 'Prefers garnish; can work all sections' },
  { name: 'Fred', role: 'Chef de Partie', seniorityRank: 4, breakfastEligible: true, fixedDayOff: '', preferredDaysOff: [], skills: { Pass: 0, Sauce: 0, Garnish: 3, Larder: 0, Pastry: 0, Breakfast: 2 }, preferredBreakfast: '', notes: 'Garnish only at present' },
  { name: 'Joel', role: 'Chef de Partie', seniorityRank: 4, breakfastEligible: true, fixedDayOff: '', preferredDaysOff: [], skills: { Pass: 0, Sauce: 3, Garnish: 0, Larder: 0, Pastry: 0, Breakfast: 2 }, preferredBreakfast: '', notes: 'Sauce only at present' },
  { name: 'Camilla', role: 'Demi Chef de Partie', seniorityRank: 5, breakfastEligible: true, fixedDayOff: '', preferredDaysOff: [], skills: { Pass: 0, Sauce: 0, Garnish: 0, Larder: 3, Pastry: 3, Breakfast: 2 }, preferredBreakfast: '', notes: 'Pastry and larder' },
  { name: 'Brooke', role: 'Demi Chef de Partie', seniorityRank: 5, breakfastEligible: true, fixedDayOff: '', preferredDaysOff: [], skills: { Pass: 0, Sauce: 0, Garnish: 0, Larder: 2, Pastry: 3, Breakfast: 2 }, preferredBreakfast: '', notes: 'Prefer 3 pastry and 1 larder shift' },
  { name: 'Myles', role: 'Commis Chef', seniorityRank: 6, breakfastEligible: true, fixedDayOff: '', preferredDaysOff: [], skills: { Pass: 0, Sauce: 0, Garnish: 0, Larder: 3, Pastry: 0, Breakfast: 2 }, preferredBreakfast: '', notes: 'Larder only' }
];

export const state = {
  staff: JSON.parse(JSON.stringify(initialStaff)),
  availability: [
    { chef: 'Aled', type: 'Annual Leave', startDate: defaultWeek, finishDate: defaultWeek, notes: 'Example' }
  ],
  dailyOverrides: {}
};

export const MIO_ELIGIBILITY_STORAGE_KEY = 'gtRota.mioEligibilityByChef';
export const STAFF_PROFILE_STORAGE_KEY = 'gtRota.staffProfilesByChef';
