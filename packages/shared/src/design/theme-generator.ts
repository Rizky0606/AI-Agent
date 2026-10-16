import { tokens, type ColorScheme } from './tokens.ts';

export interface AndroidTheme {
  scheme: ColorScheme;
  colors: {
    background: string;
    surface: string;
    surfaceElevated: string;
    surfaceBorder: string;

    primary: string;
    primaryHover: string;
    accent: string;
    accentSubtle: string;

    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    textInverse: string;

    // Risk levels
    riskLow: string;
    riskLowBg: string;
    riskMedium: string;
    riskMediumBg: string;
    riskHigh: string;
    riskHighBg: string;
    riskCritical: string;
    riskCriticalBg: string;

    // Status colors
    success: string;
    successBg: string;
    warning: string;
    danger: string;
    dangerBg: string;
    info: string;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  borderRadius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    full: number;
  };
  typography: {
    caption: { fontSize: number; lineHeight: number };
    body: { fontSize: number; lineHeight: number };
    bodyLarge: { fontSize: number; lineHeight: number };
    title: { fontSize: number; lineHeight: number; fontWeight: '700' };
  };
  controls: {
    minTouchTarget: number;
    iconSize: number;
  };
}

export function createAndroidTheme(scheme: ColorScheme = 'dark'): AndroidTheme {
  const c = tokens.colors[scheme];
  const { spacing, borderRadius, typography, controls } = tokens;

  return {
    scheme,
    colors: {
      background: c.background,
      surface: c.surface,
      surfaceElevated: c.surfaceElevated,
      surfaceBorder: c.borderSubtle,

      primary: c.accent,
      primaryHover: c.accentHover,
      accent: c.accent,
      accentSubtle: c.accentSubtle,

      textPrimary: c.textPrimary,
      textSecondary: c.textSecondary,
      textMuted: c.textMuted,
      textInverse: c.textInverse,

      riskLow: c.riskLow,
      riskLowBg: c.riskLowSubtle,
      riskMedium: c.riskMedium,
      riskMediumBg: c.riskMediumSubtle,
      riskHigh: c.riskHigh,
      riskHighBg: c.riskHighSubtle,
      riskCritical: c.riskCritical,
      riskCriticalBg: c.riskCriticalSubtle,

      success: c.success,
      successBg: c.successSubtle,
      warning: c.warning,
      danger: c.danger,
      dangerBg: c.dangerSubtle,
      info: c.info,
    },
    spacing: {
      xs: spacing[1],
      sm: spacing[2],
      md: spacing[3],
      lg: spacing[4],
      xl: spacing[6],
      xxl: spacing[8],
    },
    borderRadius: {
      sm: borderRadius.sm,
      md: borderRadius.md,
      lg: borderRadius.lg,
      xl: borderRadius.xl,
      full: borderRadius.full,
    },
    typography: {
      caption: {
        fontSize: typography.scales.caption.fontSize,
        lineHeight: typography.scales.caption.lineHeight,
      },
      body: {
        fontSize: typography.scales.body.fontSize,
        lineHeight: typography.scales.body.lineHeight,
      },
      bodyLarge: {
        fontSize: typography.scales.subheading.fontSize,
        lineHeight: typography.scales.subheading.lineHeight,
      },
      title: {
        fontSize: typography.scales.heading.fontSize,
        lineHeight: typography.scales.heading.lineHeight,
        fontWeight: '700' as const,
      },
    },
    controls: {
      minTouchTarget: controls.minTouchTarget,
      iconSize: controls.iconSizeLg,
    },
  };
}
