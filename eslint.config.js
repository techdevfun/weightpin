/**
 * ESLint flat config (dev only - nginx2shell has zero runtime deps).
 * TypeScript sources use typescript-eslint recommended rules;
 * plain JS (tests, scripts) uses the ESLint recommended
 * set with Node globals. dist/ and node_modules/ are never linted.
 */
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "demo/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["test/**/*.js", "scripts/**/*.js", "examples/**/*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["scripts/**/*.js", "eslint.config.js"],
    rules: { "no-console": "off" },
  },
);
