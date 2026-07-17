/**
 * Almacén de perfiles: la memoria del jugador entre partidas (estadísticas y
 * logros conseguidos).
 *
 * Un perfil se identifica por `profileId`, que genera el cliente y guarda en su
 * navegador. No se usa el nombre como identidad a propósito: así el progreso
 * sobrevive a un cambio de nombre y dos personas que se llamen igual no
 * comparten logros.
 *
 * Se guarda en disco de forma diferida (varias acciones seguidas producen una
 * sola escritura).
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyStats, type ProfileStats } from '../shared/progress.js';

export interface Profile {
  id: string;
  /** Último nombre usado; solo para mostrar. */
  name: string;
  stats: ProfileStats;
  /** Ids de logros ya conseguidos. */
  achievements: string[];
  /**
   * Ids de preguntas que este jugador ya ha acertado. Se retiran de su
   * repertorio: las que ya sabe no aportan nada, y las falladas siguen saliendo
   * hasta que se las aprenda.
   */
  masteredQuestions: string[];
}

/** Retardo de guardado: agrupa ráfagas de cambios en una sola escritura. */
const SAVE_DELAY_MS = 500;

export class ProfileStore {
  private readonly profiles = new Map<string, Profile>();
  private readonly filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Si no se pudo apartar un fichero ilegible, no se escribe: se preserva. */
  private readOnly = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch {
      return; // primera ejecución: todavía no hay fichero
    }
    try {
      // Se quita la marca BOM: es habitual si alguien edita el fichero a mano
      // con herramientas de Windows, y JSON.parse la rechaza.
      const list = JSON.parse(raw.replace(/^﻿/, '')) as Profile[];
      for (const profile of list) this.profiles.set(profile.id, normalize(profile));
    } catch (error) {
      // El fichero no se entiende. Empezar de cero es aceptable para poder
      // jugar, pero sobrescribirlo destruiría el progreso de todos sin remedio,
      // así que primero se aparta una copia por si se puede recuperar a mano.
      this.quarantine(error);
    }
  }

  /** Aparta el fichero ilegible para no pisarlo al guardar. */
  private quarantine(error: unknown): void {
    const backupPath = `${this.filePath}.corrupto-${Date.now()}`;
    try {
      renameSync(this.filePath, backupPath);
      console.error(
        `Perfiles ilegibles en ${this.filePath}. Se ha guardado una copia en ${backupPath} ` +
          `y se empieza de cero. Error: ${String(error)}`,
      );
    } catch (renameError) {
      console.error(
        `Perfiles ilegibles en ${this.filePath} y además no se ha podido apartar una copia. ` +
          `No se guardará nada para no destruir el fichero. Errores: ${String(error)} / ${String(renameError)}`,
      );
      // Sin copia de seguridad, mejor no escribir que borrar el progreso.
      this.readOnly = true;
    }
  }

  /**
   * @brief Devuelve el perfil, creándolo si es la primera vez que se ve.
   * @param id Identificador estable del perfil.
   * @param name Nombre actual del jugador (se refresca en cada entrada).
   * @return El perfil, listo para leer y actualizar.
   */
  getOrCreate(id: string, name: string): Profile {
    let profile = this.profiles.get(id);
    if (!profile) {
      profile = { id, name, stats: emptyStats(), achievements: [], masteredQuestions: [] };
      this.profiles.set(id, profile);
    }
    if (profile.name !== name) profile.name = name;
    this.scheduleSave();
    return profile;
  }

  /** Pide guardar en disco; varias llamadas seguidas producen una escritura. */
  scheduleSave(): void {
    if (this.readOnly || this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, SAVE_DELAY_MS);
  }

  private saveNow(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const data = JSON.stringify([...this.profiles.values()], null, 2);
      writeFileSync(this.filePath, data, 'utf-8');
    } catch (error) {
      // Perder el progreso es malo, pero tumbar la partida en curso es peor.
      console.error('No se pudieron guardar los perfiles:', error);
    }
  }
}

/**
 * Rellena lo que falte en un perfil leído de disco. Al añadir estadísticas o
 * categorías nuevas, los perfiles antiguos no las tienen y quedarían como
 * `undefined`, rompiendo las comparaciones de los logros.
 */
function normalize(profile: Profile): Profile {
  const base = emptyStats();
  return {
    id: profile.id,
    name: profile.name ?? 'Jugador',
    achievements: profile.achievements ?? [],
    masteredQuestions: profile.masteredQuestions ?? [],
    stats: {
      ...base,
      ...profile.stats,
      correct: { ...base.correct, ...profile.stats?.correct },
    },
  };
}
