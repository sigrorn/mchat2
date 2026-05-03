// ------------------------------------------------------------------
// Component: Apertus → openai_compat auto-converter (#255)
// Responsibility: Convert legacy native-apertus personas into
//                 openai_compat (Infomaniak preset) on the fly. Two
//                 callers: ChatView (per-conversation, on activation)
//                 and snapshotImport (per-snapshot, before
//                 createPersona). The pure shape-transform is shared;
//                 each caller wraps it with its own side effects.
// Collaborators: persistence/personas (DB writes for the on-open path),
//                providers/openaiCompatStorage (global preset config),
//                tauri/sql (messages.provider rewrite),
//                tauri/keychain (api key mirror),
//                conversations/snapshotImport (import-time conversion).
// ------------------------------------------------------------------

import type { Persona, ProviderId } from "../types";
import { sql } from "../tauri/sql";
import { keychain } from "../tauri/keychain";
import * as personasRepo from "../persistence/personas";
import {
  apiKeySlotForPreset,
  loadOpenAICompatConfig,
  setBuiltinPresetConfig,
} from "../providers/openaiCompatStorage";

// Subset of Persona fields the conversion cares about. The pure
// transform doesn't need the full row (id, conversationId, etc.) —
// just what changes. Caller merges back into the full record.
export interface ConvertibleApertusInput {
  provider: ProviderId;
  apertusProductId: string | null;
  openaiCompatPreset: Persona["openaiCompatPreset"];
  modelOverride: string | null;
}

export interface ConversionResult {
  /** True when this input was apertus and got rewritten. False = no-op. */
  changed: boolean;
  /** Apertus-side product id surfaced for the caller to drop into the
   *  global Infomaniak templateVars. Null when changed=false or when
   *  the persona had no productId set (legacy state). */
  productId: string | null;
  /** Resulting persona shape. Identical to input when changed=false. */
  persona: ConvertibleApertusInput;
}

const INFOMANIAK_PRESET: { kind: "builtin"; id: string } = {
  kind: "builtin",
  id: "infomaniak",
};

const APERTUS_KEYCHAIN_KEY = "apertus_api_key";

// Pure transform — no I/O. Both call sites use this and then handle
// the side effects (DB updates / keychain copy / settings write)
// themselves with their own dependency surface.
export function convertApertusPersonaShape(
  input: ConvertibleApertusInput,
): ConversionResult {
  if (input.provider !== "apertus") {
    return { changed: false, productId: null, persona: input };
  }
  return {
    changed: true,
    productId: input.apertusProductId,
    persona: {
      provider: "openai_compat",
      apertusProductId: null,
      openaiCompatPreset: { ...INFOMANIAK_PRESET },
      modelOverride: input.modelOverride,
    },
  };
}

export interface ConversationConversionResult {
  /** Number of personas that converted. */
  converted: number;
  /** Product id surfaced for the global openai_compat config write
   *  (last-write-wins if multiple distinct values). Null when no
   *  productId was set on any converted persona. */
  productId: string | null;
  /** True when an apertus_api_key was mirrored to the Infomaniak slot. */
  apiKeyCopied: boolean;
  /** Notice text appended to the conversation (or null when no
   *  conversion happened). */
  notice: string | null;
}

// On-open conversion (Trigger 1 in #255). Iterates the conversation's
// personas, converts each apertus row in place via personasRepo, and
// rewrites messages.provider for that conversation so old assistant
// rows keep working when retried. Idempotent: re-running on a
// conversation with no apertus personas is a no-op.
export async function migrateApertusInConversation(
  conversationId: string,
): Promise<ConversationConversionResult> {
  const personas = await personasRepo.listPersonas(conversationId, true);
  let converted = 0;
  let productId: string | null = null;
  for (const p of personas) {
    const r = convertApertusPersonaShape({
      provider: p.provider,
      apertusProductId: p.apertusProductId,
      openaiCompatPreset: p.openaiCompatPreset,
      modelOverride: p.modelOverride,
    });
    if (!r.changed) continue;
    converted++;
    if (r.productId !== null) productId = r.productId;
    await personasRepo.updatePersona({
      ...p,
      provider: r.persona.provider,
      apertusProductId: r.persona.apertusProductId,
      openaiCompatPreset: r.persona.openaiCompatPreset,
    });
  }
  if (converted === 0) {
    return { converted: 0, productId: null, apiKeyCopied: false, notice: null };
  }

  // Rewrite messages.provider for the conversation so historical
  // assistant rows survive the apertus adapter's eventual removal
  // (Phase B). buildRetryTarget falls back to message.provider when
  // the persona is gone — without this rewrite, retrying a stale
  // apertus assistant row post-Phase-B would crash on a missing
  // adapter. Bubble headers re-render but cost snapshots stay intact
  // (#252's immutability rule).
  await sql.execute(
    "UPDATE messages SET provider = ? WHERE conversation_id = ? AND provider = ?",
    ["openai_compat", conversationId, "apertus"],
  );

  // Write the productId into the global Infomaniak preset's
  // templateVars iff it's currently empty (don't clobber a user's
  // existing manual configuration). last-write-wins is fine for a
  // single-productId user; a multi-productId user is rare and
  // surfaced in the notice so they can reconfigure.
  if (productId !== null) {
    const cfg = await loadOpenAICompatConfig();
    const existing = cfg.builtins["infomaniak"]?.templateVars["PRODUCT_ID"];
    if (!existing) {
      await setBuiltinPresetConfig("infomaniak", {
        templateVars: { PRODUCT_ID: productId },
        extraHeaders: cfg.builtins["infomaniak"]?.extraHeaders ?? {},
      });
    }
  }

  // Mirror apertus_api_key → openai_compat.infomaniak.apiKey iff the
  // target slot is empty. Leaves the original entry intact (Phase D
  // removes it later).
  let apiKeyCopied = false;
  try {
    const apertusKey = await keychain.get(APERTUS_KEYCHAIN_KEY);
    const targetSlot = apiKeySlotForPreset(INFOMANIAK_PRESET);
    if (apertusKey) {
      const existing = await keychain.get(targetSlot);
      if (!existing) {
        await keychain.set(targetSlot, apertusKey);
        apiKeyCopied = true;
      }
    }
  } catch {
    // Keychain failures are non-fatal — the user can re-enter the
    // key in Settings if the auto-mirror didn't take.
  }

  const apiKeyLine = apiKeyCopied
    ? " API key mirrored to the Infomaniak slot."
    : "";
  const productIdLine =
    productId !== null
      ? ` Product ID '${productId}' written to the Infomaniak preset.`
      : "";
  const notice =
    `Auto-migrated ${converted} persona${converted === 1 ? "" : "s"} from native Apertus ` +
    `to openai_compat (Infomaniak preset).${productIdLine}${apiKeyLine} ` +
    `Re-export the snapshot to lock in the new shape.`;

  return { converted, productId, apiKeyCopied, notice };
}
