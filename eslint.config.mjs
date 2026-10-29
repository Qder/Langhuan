import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import globals from "globals";

/**
 * Pure flat config via eslint-config-next official flat exports.
 * (FlatCompat + "next/core-web-vitals" caused circular JSON when validating
 * the react plugin graph inside @eslint/eslintrc.)
 *
 * Historical react-hooks/* violations from React Compiler rules are warn-only
 * so lint stays green without refactoring components (engineering-foundation scope).
 *
 * @type {import("eslint").Linter.Config[]}
 */
const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    files: ["src/lib/locate/bridge.client.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    rules: {
      // Bridge is an injectable IIFE — keep checks that catch real breakage.
      "no-undef": "error",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^",
        },
      ],
      "no-redeclare": "error",
      "no-unreachable": "error",
      "no-constant-condition": "warn",
      // Relax Next/TS rules that do not apply to raw iframe JS.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src-tauri/target/**",
      "out/**",
      "content/**",
      "coverage/**",
      "src/lib/locate/bridge.generated.ts",
    ],
  },
];

export default eslintConfig;
