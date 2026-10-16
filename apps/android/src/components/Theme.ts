import { createAndroidTheme, type AndroidTheme, type ColorScheme } from '@personal-ai-os/shared';

export const darkTheme = createAndroidTheme('dark');
export const lightTheme = createAndroidTheme('light');

/** Default fallback theme for static StyleSheet definitions */
export const theme = darkTheme;

/**
 * Resolves the active theme based on user preference and system color scheme.
 */
export function resolveTheme(
  preference: 'system' | 'light' | 'dark',
  systemScheme?: ColorScheme | null,
): AndroidTheme {
  if (preference === 'light') return lightTheme;
  if (preference === 'dark') return darkTheme;
  return systemScheme === 'light' ? lightTheme : darkTheme;
}

export type { AndroidTheme, ColorScheme };
