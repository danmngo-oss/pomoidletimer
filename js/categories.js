// ============================================================================
// categories.js — the three kinds of focus.
//
// Each focus belongs to one category; a break preset lists the categories it
// restores (a walk helps both mind and body), and a finished break boosts idle
// output for every focus in those categories.
//
// To add a category, add an entry here. The keys ('mental', …) are what gets
// saved, so don't rename existing keys without a migration in state.js.
// ============================================================================
export const CATEGORIES = {
  mental: { label: 'Mental', icon: '🧠', hint: 'Mind-related tasks' },
  physical: { label: 'Physical', icon: '💪', hint: 'Body-related tasks' },
  life: { label: 'Life balance', icon: '🏠', hint: 'Chores and life admin' },
};

// ['mental', 'physical', 'life'] in display order.
export const CATEGORY_IDS = Object.keys(CATEGORIES);

// ['mental', 'physical'] -> '🧠💪'
export const categoryIcons = (ids = []) => ids.map((id) => CATEGORIES[id]?.icon ?? '').join('');
