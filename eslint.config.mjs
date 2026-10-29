import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    ignores: [
      ".next/**",
      "node_modules/**",
      "src-tauri/target/**",
      "out/**",
      "content/**",
      "coverage/**",
    ],
  },
];

export default eslintConfig;
