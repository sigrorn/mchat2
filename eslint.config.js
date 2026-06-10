import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react-refresh/only-export-components": "warn",
    },
    settings: { react: { version: "detect" } },
  },
  // #142: Layer boundary — pure services under src/lib must not pull
  // in Zustand stores, React hooks, or @tauri-apps/* directly. Stores
  // are UI-coupled state; hooks are React-only; raw @tauri-apps APIs
  // must go through the @/lib/tauri/* shim so capabilities/scope are
  // enforced in one place. Existing violators are exempted below until
  // the use-case layer extraction (#144) cleans them up.
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/stores/*", "*/stores/*", "../stores/*", "../../stores/*"],
              message:
                "src/lib/** must not import from @/stores/* — pass store actions in via callbacks. See #142/#144.",
            },
            {
              group: ["@/hooks/*", "*/hooks/*", "../hooks/*", "../../hooks/*"],
              message:
                "src/lib/** must not import from @/hooks/* — hooks are React-only. See #142/#144.",
            },
            {
              group: ["@tauri-apps/*"],
              message:
                "src/lib/** must not import @tauri-apps/* directly — go through @/lib/tauri/* shim. See #142.",
            },
          ],
        },
      ],
    },
  },
  // #142/#301: the @/lib/tauri/* shim is the ONE directory under
  // src/lib/** that is *supposed* to import @tauri-apps/* — it exists
  // precisely to centralize raw Tauri access so capabilities/scope are
  // enforced in one place (ARCHITECTURE.md "What runs where", ADR 001).
  // The src/lib/** block above forbids @tauri-apps/* for everyone; this
  // later block re-declares no-restricted-imports for the shim WITHOUT
  // the @tauri-apps/* group (flat config replaces the rule for matching
  // files), so the shim may import Tauri while the stores/hooks bans
  // still apply. Needed because #296 gave sql.ts a static
  // `import { invoke } from "@tauri-apps/api/core"` for the per-statement
  // hot path; the other shims use dynamic `await import("@tauri-apps/...")`,
  // which no-restricted-imports does not inspect. We do NOT try to lint
  // dynamic imports — the shim convention uses them deliberately, and the
  // boundary that matters (non-shim src/lib/** must not reach Tauri) is
  // still enforced statically above.
  {
    files: ["src/lib/tauri/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/stores/*", "*/stores/*", "../stores/*", "../../stores/*"],
              message:
                "src/lib/tauri/** must not import from @/stores/* — pass store actions in via callbacks. See #142/#144.",
            },
            {
              group: ["@/hooks/*", "*/hooks/*", "../hooks/*", "../../hooks/*"],
              message:
                "src/lib/tauri/** must not import from @/hooks/* — hooks are React-only. See #142/#144.",
            },
          ],
        },
      ],
    },
  },
  // (#155) The temporary override block that exempted dispatch.ts,
  // handlers/**, and the fileOps trio from no-restricted-imports has
  // been removed — all those files now take store actions via deps
  // (#148, #149, #151–#154) or function parameters (#155).
  // #287 / #292: lock the components → persistence boundary. After
  // phases 1+2 of #287 every component reaches stores instead of
  // repos directly; this rule prevents the regression.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/persistence/*",
                "*/lib/persistence/*",
                "../lib/persistence/*",
                "../../lib/persistence/*",
              ],
              message:
                "src/components/** must not import from @/lib/persistence/* — go through a store (conversationsStore, messagesStore, personasStore, flowsStore, uiStore). See #287.",
            },
          ],
        },
      ],
    },
  },
  prettier,
];
