import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * GroundControl eslint config.
 * Next core-web-vitals/typescript bases are kept; a few rules that produce
 * mass pre-existing noise (any, set-state-in-effect, unused-vars) are relaxed
 * so `npm run lint` is a usable gate while the codebase is gradually typed.
 * New Loop intelligence code should still avoid freeform `any` in reviews.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**",
    "prisma/**",
    "node_modules/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // eslint-config-next registers the react-hooks and @next/next plugins
    // only for these extensions, so rules from those plugins must be scoped
    // to the same files. Otherwise files like server.cjs get a rule whose
    // plugin isn't loaded and ESLint fails while loading the config.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "warn",
    },
  },
]);

export default eslintConfig;