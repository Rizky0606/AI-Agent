import { tokens, type ThemeColors } from './tokens.ts';

/**
 * Generates CSS variable declarations for a specific theme colorset.
 */
export function generateThemeCssVariables(colors: ThemeColors): string {
  return `
  --color-bg: ${colors.background};
  --color-surface: ${colors.surface};
  --color-surface-raised: ${colors.surfaceElevated};
  --color-surface-overlay: ${colors.surfaceOverlay};

  --color-border: ${colors.border};
  --color-border-subtle: ${colors.borderSubtle};
  --color-border-focus: ${colors.borderFocus};

  --color-text: ${colors.textPrimary};
  --color-text-secondary: ${colors.textSecondary};
  --color-text-muted: ${colors.textMuted};
  --color-text-inverse: ${colors.textInverse};

  --color-accent: ${colors.accent};
  --color-accent-hover: ${colors.accentHover};
  --color-accent-subtle: ${colors.accentSubtle};
  --color-accent-text: ${colors.accentText};

  --color-success: ${colors.success};
  --color-success-subtle: ${colors.successSubtle};
  --color-warning: ${colors.warning};
  --color-warning-subtle: ${colors.warningSubtle};
  --color-danger: ${colors.danger};
  --color-danger-subtle: ${colors.dangerSubtle};
  --color-info: ${colors.info};
  --color-info-subtle: ${colors.infoSubtle};

  --color-risk-low: ${colors.riskLow};
  --color-risk-low-subtle: ${colors.riskLowSubtle};
  --color-risk-medium: ${colors.riskMedium};
  --color-risk-medium-subtle: ${colors.riskMediumSubtle};
  --color-risk-high: ${colors.riskHigh};
  --color-risk-high-subtle: ${colors.riskHighSubtle};
  --color-risk-critical: ${colors.riskCritical};
  --color-risk-critical-subtle: ${colors.riskCriticalSubtle};

  /* Compatibility aliases for legacy styles */
  --bg-primary: ${colors.background};
  --bg-secondary: ${colors.surface};
  --bg-tertiary: ${colors.surfaceElevated};
  --bg-card: ${colors.surfaceOverlay};
  --border-color: ${colors.border};
  --border-focus: ${colors.borderFocus};
  --text-main: ${colors.textPrimary};
  --text-muted: ${colors.textSecondary};
  --text-sub: ${colors.textMuted};
  --accent-primary: ${colors.accent};
  --accent-cyan: ${colors.accent};
  --accent-emerald: ${colors.success};
  --accent-amber: ${colors.warning};
  --accent-rose: ${colors.danger};
  --focus-ring: 0 0 0 3px ${colors.accentSubtle};
`.trim();
}

/**
 * Generates static layout tokens (spacing, radii, typography, dimensions).
 */
export function generateStaticCssVariables(): string {
  const { spacing, borderRadius, typography, controls } = tokens;
  return `
  /* Spacing Scale (4, 8, 12, 16, 24, 32px) */
  --space-1: ${spacing[1]}px;
  --space-2: ${spacing[2]}px;
  --space-3: ${spacing[3]}px;
  --space-4: ${spacing[4]}px;
  --space-6: ${spacing[6]}px;
  --space-8: ${spacing[8]}px;

  /* Border Radii */
  --radius-sm: ${borderRadius.sm}px;
  --radius-md: ${borderRadius.md}px;
  --radius-lg: ${borderRadius.lg}px;
  --radius-xl: ${borderRadius.xl}px;
  --radius-full: ${borderRadius.full}px;

  /* Typography */
  --font-sans: ${typography.fontSans};
  --font-mono: ${typography.fontMono};

  --text-caption-size: ${typography.scales.caption.fontSize}px;
  --text-caption-lh: ${typography.scales.caption.lineHeight}px;
  --text-body-size: ${typography.scales.body.fontSize}px;
  --text-body-lh: ${typography.scales.body.lineHeight}px;
  --text-subheading-size: ${typography.scales.subheading.fontSize}px;
  --text-subheading-lh: ${typography.scales.subheading.lineHeight}px;
  --text-heading-size: ${typography.scales.heading.fontSize}px;
  --text-heading-lh: ${typography.scales.heading.lineHeight}px;
  --text-display-size: ${typography.scales.display.fontSize}px;
  --text-display-lh: ${typography.scales.display.lineHeight}px;

  /* Controls */
  --control-min-target: ${controls.minTouchTarget}px;
  --control-height: 38px;
  --control-height-sm: 30px;
  --icon-sm: ${controls.iconSizeSm}px;
  --icon-md: ${controls.iconSizeMd}px;
  --icon-lg: ${controls.iconSizeLg}px;
`.trim();
}

/**
 * Generates full CSS stylesheet with light and dark themes and system media query.
 */
export function generateFullDesignSystemCss(): string {
  return `
/* Personal AI OS Shared Design System — Auto-generated from @personal-ai-os/shared/design */

:root {
  ${generateStaticCssVariables()}
  ${generateThemeCssVariables(tokens.colors.dark)}
}

/* Light Mode Overrides */
:root[data-theme='light'],
body[data-theme='light'],
.theme-light {
  ${generateThemeCssVariables(tokens.colors.light)}
}

/* Dark Mode Overrides */
:root[data-theme='dark'],
body[data-theme='dark'],
.theme-dark {
  ${generateThemeCssVariables(tokens.colors.dark)}
}

/* System Theme Preference Media Query (default dark, adapts to light if system is light) */
@media (prefers-color-scheme: light) {
  :root:not([data-theme='dark']),
  body:not([data-theme='dark']),
  .theme-system {
    ${generateThemeCssVariables(tokens.colors.light)}
  }
}
`.trim();
}
