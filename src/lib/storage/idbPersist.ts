"use client";

import { createJSONStorage, type StateStorage } from "zustand/middleware";
import { get, set, del } from "idb-keyval";
import { MIGRATION_FLAG, STORE_KEY } from "./constants";

/**
 * IndexedDB-backed Zustand storage with one-shot localStorage → IDB migration.
 * After a successful migrate, the legacy localStorage key is removed so the
 * ~5MB quota no longer holds the full library.
 */
const memoryFallback = new Map<string, string>();

const idbStateStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === "undefined") {
      return memoryFallback.get(name) ?? null;
    }
    try {
      const fromIdb = await get<string>(name);
      if (fromIdb != null) return fromIdb;
    } catch {
      // fall through to localStorage
    }

    try {
      const legacy = localStorage.getItem(name);
      if (legacy == null) return null;
      try {
        await set(name, legacy);
        localStorage.setItem(MIGRATION_FLAG, String(Date.now()));
        localStorage.removeItem(name);
      } catch {
        // Keep serving legacy if IDB write fails.
      }
      return legacy;
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === "undefined") {
      memoryFallback.set(name, value);
      return;
    }
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    if (typeof window === "undefined") {
      memoryFallback.delete(name);
      return;
    }
    await del(name);
  },
};

export const idbJSONStorage = createJSONStorage(() => idbStateStorage);

export { STORE_KEY };

/** True when we previously migrated (or IDB already holds the store). */
export async function hasMigratedFromLocalStorage(): Promise<boolean> {
  if (typeof localStorage === "undefined") return true;
  if (localStorage.getItem(MIGRATION_FLAG)) return true;
  try {
    const v = await get<string>(STORE_KEY);
    return v != null;
  } catch {
    return false;
  }
}
