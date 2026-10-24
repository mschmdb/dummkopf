// Light/dark state. The pure resolver mirrors the no-flash script in app.html and is testable without a DOM.

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

/** A valid stored value wins, else the system preference. */
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return prefersDark ? "dark" : "light";
}

/** Apply and remember a theme. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}
