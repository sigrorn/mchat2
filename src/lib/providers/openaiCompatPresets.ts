// ------------------------------------------------------------------
// Component: OpenAI-compatible preset registry
// Responsibility: Hard-coded list of built-in OpenAI-compatible
//                 presets (OpenRouter, OVHcloud, IONOS, Infomaniak)
//                 plus the URL-template substitution helper used by
//                 the resolver. Custom user-added presets live in
//                 openaiCompatStorage; this file only owns the
//                 fixed convenience-defaults (#140 → #169).
// Collaborators: openaiCompatTemplated (adapter), openaiCompatStorage
//                (custom entries), extraConfig (resolver).
// ------------------------------------------------------------------

export interface OpenAICompatPreset {
  // Stable id used as the keychain slot key and the persona-side
  // reference. Must not collide with native ProviderId values.
  id: string;
  // Human-readable label for the dialog combobox.
  displayName: string;
  // URL template for chat completions. Placeholders are `{NAME}`
  // tokens substituted by resolveTemplateUrl from a per-preset
  // templateVars map. The template is the FULL URL — `/chat/completions`
  // included — so different providers' path conventions
  // (`/v1`, `/openai/v1`, `/v1/openai`, `/v3/openai`, …) work
  // uniformly without further path-mangling at call time.
  urlTemplate: string;
  // Names of placeholders the user must fill (e.g. `["PRODUCT_ID"]`
  // for Infomaniak). Empty for presets with static URLs.
  templateVars: readonly string[];
  // Headers the user MAY supply on top of the standard auth +
  // content-type. The dialog renders one input per name. None of
  // these are required; a preset whose backend doesn't need extras
  // declares an empty array.
  optionalHeaders: readonly string[];
  // ISO 3166 alpha-2 hosting country (#141 phase 1) used for the
  // `[CH] OpenRouter`-style tag in the persona panel + dialog.
  hostingCountry: string;
  // Sign-up / console URL surfaced as a "Register" link when no
  // API key is configured (#140 dialog spec).
  registrationUrl: string;
  // Whether `stream_options.include_usage` should be sent. All four
  // built-in presets honor it; the flag exists for parity with
  // self-hosted custom entries (vanilla TGI / older Ollama don't).
  supportsUsageStream: boolean;
  // Whether the endpoint requires a Bearer key. Built-ins all do;
  // custom entries can opt out (Ollama-style).
  requiresKey: boolean;
}

export const BUILTIN_OPENAI_COMPAT_PRESETS: readonly OpenAICompatPreset[] = Object.freeze([
  {
    id: "openrouter",
    displayName: "OpenRouter",
    urlTemplate: "https://openrouter.ai/api/v1/chat/completions",
    templateVars: [],
    optionalHeaders: ["HTTP-Referer", "X-Title"],
    hostingCountry: "US",
    registrationUrl: "https://openrouter.ai/keys",
    supportsUsageStream: true,
    requiresKey: true,
  },
  {
    id: "ovhcloud",
    displayName: "OVHcloud AI Endpoints",
    urlTemplate: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    templateVars: [],
    optionalHeaders: [],
    hostingCountry: "FR",
    registrationUrl: "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/",
    supportsUsageStream: true,
    requiresKey: true,
  },
  {
    id: "ionos",
    displayName: "IONOS AI Model Hub",
    urlTemplate: "https://openai.inference.de-txl.ionos.com/v1/chat/completions",
    templateVars: [],
    optionalHeaders: [],
    hostingCountry: "DE",
    registrationUrl: "https://cloud.ionos.com/",
    supportsUsageStream: true,
    requiresKey: true,
  },
  {
    id: "infomaniak",
    displayName: "Infomaniak",
    urlTemplate: "https://api.infomaniak.com/1/ai/{PRODUCT_ID}/openai/v1/chat/completions",
    templateVars: ["PRODUCT_ID"],
    optionalHeaders: [],
    hostingCountry: "CH",
    registrationUrl: "https://manager.infomaniak.com/",
    supportsUsageStream: true,
    requiresKey: true,
  },
]);

const BUILTIN_BY_ID = new Map(BUILTIN_OPENAI_COMPAT_PRESETS.map((p) => [p.id, p] as const));

export function builtinPresetById(id: string): OpenAICompatPreset | null {
  return BUILTIN_BY_ID.get(id) ?? null;
}

export const BUILTIN_PRESET_IDS: readonly string[] = Object.freeze(
  BUILTIN_OPENAI_COMPAT_PRESETS.map((p) => p.id),
);

// Substitute `{NAME}` placeholders in a URL template. Values are
// percent-encoded so a slash inside a productId / projectId doesn't
// silently re-route the path. Missing variables are left as literal
// `{NAME}` so the upstream call surfaces a real error rather than
// silently producing a malformed URL — the alternative (throw or
// drop the path segment) hides the misconfiguration from the user.
export function resolveTemplateUrl(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([A-Z][A-Z0-9_]*)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : encodeURIComponent(value);
  });
}
