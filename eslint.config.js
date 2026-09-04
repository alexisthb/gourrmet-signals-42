import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Fichiers ÉCRITS PAR LA MACHINE, qui portent en première ligne « This file
  // is automatically generated. Do not edit it directly. » Lovable les
  // régénère à chaque déploiement : le 04/09, un correctif de lint appliqué
  // ici a été effacé par la régénération suivante, faisant rougir le cliquet
  // pour une dette que personne ne peut solder.
  //
  // Un cliquet mesure la discipline de CEUX QUI ÉCRIVENT le code. Compter des
  // lignes qu'on nous interdit d'éditer, c'est se condamner soit à relever le
  // seuil à chaque régénération — donc à vider le cliquet de son sens — soit à
  // rejouer indéfiniment une correction déjà perdue d'avance.
  { ignores: ["dist", "src/integrations/supabase/client.ts", "src/integrations/supabase/previewAuthStorage.ts"] },
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
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
