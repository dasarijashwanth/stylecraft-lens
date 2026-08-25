// lib/deck-generate.ts
// The Project Deck feature (tab, automatic pipeline phase, admin template
// management) has been permanently removed per explicit product decision —
// it must never spend OpenAI credits again. This function is the shared
// orchestration seam every trigger path called through (the pipeline's
// "deck" phase in project-generation-engine.ts, and the manual regenerate
// route), so a single throw here is a stronger guarantee than relying on
// the deck_generation_enabled feature flag alone, which only ever gated
// the automatic pipeline phase, not manual generation. Kept as a stub
// (rather than deleted) so those two call sites don't need touching.
import { ProjectDeckRow } from "./db/project-decks";

export async function generateProjectDeck(
  _projectId: string,
  _orgId: string,
  _userId: string,
  _opts?: { templateId?: string }
): Promise<ProjectDeckRow> {
  throw new Error("Project Deck generation has been permanently disabled.");
}
