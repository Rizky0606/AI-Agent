import { createAndroidTheme, type AndroidTheme, type ColorScheme } from '@personal-ai-os/shared';

export const darkTheme = createAndroidTheme('dark');
export const lightTheme = createAndroidTheme('light');

/** Default theme matching user's active theme (defaults to dark) */
export const theme = darkTheme;

export type { AndroidTheme, ColorScheme };
