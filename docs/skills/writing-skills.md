# Panduan Menulis Skill Baru — Personal AI OS

Dokumen ini menjelaskan tata kelola, arsitektur, dan langkah-langkah implementasi penulisan skill baru di platform Personal AI OS.

---

## 1. Filosofi dan Prinsip Desain Skill
Setiap skill di Personal AI OS berfungsi sebagai unit kapabilitas cerdas yang:
1. **Self-Describing**: Didefinisikan melalui berkas `manifest.json` yang memuat schema input, schema output, kompatibilitas runtime, serta deklarasi izin eksplisit.
2. **Permission-Gated**: Seluruh tindakan berdampak wajib melewati `PermissionEngine` dan `SecuredCapabilityGuard`. Skill tidak boleh membypass otorisasi.
3. **Evidence-Based & Bounded**: Menghasilkan data terstruktur yang dapat dievaluasi, bukan klaim verbal tak berdasar.
4. **Isolasi Keamanan**: Luaran yang bersumber dari luar wajib ditandai tidak tepercaya (*untrusted*).

---

## 2. Struktur Berkas Skill
Setiap skill disimpan dalam foldernya masing-masing di bawah direktori `skills/<nama-skill>/`:

```
skills/<nama-skill>/
├── manifest.json   # Kontrak deklaratif (schema, permissions, compatibility)
└── index.ts        # Entry point ekspor manifest, handler, dan tipe
```

Untuk skill bawaan sistem (*built-in skills*), implementasi handler dan manifest juga ditempatkan di:
`packages/agent-core/src/skills/builtin/<nama-skill>.ts`.

---

## 3. Anatomi `manifest.json`
Manifest wajib lolos validasi `ManifestValidator`. Format JSON harus mengikuti antarmuka `SkillManifest`:

```json
{
  "name": "nama-skill-baru",
  "version": "1.0.0",
  "description": "Deskripsi singkat mengenai fungsi dan tujuan skill ini.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "options": { "type": "object" }
    },
    "required": ["query"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "success": { "type": "boolean" },
      "result": { "type": "string" }
    },
    "required": ["success", "result"]
  },
  "toolRequirements": [],
  "permissions": [
    {
      "action": "query:custom_skill_action",
      "resource": "workspace://resource",
      "scope": "workspace",
      "riskLevel": "LOW",
      "reason": "Alasan mengapa izin ini dibutuhkan dalam bahasa Indonesia."
    }
  ],
  "compatibility": {
    "agentCoreVersion": ">=0.2.0",
    "platforms": ["node", "linux", "windows"]
  },
  "metadata": {
    "category": "governance",
    "author": "personal-ai-os",
    "risk": "LOW"
  }
}
```

### Aturan Wajib Validasi Manifest:
- `name`: Wajib format kebab-case huruf kecil (contoh: `security-review`, bukan `SecurityReview` atau `security_review`).
- `version`: Wajib semver valid (contoh: `1.0.0`, bukan `v1`).
- `permissions`: Setiap entri wajib memiliki `riskLevel` yang valid (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) dan deskripsi `reason`. Dilarang meminta izin wildcard `*` atau `*:*`.
- `compatibility`: Menentukan batas versi minimal `agentCoreVersion` dan daftar `platforms`.

---

## 4. Implementasi Handler TypeScript
Handler adalah fungsi asinkron bertipe `SkillHandler<TInput, TOutput>`:

```typescript
import type { SkillHandler, SkillManifest } from '../types.ts';

export interface MySkillInput {
  query: string;
}

export interface MySkillOutput {
  success: boolean;
  result: string;
}

export const MY_SKILL_MANIFEST: SkillManifest = {
  // ... isi manifest ...
};

export const mySkillHandler: SkillHandler<MySkillInput, MySkillOutput> = async (
  input,
  context,
) => {
  // 1. Validasi input
  if (!input.query || input.query.trim().length === 0) {
    return {
      success: false,
      result: 'Query tidak boleh kosong.',
    };
  }

  // 2. Logika eksekusi aman
  // context menyediakan: userId, taskId, projectId, approvalId
  const sanitizedQuery = input.query.trim();

  return {
    success: true,
    result: `Hasil pemrosesan untuk: ${sanitizedQuery}`,
  };
};
```

---

## 5. Menulis Unit Test untuk Skill Baru
Setiap skill wajib memiliki pengujian komprehensif di `packages/agent-core/test/skills.test.ts` (atau file test spesifik):

1. **Uji Validasi Manifest**:
   ```typescript
   test('ManifestValidator: accepts my-skill manifest', () => {
     const validator = new ManifestValidator();
     const valid = validator.validate(MY_SKILL_MANIFEST);
     assert.equal(valid.name, 'my-skill');
   });
   ```

2. **Uji Perilaku Positif & Negatif**:
   - Pastikan input tidak valid ditolak.
   - Pastikan output memenuhi skema yang dijanjikan.
   - Uji batas keamanan dan error handling.

---

## 6. Mendaftarkan Skill ke Server API
1. Ekspor manifest dan handler dari `packages/agent-core/src/skills/index.ts`.
2. Daftarkan handler ke dalam `builtinHandlers` di `apps/api/src/routes/skills.ts`:
   ```typescript
   builtinHandlers.set('nama-skill-baru', mySkillHandler as never);
   ```
3. Sinkronkan direktori skill ke database melalui `POST /v1/skills/sync`.
