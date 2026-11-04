// The day the day slider shows. Kept apart from the slider so layers can read it without importing the slider.

let selected: string | null = null;

/** The slider day (YYYY-MM-DD), or null while the latest data is shown. */
export const selectedDay = (): string | null => selected;
export const setSelectedDay = (day: string | null) => {
  selected = day;
};
