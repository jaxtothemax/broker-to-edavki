// The built app's Content Security Policy, in one place for its two readers:
// vite.config.ts injects it into index.html as a <meta> tag, and
// scripts/pages-build/check-pages-build.mjs fails the Pages build when the tag in
// the output carries anything else. Plain JavaScript with JSDoc types, so Node
// can import it without a build step; tsconfig.node.json and
// scripts/pages-build/tsconfig.json type check it (allowJs, checkJs).

/**
 * Scripts, fonts and requests from the app's own origin only, so even injected
 * markup cannot load code or send data elsewhere (CLAUDE.md, "Secure code").
 * The opt-in LLM check will add exactly its provider's origin to connect-src
 * when it lands (ADR 0008).
 * @type {string}
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // No 'unsafe-inline': React applies the style prop through the CSSOM, which
  // a policy does not restrict, and no markup carries a style attribute.
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  // blob: for the engine worker's bootstrap, which makes the worker inherit
  // this policy (ADR 0013 §3): a worker loaded from its own URL would get
  // its policy from response headers, and GitHub Pages sends none. 'self'
  // too: the bootstrap's static import of the engine is fetched as a worker
  // script, so blob: alone stops the engine in Chromium, Firefox and WebKit
  // (ADR 0009 says what that leaves open).
  "worker-src 'self' blob:",
  // The app shows no frames. Without this, default-src 'self' would let it
  // frame any page on its origin, which it shares with every Pages site of
  // the same account (ADR 0009).
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
