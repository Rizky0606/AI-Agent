/**
 * WCAG 2.1 Contrast Ratio and Relative Luminance Calculator.
 * Used for automated verification of design token accessibility.
 */

export interface ContrastResult {
  ratio: number;
  meetsNormalAA: boolean; // >= 4.5:1
  meetsLargeAA: boolean; // >= 3.0:1
  meetsAAA: boolean; // >= 7.0:1
}

/** Parses a hex color string (#RGB, #RRGGBB) to [r, g, b] in range 0..255 */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16);
    const g = parseInt(clean[1]! + clean[1]!, 16);
    const b = parseInt(clean[2]! + clean[2]!, 16);
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return [r, g, b];
  }
  throw new Error(`Invalid hex color: ${hex}`);
}

/** Calculates sRGB relative luminance according to W3C specification */
export function getRelativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((val) => {
    const s = val / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Calculates contrast ratio between two hex colors: (L1 + 0.05) / (L2 + 0.05) */
export function getContrastRatio(foregroundHex: string, backgroundHex: string): number {
  const fgRgb = hexToRgb(foregroundHex);
  const bgRgb = hexToRgb(backgroundHex);

  const l1 = getRelativeLuminance(fgRgb);
  const l2 = getRelativeLuminance(bgRgb);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Number(ratio.toFixed(2));
}

export function evaluateContrast(foregroundHex: string, backgroundHex: string): ContrastResult {
  const ratio = getContrastRatio(foregroundHex, backgroundHex);
  return {
    ratio,
    meetsNormalAA: ratio >= 4.5,
    meetsLargeAA: ratio >= 3.0,
    meetsAAA: ratio >= 7.0,
  };
}
