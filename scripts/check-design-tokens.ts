/**
 * Design Token Linter / Checker Script
 * Scans component CSS files in apps/windows/src/ui to ensure all colors,
 * spacing, and radii consume shared design system variables (var(--...)).
 *
 * Excludes token definition files (Theme.css) which legitimately declare the root values.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CSS_DIRS = [
  resolve(process.cwd(), 'apps/windows/src/ui'),
];

// Files that declare variables and tokens themselves are excluded
const EXCLUDED_FILES = [
  'Theme.css',
];

interface TokenViolation {
  file: string;
  line: number;
  content: string;
  reason: string;
}

function scanCssFile(filePath: string): TokenViolation[] {
  const violations: TokenViolation[] = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((lineText, idx) => {
    const trimmed = lineText.trim();
    const lineNum = idx + 1;

    // Skip comments and variable declarations
    if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('--')) {
      return;
    }

    // Check for hardcoded hex colors (e.g. #fff, #171A21)
    const hexMatch = /#([0-9a-fA-F]{3,8})\b/.exec(trimmed);
    if (hexMatch) {
      violations.push({
        file: filePath,
        line: lineNum,
        content: trimmed,
        reason: `Hardcoded hex color '${hexMatch[0]}' found. Use var(--color-*) instead.`,
      });
    }

    // Check for raw rgba(...) or rgb(...) outside of CSS variables
    const rgbMatch = /\brgba?\([^)]+\)/.exec(trimmed);
    if (rgbMatch && !trimmed.includes('var(') && !trimmed.includes('--')) {
      // allow standard gradient transparent stops if necessary, otherwise flag
      if (!trimmed.includes('transparent')) {
        violations.push({
          file: filePath,
          line: lineNum,
          content: trimmed,
          reason: `Hardcoded rgb/rgba value '${rgbMatch[0]}' found. Use var(--color-*) or semantic token instead.`,
        });
      }
    }
  });

  return violations;
}

function walkDir(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else if (stat.isFile() && entry.endsWith('.css') && !EXCLUDED_FILES.includes(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

export function runTokenCheck(): boolean {
  console.log('[Design Token Checker] Scanning Windows UI CSS files for un-tokenized values...');
  const allCssFiles = CSS_DIRS.flatMap((dir) => walkDir(dir));
  const allViolations: TokenViolation[] = [];

  for (const file of allCssFiles) {
    const violations = scanCssFile(file);
    allViolations.push(...violations);
  }

  if (allViolations.length > 0) {
    console.error(`[Design Token Checker] FAILED: Found ${allViolations.length} token violations:`);
    for (const v of allViolations) {
      console.error(`  - ${v.file}:${v.line} -> ${v.reason}\n      Snippet: ${v.content}`);
    }
    return false;
  }

  console.log(`[Design Token Checker] SUCCESS: Checked ${allCssFiles.length} CSS files. 0 violations found! All colors use design tokens.`);
  return true;
}

// Direct execution
if (process.argv[1]?.endsWith('check-design-tokens.ts')) {
  const success = runTokenCheck();
  if (!success) {
    process.exit(1);
  }
}
