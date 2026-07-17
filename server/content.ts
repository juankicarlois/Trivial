/**
 * Carga del contenido del juego desde `content/`: definiciones de logros y
 * packs temáticos. Todo es JSON autorable: añadir un logro o un pack no
 * requiere tocar código.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AchievementDef, PackDef } from '../shared/progress.js';

const here = dirname(fileURLToPath(import.meta.url));
export const CONTENT_DIR = join(here, '..', 'content');

export interface GameContent {
  achievements: AchievementDef[];
  packs: PackDef[];
}

/**
 * @brief Carga logros y packs temáticos.
 * @param contentDir Directorio de contenido (por defecto, `content/`).
 * @return Logros y packs listos para usar.
 * @throws Error si un pack apunta a un logro que no existe (dato incoherente:
 *         sería imposible de desbloquear y nadie se daría cuenta).
 */
export function loadContent(contentDir: string = CONTENT_DIR): GameContent {
  const achievements = loadAchievements(join(contentDir, 'achievements.json'));
  const packs = loadPacks(join(contentDir, 'packs'));

  const knownAchievements = new Set(achievements.map((a) => a.id));
  for (const pack of packs) {
    if (!knownAchievements.has(pack.unlockedBy)) {
      throw new Error(
        `El pack "${pack.id}" se desbloquea con el logro "${pack.unlockedBy}", que no existe.`,
      );
    }
  }

  return { achievements, packs };
}

function loadAchievements(filePath: string): AchievementDef[] {
  const raw = readFileSync(filePath, 'utf-8');
  return (JSON.parse(raw) as { achievements: AchievementDef[] }).achievements;
}

function loadPacks(packsDir: string): PackDef[] {
  let files: string[];
  try {
    files = readdirSync(packsDir).filter((f) => f.endsWith('.json'));
  } catch {
    return []; // sin packs instalados: el juego funciona solo con el banco base
  }
  return files.map((file) => JSON.parse(readFileSync(join(packsDir, file), 'utf-8')) as PackDef);
}
