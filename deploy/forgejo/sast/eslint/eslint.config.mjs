// Segunda opinion para JS/TS: eslint-plugin-security + eslint-plugin-no-unsanitized (solo reglas de seguridad).
import tsParser from "@typescript-eslint/parser";
import security from "eslint-plugin-security";
import noUnsanitized from "eslint-plugin-no-unsanitized";

export default [
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/build/**", "**/*.test.*"] },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { security, "no-unsanitized": noUnsanitized },
    rules: {
      ...security.configs.recommended.rules,
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
    },
  },
];
