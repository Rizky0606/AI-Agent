import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokens,
  darkColors,
  lightColors,
  generateFullDesignSystemCss,
  generateThemeCssVariables,
  createAndroidTheme,
  evaluateContrast,
  getContrastRatio,
} from '../src/design/index.ts';

test('Design Tokens: exports consistent palettes for dark and light modes', () => {
  assert.equal(tokens.colors.dark.background, '#0F1115');
  assert.equal(tokens.colors.dark.surface, '#171A21');
  assert.equal(tokens.colors.dark.accent, '#2DD4BF');

  assert.equal(tokens.colors.light.background, '#FAFAF8');
  assert.equal(tokens.colors.light.surface, '#FFFFFF');
  assert.equal(tokens.colors.light.accent, '#0D9488');

  // Spacing scale is 4, 8, 12, 16, 24, 32
  assert.deepEqual(Object.values(tokens.spacing), [4, 8, 12, 16, 24, 32]);

  // Radii scale contains 8, 12, 16, 20, 9999
  assert.deepEqual(Object.values(tokens.borderRadius), [8, 12, 16, 20, 9999]);
});

test('CSS Generator: generates valid CSS variables with dark and light overrides', () => {
  const css = generateFullDesignSystemCss();

  assert.match(css, /--color-bg:\s*#0F1115/);
  assert.match(css, /--color-accent:\s*#2DD4BF/);
  assert.match(css, /--space-1:\s*4px/);
  assert.match(css, /--radius-md:\s*12px/);

  // Checks light mode override
  assert.match(css, /\[data-theme='light'\]/);
  assert.match(css, /--color-bg:\s*#FAFAF8/);
  assert.match(css, /--color-accent:\s*#0D9488/);

  // Checks system media query
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*light\)/);
});

test('Android Theme Generator: produces compliant Android themes for both schemes', () => {
  const darkTheme = createAndroidTheme('dark');
  assert.equal(darkTheme.scheme, 'dark');
  assert.equal(darkTheme.colors.background, '#0F1115');
  assert.equal(darkTheme.colors.primary, '#2DD4BF');
  assert.equal(darkTheme.spacing.xs, 4);
  assert.equal(darkTheme.borderRadius.md, 12);

  const lightTheme = createAndroidTheme('light');
  assert.equal(lightTheme.scheme, 'light');
  assert.equal(lightTheme.colors.background, '#FAFAF8');
  assert.equal(lightTheme.colors.primary, '#0D9488');
  assert.equal(lightTheme.colors.surface, '#FFFFFF');
});

test('Accessibility (WCAG AA): Text contrast meets or exceeds 4.5:1 ratio', () => {
  // 1. Dark Mode Contrast Checks
  // Primary text on Background (#ECEEF2 on #0F1115)
  const darkBgRatio = getContrastRatio(darkColors.textPrimary, darkColors.background);
  assert.ok(darkBgRatio >= 4.5, `Dark text on background ratio ${darkBgRatio} must be >= 4.5`);

  // Primary text on Surface (#ECEEF2 on #171A21)
  const darkSurfaceRatio = getContrastRatio(darkColors.textPrimary, darkColors.surface);
  assert.ok(darkSurfaceRatio >= 4.5, `Dark text on surface ratio ${darkSurfaceRatio} must be >= 4.5`);

  // Secondary text on Surface (#9AA1AE on #171A21)
  const darkSecRatio = getContrastRatio(darkColors.textSecondary, darkColors.surface);
  assert.ok(darkSecRatio >= 4.5, `Dark secondary text on surface ratio ${darkSecRatio} must be >= 4.5`);

  // Accent text on Accent background (#0F1115 on #2DD4BF)
  const darkAccentRatio = getContrastRatio(darkColors.accentText, darkColors.accent);
  assert.ok(darkAccentRatio >= 4.5, `Dark accent text ratio ${darkAccentRatio} must be >= 4.5`);

  // 2. Light Mode Contrast Checks
  // Primary text on Background (#15171C on #FAFAF8)
  const lightBgRatio = getContrastRatio(lightColors.textPrimary, lightColors.background);
  assert.ok(lightBgRatio >= 4.5, `Light text on background ratio ${lightBgRatio} must be >= 4.5`);

  // Primary text on Surface (#15171C on #FFFFFF)
  const lightSurfaceRatio = getContrastRatio(lightColors.textPrimary, lightColors.surface);
  assert.ok(lightSurfaceRatio >= 4.5, `Light text on surface ratio ${lightSurfaceRatio} must be >= 4.5`);

  // Secondary text on Surface (#5B6270 on #FFFFFF)
  const lightSecRatio = getContrastRatio(lightColors.textSecondary, lightColors.surface);
  assert.ok(lightSecRatio >= 4.5, `Light secondary text on surface ratio ${lightSecRatio} must be >= 4.5`);

  // Accent text on Accent background (#FFFFFF on #0D9488) -> large/bold or button text meets AA Large (>= 3.0:1)
  const lightAccentRatio = getContrastRatio(lightColors.accentText, lightColors.accent);
  assert.ok(lightAccentRatio >= 3.0, `Light accent button text ratio ${lightAccentRatio} must be >= 3.0`);

  // evaluateContrast helper
  const evalResult = evaluateContrast(darkColors.textPrimary, darkColors.background);
  assert.equal(evalResult.meetsNormalAA, true);
  assert.equal(evalResult.meetsAAA, true);

  // generateThemeCssVariables helper
  const rawCssVars = generateThemeCssVariables(darkColors);
  assert.ok(rawCssVars.includes('--color-bg: #0F1115;'));
});
