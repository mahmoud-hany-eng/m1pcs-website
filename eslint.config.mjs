import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // creative/ holds standalone side projects (e.g. the Remotion showreel)
    // with their own package.json and tooling — not part of the site.
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "creative/**"],
  },
];

export default eslintConfig;
