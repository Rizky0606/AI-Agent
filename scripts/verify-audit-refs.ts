import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const auditDocPath = path.resolve(workspaceRoot, 'docs', 'final-audit.md');

if (!fs.existsSync(auditDocPath)) {
  console.error(`[ERROR] File docs/final-audit.md tidak ditemukan di: ${auditDocPath}`);
  process.exit(1);
}

const content = fs.readFileSync(auditDocPath, 'utf-8');
const lines = content.split('\n');

// Pola deteksi path relatif di dalam docs/final-audit.md
// Mencakup referensi file di apps/, packages/, scripts/, docs/, .github/, docker-compose.yml, package.json, dll.
const pathRegex =
  /(?:apps|packages|scripts|docs|\.github)\/[a-zA-Z0-9_\-./]+|docker-compose\.ya?ml|package\.json|turbo\.json|AGENTS\.md/g;

interface PathRef {
  raw: string;
  cleanPath: string;
  lineNumber: number;
}

const foundRefs: PathRef[] = [];

lines.forEach((lineText, index) => {
  const lineNum = index + 1;
  const matches = lineText.match(pathRegex);
  if (!matches) return;

  for (const raw of matches) {
    // Bersihkan anchor (#L1-L10), trailing tanda baca, kurung tutup, backticks
    let clean = raw.split('#')[0]!;
    clean = clean.replace(/[`"')\]\s:,]+$/, '');

    // Abaikan jika berakhiran titik atau slash atau string kosong
    clean = clean.replace(/[.]+$/, '');
    if (!clean) continue;

    foundRefs.push({
      raw,
      cleanPath: clean,
      lineNumber: lineNum,
    });
  }
});

console.log(
  `[Verify Audit Refs] Memeriksa ${foundRefs.length} referensi path dari docs/final-audit.md...`,
);

const missing: Array<{ cleanPath: string; lineNumber: number; absolutePath: string }> = [];
const verified = new Set<string>();

for (const ref of foundRefs) {
  const resolved = path.resolve(workspaceRoot, ref.cleanPath);
  if (!fs.existsSync(resolved)) {
    missing.push({
      cleanPath: ref.cleanPath,
      lineNumber: ref.lineNumber,
      absolutePath: resolved,
    });
  } else {
    verified.add(ref.cleanPath);
  }
}

console.log(`[Verify Audit Refs] Berhasil memverifikasi ${verified.size} path unik yang valid.`);

if (missing.length > 0) {
  console.error(
    `\n[GAGAL] Ditemukan ${missing.length} referensi file yang TIDAK ADA pada filesystem:`,
  );
  for (const item of missing) {
    console.error(`  - Baris ${item.lineNumber}: "${item.cleanPath}"`);
  }
  process.exit(1);
}

console.log(
  `[SUKSES] Semua referensi path file dalam docs/final-audit.md 100% valid dan ada di filesystem.`,
);
process.exit(0);
