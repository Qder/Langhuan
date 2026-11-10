"use client";
import { useEffect } from "react";
import { useStore } from "./store";
import { startAutomaticBackup } from "./storage/automaticBackup";
import { isLearningPersistenceReady } from "./storage/learningPersistence";
export function useAutomaticBackup(): void {
  useEffect(
    () =>
      startAutomaticBackup(
        () => useStore.getState().exportPayload(),
        () => isLearningPersistenceReady() && useStore.getState().hydrated,
        (s) => useStore.getState().setStatus(s),
      ),
    [],
  );
}
