import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
// The policy itself lives in its own module, which the Pages build check
// (scripts/pages-build/check-pages-build.mjs) also imports, so the check
// compares the tag in the output with exactly what this plugin injects.
import { CONTENT_SECURITY_POLICY } from "./content-security-policy.mjs";

/**
 * Build-only, because the dev server's React refresh runtime is an inline
 * script the policy would rightly block. GitHub Pages cannot send headers, so
 * the policy travels as a <meta> tag (which cannot carry frame-ancestors).
 * Injected first in <head> (head-prepend): a meta policy does not cover what
 * comes before it, and the Pages build check fails if anything does.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "taxreporter-content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: CONTENT_SECURITY_POLICY,
        },
        injectTo: "head-prepend",
      },
    ],
  };
}

export default defineConfig({
  // Public path the built app is served from. Local dev and `vite preview` use
  // "/". The GitHub Pages build (.github/workflows/docs.yml) sets
  // TAXREPORTER_WEB_BASE to the docs base followed by app/: /broker-to-edavki/app/
  // on the project site, /app/ on a custom domain. An empty value counts as unset.
  base: process.env.TAXREPORTER_WEB_BASE || "/",
  plugins: [react(), contentSecurityPolicy()],
  // The workspace packages export their TypeScript sources under the
  // "source" condition, so the app bundles the engine from src/ directly.
  resolve: { conditions: ["source", ...defaultClientConditions] },
  // The engine worker loads the rate snapshot with import() when first
  // needed (ADR 0013), which only a module worker can split out.
  worker: { format: "es" },
});
