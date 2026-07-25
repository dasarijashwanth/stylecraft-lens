// lib/deck-generate.ts
// The single orchestration seam for the Project Deck feature — everything
// else (the pipeline's "deck" phase in Phase 3, and a future "Regenerate"
// button in Phase 4) calls this one function. Resolves the template
// (active, or an explicit override so "regenerate with this deck's
// original template" is possible) -> creates a pending project_decks row
// -> builds real data -> condenses over-length text -> renders -> uploads
// -> marks complete, or marks failed with the real error message (never
// silently swallowed).
import { getActiveDeckTemplate, getDeckTemplateById, getDeckTemplateFileBuffer, DeckTemplateRow } from "./db/deck-templates";
import { createPendingProjectDeck, markDeckGenerating, markDeckComplete, markDeckFailed, ProjectDeckRow } from "./db/project-decks";
import { getProject } from "./db/projects";
import { buildDeckDataForProject } from "./deck-data-mapper";
import { condenseDeckText } from "./deck-condense";
import { renderDeck } from "./deck-render";
import { DeckValue } from "./deck-types";

function slugify(text: string): string {
  return text
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "Deck";
}

function buildDeckFileName(productName: string | null | undefined): string {
  const date = new Date().toISOString().slice(0, 10);
  const label = productName && productName.trim() ? slugify(productName) : "Project";
  return `Deck_${label}_${date}.pptx`;
}

async function resolveTemplate(templateId?: string): Promise<DeckTemplateRow> {
  const template = templateId ? await getDeckTemplateById(templateId) : await getActiveDeckTemplate();
  if (!template) {
    throw new Error(
      templateId ? `Deck template ${templateId} not found` : "No active deck template configured — upload and activate one at /dashboard/admin/deck-templates"
    );
  }
  return template;
}

export async function generateProjectDeck(
  projectId: string,
  orgId: string,
  userId: string,
  opts?: { templateId?: string }
): Promise<ProjectDeckRow> {
  const runStart = Date.now();
  const template = await resolveTemplate(opts?.templateId);
  const deckRow = await createPendingProjectDeck({ projectId, templateId: template.id });

  try {
    await markDeckGenerating(deckRow.id);

    const [project, { values, gtmSnapshotAt }] = await Promise.all([
      getProject(projectId, orgId),
      buildDeckDataForProject(projectId, orgId, userId, template.placeholder_map),
    ]);

    const maxLengths: Record<string, number | undefined> = {};
    const textValues: Record<string, string> = {};
    for (const token of template.placeholder_map.tokens) {
      if (token.kind === "text" || token.kind === "date") {
        maxLengths[token.token] = token.max_length;
        textValues[token.token] = typeof values[token.token] === "string" ? (values[token.token] as string) : "";
      }
    }
    const condensedText = await condenseDeckText(textValues, maxLengths, runStart);
    const finalValues: Record<string, DeckValue> = { ...values, ...condensedText };

    const templateBuffer = await getDeckTemplateFileBuffer(template);
    const { buffer, slidesRemoved } = await renderDeck(templateBuffer, template.placeholder_map, finalValues);

    const fileName = buildDeckFileName(project?.productName);
    return await markDeckComplete(deckRow.id, {
      fileBuffer: buffer,
      fileName,
      placeholderValues: finalValues,
      slidesRemoved,
      gtmSnapshotAt,
    });
  } catch (err: any) {
    const message = err?.message || "Deck generation failed";
    await markDeckFailed(deckRow.id, message);
    throw err;
  }
}
