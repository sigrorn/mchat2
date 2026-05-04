// Command-spec registry consistency (#237). One module owns metadata
// + parser per //command; parseCommand and formatHelp both read from
// it. Tests guard against drift — e.g. a future command that lands
// in COMMAND_SPECS but lacks usages, or two specs claiming the same
// verb.
import { describe, it, expect } from "vitest";
import { COMMAND_SPECS, findSpec } from "@/lib/commands/specs";

describe("COMMAND_SPECS consistency (#237)", () => {
  it("every spec has a non-empty verb", () => {
    for (const spec of COMMAND_SPECS) {
      expect(spec.verb).toMatch(/^[a-z]+$/);
    }
  });

  it("verbs are unique across specs", () => {
    const verbs = COMMAND_SPECS.map((s) => s.verb);
    expect(new Set(verbs).size).toBe(verbs.length);
  });

  it("aliases do not collide with any other spec's verb or aliases", () => {
    const verbs = new Set(COMMAND_SPECS.map((s) => s.verb));
    const seenAliases = new Set<string>();
    for (const spec of COMMAND_SPECS) {
      for (const alias of spec.aliases ?? []) {
        // An alias must not match another spec's verb.
        const otherVerb = [...verbs].find((v) => v === alias && v !== spec.verb);
        expect(otherVerb).toBeUndefined();
        // No two specs may share the same alias.
        expect(seenAliases.has(alias)).toBe(false);
        seenAliases.add(alias);
      }
    }
  });

  it("every spec has at least one usage entry and a parse function", () => {
    for (const spec of COMMAND_SPECS) {
      expect(spec.usages.length).toBeGreaterThanOrEqual(1);
      expect(typeof spec.parse).toBe("function");
      for (const u of spec.usages) {
        expect(u.form).toMatch(/^(\/\/|@|\+|_|\(|`)/);
        expect(u.description).not.toBe("");
      }
    }
  });

  it("findSpec returns the same spec for verb or any alias", () => {
    for (const spec of COMMAND_SPECS) {
      expect(findSpec(spec.verb)).toBe(spec);
      for (const alias of spec.aliases ?? []) {
        expect(findSpec(alias)).toBe(spec);
      }
    }
  });

  it("findSpec returns undefined for unknown verbs", () => {
    expect(findSpec("definitelynotaverb")).toBeUndefined();
  });

  it("covers every verb that today's parser recognizes", () => {
    // Hard-coded list lifted from parseCommand.ts. If a new verb gets
    // added to the parser but the registry misses it, this test fails
    // before any user can hit the gap.
    const required = [
      // #240: "limit" and "limitsize" removed from the registry.
      // Compaction (//compact / //autocompact) covers the use case
      // their visible-row hiding never could (limit only hid rows
      // from the LLM; the user kept seeing them until they scrolled
      // away). The verbs now fall through findSpec as unknown → noop.
      "pin",
      "pins",
      "unpin",
      "edit",
      "pop",
      "retry",
      "lines",
      "cols",
      "visibility",
      "select",
      "personas",
      "stats",
      "help",
      "version",
      "log",
      "vacuum",
      "compact",
      "autocompact",
      "fork",
    ];
    for (const verb of required) {
      expect(findSpec(verb), `missing spec for //${verb}`).toBeDefined();
    }
  });
});
