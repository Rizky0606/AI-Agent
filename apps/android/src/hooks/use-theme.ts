import { useColorScheme } from 'react-native';
import { resolveTheme, type AndroidTheme } from '../components/Theme.ts';
import { useUiStore } from '../state/ui-store.ts';

/**
 * Dynamic React hook returning the active theme tokens synchronized with ui-store.
 */
export function useAppTheme(): AndroidTheme {
  const preference = useUiStore((state) => state.theme);
  const systemScheme = useColorScheme();
  return resolveTheme(preference, systemScheme);
}
