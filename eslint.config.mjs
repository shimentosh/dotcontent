import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // The isolated build `npm run build:check` writes, so a production build
    // taken while the dev server is up does not add five thousand lint
    // problems from generated code.
    ".next-check/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored copy of the source design canvas — reference only, not built.
    "design/**",
    // The NestJS API's install and compiled output. api/src is linted; the
    // CommonJS tsc writes into dist is not ours to style.
    "api/node_modules/**",
    "api/dist/**",
    // Rust build output. Tauri generates a JS shim in here for the webview,
    // and linting a file the toolchain writes is three warnings about code
    // nobody can edit.
    "src-tauri/target/**",
  ]),
]);

export default eslintConfig;
