import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ManifestValidator } from './manifest-validator.ts';
import type { SkillManifest } from './types.ts';

export interface LoadedSkill {
  name: string;
  manifest: SkillManifest;
  directoryPath: string;
}

export class SkillLoader {
  private readonly validator: ManifestValidator;

  constructor(validator?: ManifestValidator) {
    this.validator = validator ?? new ManifestValidator();
  }

  async loadFromDirectory(skillsRootDir: string): Promise<LoadedSkill[]> {
    const loaded: LoadedSkill[] = [];

    let entries: string[] = [];
    try {
      entries = await fs.readdir(skillsRootDir);
    } catch {
      // Directory doesn't exist or is empty
      return [];
    }

    for (const entry of entries) {
      const fullDir = join(skillsRootDir, entry);
      try {
        const stat = await fs.stat(fullDir);
        if (!stat.isDirectory()) continue;

        const manifestPath = join(fullDir, 'manifest.json');
        const content = await fs.readFile(manifestPath, 'utf8');
        const parsed = JSON.parse(content);

        const validated = this.validator.validate(parsed);
        loaded.push({
          name: validated.name,
          manifest: validated,
          directoryPath: fullDir,
        });
      } catch (err) {
        // If directory has no manifest or manifest is invalid, rethrow or log
        if (
          err instanceof Error &&
          (err.name === 'SkillValidationError' ||
            err.name === 'SkillIncompatibleError' ||
            err.name === 'SkillPermissionViolationError')
        ) {
          throw err;
        }
        // If manifest doesn't exist, ignore non-skill subdirectories
      }
    }

    return loaded;
  }
}
