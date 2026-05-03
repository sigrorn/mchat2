// ------------------------------------------------------------------
// Component: Persona service
// Responsibility: CRUD with validation. Wraps personasRepo and
//                 enforces the invariants that would otherwise be
//                 spread across UI and orchestration layers.
// Collaborators: persistence/personas.ts, providers/derived.ts,
//                orchestration/dagExecutor.ts (edges).
// ------------------------------------------------------------------

import type { Persona, PersonaId, ProviderId } from "../types";
import { isReservedName } from "../providers/derived";
import { slugify } from "./slug";
import * as repo from "../persistence/personas";
import * as messagesRepo from "../persistence/messages";
import { pinMutationsForDeletion } from "./cleanupOnDeletion";

export class PersonaValidationError extends Error {
  constructor(
    public code:
      | "name_required"
      | "name_reserved"
      | "name_in_use"
      | "not_found"
      | "missing_apertus_product_id",
    message: string,
  ) {
    super(message);
    this.name = "PersonaValidationError";
  }
}

export interface CreatePersonaInput {
  conversationId: string;
  provider: ProviderId;
  name: string;
  systemPromptOverride?: string | null;
  modelOverride?: string | null;
  colorOverride?: string | null;
  visibilityDefaults?: Record<string, "y" | "n">;
  currentMessageIndex: number;
  sortOrder?: number;
  // #258 Phase C: apertusProductId removed.
  // #171: which openai-compat preset this persona resolves to.
  // Required when provider === "openai_compat", null otherwise.
  openaiCompatPreset?: Persona["openaiCompatPreset"];
  // #213: per-persona role lens. See Persona.roleLens.
  roleLens?: Persona["roleLens"];
  // #260: when true (scope="inherit" at the dialog), the persona is
  // exempted from addressedTo / audience filters for messages that
  // exist before its createdAtMessageIndex. Default false = scope="new".
  inheritedHistory?: boolean;
}

export async function createPersona(input: CreatePersonaInput): Promise<Persona> {
  const name = input.name.trim();
  if (!name) throw new PersonaValidationError("name_required", "Name is required");
  const slug = slugify(name);
  if (isReservedName(slug)) {
    throw new PersonaValidationError("name_reserved", `'${name}' is reserved`);
  }
  const existing = await repo.listPersonas(input.conversationId);
  if (existing.some((p) => p.nameSlug === slug)) {
    throw new PersonaValidationError(
      "name_in_use",
      `'${name}' is already used in this conversation`,
    );
  }
  // Apertus product id used to be per-persona (#15) but is now a global
  // setting (#25) since it's an Infomaniak account-level value. The
  // send-time gate lives in useSend / the Apertus adapter.
  const visDefaults = input.visibilityDefaults ?? {};
  return repo.createPersona({
    conversationId: input.conversationId,
    provider: input.provider,
    name,
    nameSlug: slug,
    systemPromptOverride: input.systemPromptOverride ?? null,
    modelOverride: input.modelOverride ?? null,
    colorOverride: input.colorOverride ?? null,
    createdAtMessageIndex: input.currentMessageIndex,
    sortOrder: input.sortOrder ?? existing.length,
    deletedAt: null,
    visibilityDefaults: visDefaults,
    openaiCompatPreset: input.openaiCompatPreset ?? null,
    roleLens: input.roleLens ?? {},
    inheritedHistory: input.inheritedHistory ?? false,
  });
}

export interface UpdatePersonaInput {
  id: PersonaId;
  name?: string;
  // Reassigning provider is allowed but affects subsequent sends only —
  // historical assistant rows keep their original provider tag so past
  // cost accounting and visibility filtering remain correct.
  provider?: ProviderId;
  systemPromptOverride?: string | null;
  modelOverride?: string | null;
  colorOverride?: string | null;
  visibilityDefaults?: Record<string, "y" | "n">;
  sortOrder?: number;
  // #258 Phase C: apertusProductId removed from updatePersona input too.
  openaiCompatPreset?: Persona["openaiCompatPreset"];
  roleLens?: Persona["roleLens"];
}

export async function updatePersona(input: UpdatePersonaInput): Promise<Persona> {
  const current = await repo.getPersona(input.id);
  if (!current || current.deletedAt !== null) {
    throw new PersonaValidationError("not_found", "Persona does not exist");
  }

  let name = current.name;
  let slug = current.nameSlug;
  if (input.name !== undefined && input.name.trim() !== current.name) {
    name = input.name.trim();
    if (!name) throw new PersonaValidationError("name_required", "Name is required");
    slug = slugify(name);
    if (isReservedName(slug)) {
      throw new PersonaValidationError("name_reserved", `'${name}' is reserved`);
    }
    const siblings = await repo.listPersonas(current.conversationId);
    if (siblings.some((p) => p.id !== current.id && p.nameSlug === slug)) {
      throw new PersonaValidationError("name_in_use", `'${name}' is already used`);
    }
  }

  // #241 Phase A removed runsAfter validation; Phase C dropped the
  // field from Persona entirely. updatePersona never touches an
  // ordering edge today. #258 Phase C similarly dropped
  // apertusProductId from Persona — the field used to be threaded
  // through here.

  const provider = input.provider ?? current.provider;

  const visDefaults =
    input.visibilityDefaults !== undefined
      ? input.visibilityDefaults
      : current.visibilityDefaults;

  const next: Persona = {
    ...current,
    name,
    nameSlug: slug,
    provider,
    systemPromptOverride:
      input.systemPromptOverride !== undefined
        ? input.systemPromptOverride
        : current.systemPromptOverride,
    modelOverride: input.modelOverride !== undefined ? input.modelOverride : current.modelOverride,
    colorOverride: input.colorOverride !== undefined ? input.colorOverride : current.colorOverride,
    visibilityDefaults: visDefaults,
    sortOrder: input.sortOrder ?? current.sortOrder,
    openaiCompatPreset:
      input.openaiCompatPreset !== undefined
        ? input.openaiCompatPreset
        : current.openaiCompatPreset,
    roleLens: input.roleLens !== undefined ? input.roleLens : current.roleLens,
  };
  await repo.updatePersona(next);

  // #94: if renamed, update slug keys in all siblings' defaults.
  if (slug !== current.nameSlug) {
    const siblings = await repo.listPersonas(current.conversationId);
    const others = siblings.filter((p) => p.id !== current.id);
    await renameSlugInSiblings(current.nameSlug, slug, others);
  }

  return next;
}

export async function deletePersona(id: PersonaId): Promise<void> {
  const p = await repo.getPersona(id);
  if (!p) throw new PersonaValidationError("not_found", "Persona does not exist");
  // #21: clean up dangling pins before tombstoning so //pins doesn't
  // surface unresolvable @id strings for personas that no longer exist.
  const messages = await messagesRepo.listMessages(p.conversationId);
  const mutations = pinMutationsForDeletion(messages, id);
  for (const mut of mutations) {
    await messagesRepo.applyMessageMutation(mut);
  }
  // #94: remove this persona's slug from all siblings' visibility defaults.
  const siblings = await repo.listPersonas(p.conversationId);
  const others = siblings.filter((s) => s.id !== id);
  await removeSlugFromSiblings(p.nameSlug, others);
  await repo.tombstonePersona(id);
}

// --- #94: cross-editing helpers -------------------------------------------

// Update sibling personas' visibilityDefaults to reflect "seen by" edits
// made while editing this persona. seenByEdits maps sibling slugs to what
// the sibling should have for editedSlug in its own `sees`.
export async function applySeenByEdits(
  editedSlug: string,
  seenByEdits: Record<string, "y" | "n">,
  siblings: readonly Persona[],
): Promise<void> {
  const bySlug = new Map(siblings.map((p) => [p.nameSlug, p] as const));
  for (const [siblingSlug, value] of Object.entries(seenByEdits)) {
    const sibling = bySlug.get(siblingSlug);
    if (!sibling) continue;
    if (sibling.visibilityDefaults[editedSlug] === value) continue;
    await repo.updatePersona({
      ...sibling,
      visibilityDefaults: { ...sibling.visibilityDefaults, [editedSlug]: value },
    });
  }
}

async function renameSlugInSiblings(
  oldSlug: string,
  newSlug: string,
  siblings: Persona[],
): Promise<void> {
  for (const sibling of siblings) {
    const value = sibling.visibilityDefaults[oldSlug];
    if (value === undefined) continue;
    const rest = { ...sibling.visibilityDefaults };
    delete rest[oldSlug];
    const updated: Persona = {
      ...sibling,
      visibilityDefaults: { ...rest, [newSlug]: value },
    };
    await repo.updatePersona(updated);
  }
}

async function removeSlugFromSiblings(
  slug: string,
  siblings: Persona[],
): Promise<void> {
  for (const sibling of siblings) {
    if (sibling.visibilityDefaults[slug] === undefined) continue;
    const rest = { ...sibling.visibilityDefaults };
    delete rest[slug];
    const updated: Persona = { ...sibling, visibilityDefaults: rest };
    await repo.updatePersona(updated);
  }
}

// #94 → #202: buildMatrixFromDefaults removed. The matrix is now read
// from persona_visibility, populated by rebuildVisibilityFromPersona-
// Defaults in personas/visibilityRebuild.ts. Both call paths that
// used the old helper (PersonaPanel side-effects and //visibility
// default) now delegate to that rebuild function.
