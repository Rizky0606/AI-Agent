import React, { useEffect, useState } from 'react';
import { Moon, Monitor, Sun } from 'lucide-react';
import { Button } from './Button.tsx';
import {
  applyTheme,
  getStoredThemePreference,
  saveThemePreference,
  type ThemePreference,
} from './theme-manager.ts';
import './Components.css';

export interface ThemeSwitcherProps {
  className?: string;
}

export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({ className = '' }) => {
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    const initial = getStoredThemePreference();
    setPreference(initial);
    applyTheme(initial);

    // If preference is system, listen for OS changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = () => {
      const current = getStoredThemePreference();
      if (current === 'system') {
        applyTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const handleSelect = (next: ThemePreference) => {
    setPreference(next);
    saveThemePreference(next);
    applyTheme(next);
  };

  return (
    <div
      className={`ui-button-group ${className}`.trim()}
      role="group"
      aria-label="Pilih tema tampilan"
    >
      <Button
        variant={preference === 'system' ? 'secondary' : 'ghost'}
        size="sm"
        iconLeft={<Monitor size={14} aria-hidden="true" />}
        onClick={() => handleSelect('system')}
        title="Ikuti tema sistem operasi"
        aria-pressed={preference === 'system'}
      >
        Sistem
      </Button>
      <Button
        variant={preference === 'light' ? 'secondary' : 'ghost'}
        size="sm"
        iconLeft={<Sun size={14} aria-hidden="true" />}
        onClick={() => handleSelect('light')}
        title="Gunakan tema terang"
        aria-pressed={preference === 'light'}
      >
        Terang
      </Button>
      <Button
        variant={preference === 'dark' ? 'secondary' : 'ghost'}
        size="sm"
        iconLeft={<Moon size={14} aria-hidden="true" />}
        onClick={() => handleSelect('dark')}
        title="Gunakan tema gelap"
        aria-pressed={preference === 'dark'}
      >
        Gelap
      </Button>
    </div>
  );
};
