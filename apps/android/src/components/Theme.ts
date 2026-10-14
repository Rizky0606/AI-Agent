export const theme = {
  colors: {
    background: '#0a0d14',
    surface: '#121824',
    surfaceElevated: '#1b2234',
    surfaceBorder: '#2b354b',

    primary: '#6366f1',
    primaryHover: '#818cf8',
    accent: '#6366f1',

    textPrimary: '#f3f4f6',
    textSecondary: '#9ca3af',
    textMuted: '#a0a9b8',

    // Risk levels
    riskLow: '#22d3ee',
    riskLowBg: '#083344',
    riskMedium: '#fbbf24',
    riskMediumBg: '#451a03',
    riskHigh: '#f59e0b',
    riskHighBg: '#451a03',
    riskCritical: '#fb7185',
    riskCriticalBg: '#4c0519',

    // Status colors
    success: '#34d399',
    successBg: '#064e3b',
    warning: '#fbbf24',
    danger: '#fb7185',
    dangerBg: '#4c0519',
    info: '#22d3ee',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  borderRadius: {
    sm: 8,
    md: 12,
    lg: 16,
    full: 9999,
  },
  typography: {
    caption: { fontSize: 12, lineHeight: 16 },
    body: { fontSize: 14, lineHeight: 20 },
    bodyLarge: { fontSize: 16, lineHeight: 24 },
    title: { fontSize: 20, lineHeight: 28, fontWeight: '700' as const },
  },
  controls: {
    minTouchTarget: 48,
    iconSize: 24,
  },
};
