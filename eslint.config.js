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
  // Exempt existing violators from the lib→stores ban. The store
  // coupling here is the work scoped by #144. New files must NOT be
  // added to this list — pass store actions in via callbacks instead.
  {
    files: [
      "src/lib/commands/dispatch.ts",
      "src/lib/commands/handlers/**/*.{ts,tsx}",
      "src/lib/conversations/exportToFile.ts",
      "src/lib/conversations/snapshotFileOps.ts",
      "src/lib/personas/fileOps.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  prettier,
];
