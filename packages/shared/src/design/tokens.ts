export type ColorScheme = 'dark' | 'light';

export interface ThemeColors {
  // Surfaces
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceOverlay: string;

  // Borders
  border: string;
  borderSubtle: string;
  borderFocus: string;

  // Typography
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  // Action / Accent (Teal-Mint)
  accent: string;
  accentHover: string;
  accentSubtle: string;
  accentText: string;

  // Semantic Status & Risk
  success: string;
  successSubtle: string;
  warning: string;
  warningSubtle: string;
  danger: string;
  dangerSubtle: string;
  info: string;
  infoSubtle: string;

  // Risk levels
  riskLow: string;
  riskLowSubtle: string;
  riskMedium: string;
  riskMediumSubtle: string;
  riskHigh: string;
  riskHighSubtle: string;
  riskCritical: string;
  riskCriticalSubtle: string;
}

export interface DesignTokens {
  colors: Record<ColorScheme, ThemeColors>;
  spacing: {
    1: number; // 4px
    2: number; // 8px
    3: number; // 12px
    4: number; // 16px
    6: number; // 24px
    8: number; // 32px
  };
  borderRadius: {
    sm: number; // 8px
    md: number; // 12px
    lg: number; // 16px
    xl: number; // 20px
    full: number; // 9999px
  };
  typography: {
    fontSans: string;
    fontMono: string;
    scales: {
      caption: { fontSize: number; lineHeight: number; fontWeight: string };
      body: { fontSize: number; lineHeight: number; fontWeight: string };
      subheading: { fontSize: number; lineHeight: number; fontWeight: string };
      heading: { fontSize: number; lineHeight: number; fontWeight: string };
      display: { fontSize: number; lineHeight: number; fontWeight: string };
    };
  };
  controls: {
    minTouchTarget: number;
    iconSizeSm: number;
    iconSizeMd: number;
    iconSizeLg: number;
  };
}

export const darkColors: ThemeColors = {
  background: '#0F1115',
  surface: '#171A21',
  surfaceElevated: '#1F232C',
  surfaceOverlay: 'rgba(23, 26, 33, 0.85)',

  border: 'rgba(255, 255, 255, 0.08)',
  borderSubtle: '#262B36',
  borderFocus: '#2DD4BF',

  textPrimary: '#ECEEF2',
  textSecondary: '#9AA1AE',
  textMuted: '#636B79',
  textInverse: '#0F1115',

  accent: '#2DD4BF',
  accentHover: '#14B8A6',
  accentSubtle: 'rgba(45, 212, 191, 0.12)',
  accentText: '#0F1115',

  success: '#22C55E',
  successSubtle: 'rgba(34, 197, 94, 0.15)',
  warning: '#F59E0B',
  warningSubtle: 'rgba(245, 158, 11, 0.15)',
  danger: '#EF4444',
  dangerSubtle: 'rgba(239, 68, 68, 0.15)',
  info: '#2DD4BF',
  infoSubtle: 'rgba(45, 212, 191, 0.12)',

  riskLow: '#2DD4BF',
  riskLowSubtle: 'rgba(45, 212, 191, 0.12)',
  riskMedium: '#F59E0B',
  riskMediumSubtle: 'rgba(245, 158, 11, 0.15)',
  riskHigh: '#F97316',
  riskHighSubtle: 'rgba(249, 115, 22, 0.15)',
  riskCritical: '#EF4444',
  riskCriticalSubtle: 'rgba(239, 68, 68, 0.15)',
};

export const lightColors: ThemeColors = {
  background: '#FAFAF8',
  surface: '#FFFFFF',
  surfaceElevated: '#F1F3F5',
  surfaceOverlay: 'rgba(255, 255, 255, 0.90)',

  border: 'rgba(0, 0, 0, 0.08)',
  borderSubtle: '#E2E5E9',
  borderFocus: '#0D9488',

  textPrimary: '#15171C',
  textSecondary: '#5B6270',
  textMuted: '#8A92A0',
  textInverse: '#FFFFFF',

  accent: '#0D9488',
  accentHover: '#0F766E',
  accentSubtle: 'rgba(13, 148, 136, 0.10)',
  accentText: '#FFFFFF',

  success: '#16A34A',
  successSubtle: 'rgba(22, 163, 74, 0.12)',
  warning: '#D97706',
  warningSubtle: 'rgba(217, 119, 6, 0.12)',
  danger: '#DC2626',
  dangerSubtle: 'rgba(220, 38, 38, 0.12)',
  info: '#0D9488',
  infoSubtle: 'rgba(13, 148, 136, 0.10)',

  riskLow: '#0D9488',
  riskLowSubtle: 'rgba(13, 148, 136, 0.10)',
  riskMedium: '#D97706',
  riskMediumSubtle: 'rgba(217, 119, 6, 0.12)',
  riskHigh: '#EA580C',
  riskHighSubtle: 'rgba(234, 88, 12, 0.12)',
  riskCritical: '#DC2626',
  riskCriticalSubtle: 'rgba(220, 38, 38, 0.12)',
};

export const tokens: DesignTokens = {
  colors: {
    dark: darkColors,
    light: lightColors,
  },
  spacing: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    6: 24,
    8: 32,
  },
  borderRadius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    full: 9999,
  },
  typography: {
    fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    fontMono: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
    scales: {
      caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
      body: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
      subheading: { fontSize: 16, lineHeight: 24, fontWeight: '500' },
      heading: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
      display: { fontSize: 28, lineHeight: 36, fontWeight: '700' },
    },
  },
  controls: {
    minTouchTarget: 44,
    iconSizeSm: 16,
    iconSizeMd: 20,
    iconSizeLg: 24,
  },
};
