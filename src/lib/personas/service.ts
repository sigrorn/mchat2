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

export class PersonaValidationError extends Error {
  constructor(
    public code:
      | "name_required"
      | "name_reserved"
      | "name_in_use"
      | "cycle"
      | "unknown_parent"
      | "not_found",
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
  runsAfter?: PersonaId | null;
  currentMessageIndex: number;
  sortOrder?: number;
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
    throw new PersonaValidationError("name_in_use", `'${name}' is already used in this conversation`);
  }
  if (input.runsAfter) {
    if (!existing.some((p) => p.id === input.runsAfter)) {
      throw new PersonaValidationError("unknown_parent", "runsAfter references a non-existent persona");
    }
  }
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
    runsAfter: input.runsAfter ?? null,
    deletedAt: null,
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
  runsAfter?: PersonaId | null;
  sortOrder?: number;
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

  if (input.runsAfter !== undefined && input.runsAfter !== null) {
    if (input.runsAfter === current.id) {
      throw new PersonaValidationError("cycle", "A persona cannot depend on itself");
    }
    const siblings = await repo.listPersonas(current.conversationId);
    if (!siblings.some((p) => p.id === input.runsAfter)) {
      throw new PersonaValidationError("unknown_parent", "Unknown parent persona");
    }
    if (wouldCreateCycle(current.id, input.runsAfter, siblings)) {
      throw new PersonaValidationError("cycle", "runsAfter would create a cycle");
    }
  }

  const next: Persona = {
    ...current,
    name,
    nameSlug: slug,
    provider: input.provider ?? current.provider,
    systemPromptOverride:
      input.systemPromptOverride !== undefined
        ? input.systemPromptOverride
        : current.systemPromptOverride,
    modelOverride: input.modelOverride !== undefined ? input.modelOverride : current.modelOverride,
    colorOverride: input.colorOverride !== undefined ? input.colorOverride : current.colorOverride,
    runsAfter: input.runsAfter !== undefined ? input.runsAfter : current.runsAfter,
    sortOrder: input.sortOrder ?? current.sortOrder,
  };
  await repo.updatePersona(next);
  return next;
}

// Walk parent chain; if we hit `candidate` starting from `proposedParent`,
// setting current's parent to proposedParent would close a loop.
function wouldCreateCycle(
  candidate: PersonaId,
  proposedParent: PersonaId,
  all: Persona[],
): boolean {
  const byId = new Map(all.map((p) => [p.id, p] as const));
  let cursor: PersonaId | null = proposedParent;
  const seen = new Set<PersonaId>();
  while (cursor !== null) {
    if (cursor === candidate) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.runsAfter ?? null;
  }
  return false;
}

export async function deletePersona(id: PersonaId): Promise<void> {
  const p = await repo.getPersona(id);
  if (!p) throw new PersonaValidationError("not_found", "Persona does not exist");
  await repo.tombstonePersona(id);
}
