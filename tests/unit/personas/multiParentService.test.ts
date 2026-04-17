// #66 — Multi-parent runsAfter validation in persona service.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { createPersona, updatePersona } from "@/lib/personas/service";
import type { Persona } from "@/lib/types";

function makeMemSql() {
  const rows = new Map<string, Persona & { [k: string]: unknown }>();
  __setImpl({
    async execute(q, params) {
      const p = params ?? [];
      if (q.startsWith("INSERT INTO personas")) {
        const [
          id,
          conversation_id,
          provider,
          name,
          name_slug,
          system_prompt_override,
          model_override,
          color_override,
          created_at_message_index,
          sort_order,
          runs_after,
          deleted_at,
          apertus_product_id,
        ] = p as (string | number | null)[];
        rows.set(String(id), {
          id: String(id),
          conversationId: String(conversation_id),
          provider: String(provider) as Persona["provider"],
          name: String(name),
          nameSlug: String(name_slug),
          systemPromptOverride: system_prompt_override as string | null,
          modelOverride: model_override as string | null,
          colorOverride: color_override as string | null,
          createdAtMessageIndex: Number(created_at_message_index),
          sortOrder: Number(sort_order),
          runsAfter: parseRunsAfter(runs_after),
          deletedAt: deleted_at as number | null,
          apertusProductId: (apertus_product_id as string | null) ?? null,
        });
      } else if (q.startsWith("UPDATE personas SET\n       provider")) {
        const [
          provider,
          name,
          name_slug,
          system_prompt_override,
          model_override,
          color_override,
          sort_order,
          runs_after,
          deleted_at,
          apertus_product_id,
          id,
        ] = p as (string | number | null)[];
        const r = rows.get(String(id));
        if (r) {
          r.provider = String(provider) as Persona["provider"];
          r.name = String(name);
          r.nameSlug = String(name_slug);
          r.systemPromptOverride = system_prompt_override as string | null;
          r.modelOverride = model_override as string | null;
          r.colorOverride = color_override as string | null;
          r.sortOrder = Number(sort_order);
          r.runsAfter = parseRunsAfter(runs_after);
          r.deletedAt = deleted_at as number | null;
          r.apertusProductId = (apertus_product_id as string | null) ?? null;
        }
      } else if (q.startsWith("UPDATE personas SET deleted_at")) {
        const [at, id] = p as (string | number)[];
        const r = rows.get(String(id));
        if (r) r.deletedAt = Number(at);
      }
      return { rowsAffected: 1, lastInsertId: null };
    },
    async select<T>(q: string, params?: unknown[]): Promise<T[]> {
      const ps = params ?? [];
      if (q.includes("WHERE id = ?")) {
        const r = rows.get(String(ps[0]));
        if (!r) return [];
        return [toRow(r) as unknown as T];
      }
      if (q.includes("WHERE conversation_id = ?")) {
        const cid = String(ps[0]);
        const filtered = [...rows.values()].filter(
          (r) =>
            r.conversationId === cid &&
            (q.includes("deleted_at IS NULL") ? r.deletedAt === null : true),
        );
        return filtered.map(toRow) as unknown as T[];
      }
      return [];
    },
    async close() {},
  });
  return rows;
}

function parseRunsAfter(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  try {
    const parsed = JSON.parse(String(v));
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

function toRow(p: Persona) {
  return {
    id: p.id,
    conversation_id: p.conversationId,
    provider: p.provider,
    name: p.name,
    name_slug: p.nameSlug,
    system_prompt_override: p.systemPromptOverride,
    model_override: p.modelOverride,
    color_override: p.colorOverride,
    created_at_message_index: p.createdAtMessageIndex,
    sort_order: p.sortOrder,
    runs_after: JSON.stringify(p.runsAfter),
    deleted_at: p.deletedAt,
    apertus_product_id: p.apertusProductId,
  };
}

beforeEach(() => makeMemSql());
afterEach(() => __resetImpl());

describe("multi-parent runsAfter (#66)", () => {
  it("createPersona with multiple parents", async () => {
    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    const b = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "B",
      currentMessageIndex: 0,
    });
    const c = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "C",
      currentMessageIndex: 0,
      runsAfter: [a.id, b.id],
    });
    expect(c.runsAfter).toEqual([a.id, b.id]);
  });

  it("detects cycles in multi-parent graph", async () => {
    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    const b = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "B",
      currentMessageIndex: 0,
    });
    const c = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "C",
      currentMessageIndex: 0,
      runsAfter: [a.id, b.id],
    });
    // Trying to set A to depend on C would create: A → C → [A, B] cycle
    await expect(updatePersona({ id: a.id, runsAfter: [c.id] })).rejects.toMatchObject({
      code: "cycle",
    });
  });

  it("rejects self-parent in array", async () => {
    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    await expect(updatePersona({ id: a.id, runsAfter: [a.id] })).rejects.toMatchObject({
      code: "cycle",
    });
  });

  it("rejects unknown parent in array", async () => {
    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    await expect(
      updatePersona({ id: a.id, runsAfter: ["p_nonexistent"] }),
    ).rejects.toMatchObject({
      code: "unknown_parent",
    });
  });
});
