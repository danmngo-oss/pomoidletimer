// The three kinds of focus. Each focus belongs to one category; a break preset
// lists the categories it restores (a walk helps both mind and body), and a
// finished break boosts idle output for every focus in those categories.
export const CATEGORIES = {
  mental: { label: 'Mental', icon: '🧠', hint: 'Mind-related tasks' },
  physical: { label: 'Physical', icon: '💪', hint: 'Body-related tasks' },
  life: { label: 'Life balance', icon: '🏠', hint: 'Chores and life admin' },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES);

export const categoryIcons = (ids = []) => ids.map((id) => CATEGORIES[id]?.icon ?? '').join('');
