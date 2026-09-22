import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".output/**",
      ".vinxi/**",
      "node_modules/**",
      "src/routeTree.gen.ts",
      "*.cjs",
      "*.mjs",
      "*.js",
      /*
        `scripts/**` is deliberately NOT ignored any more. These run against
        production from a workflow, and two bugs reached a `--apply` dispatch
        that a parser would have refused: a const called before its definition,
        and a call to a function that was never defined at all. Both parse
        cleanly, so `node --check` passed and only the run failed.
      */
      "scripts/**/*.ts",
    ],
  },
  {
    extends: [js.configs.recommended],
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      /*
        Correctness only. These are operational scripts, not shipped source, and
        reformatting several hundred lines of them would bury the two rules that
        are here for a reason.
      */
      "no-undef": "error",
      /*
        Left to `scripts/script-hygiene.test.mjs`, which checks the module level
        specifically. ESLint flags a const referenced inside a function defined
        above it, which is fine as long as the call happens later — and several
        of these scripts do exactly that, correctly.
      */
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      /* A `\x00` test is how you find a NUL byte in imported legacy text. */
      "no-control-regex": "off",
    },
  },
  {
    /*
      Runs inside `page.evaluate`, where the browser globals are the point.

      Every script here drives a real Chrome and serialises a callback across
      to it. `document` and `window` inside such a callback are not undefined
      identifiers; they are the only things it can see. The list is explicit
      rather than a `scripts/**` blanket, so a script that reaches for a
      browser global while running in Node is still an error.
    */
    files: [
      "scripts/banana-live-check.mjs",
      "scripts/check-horizontal-overflow.mjs",
      "scripts/search-live-check.mjs",
      "scripts/tier-reprice-verify.mjs",
      "scripts/ui-restoration-visual.mjs",
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  eslintPluginPrettier,
  {
    /*
      Turning formatting off has to come after the prettier preset, or the
      preset switches it back on. It did, and the result was four hundred
      formatting errors burying the two correctness rules above — the ones that
      exist because a TDZ crash and an undefined call both reached a `--apply`
      dispatch against production.
    */
    files: ["scripts/**/*.mjs"],
    rules: { "prettier/prettier": "off" },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "prettier/prettier": "off",
    },
  },
);
