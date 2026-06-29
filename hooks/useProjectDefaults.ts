"use client";

import { useState, useEffect } from "react";
import { loadProjectDefaults, saveProjectDefaults } from "@/lib/project-defaults";
import type { ProjectDefaults } from "@/lib/project-defaults";

export function useProjectDefaults(projectId: string | null, userId: string) {
  const [defaults, setDefaults] = useState<Partial<ProjectDefaults>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setLoaded(true);
      return;
    }
    loadProjectDefaults(projectId, userId).then(d => {
      setDefaults(d);
      setLoaded(true);
    });
  }, [projectId, userId]);

  async function save(updates: Partial<ProjectDefaults>) {
    if (!projectId) return;
    setDefaults(prev => ({ ...prev, ...updates }));
    await saveProjectDefaults(projectId, userId, updates);
  }

  return { defaults, loaded, save };
}
