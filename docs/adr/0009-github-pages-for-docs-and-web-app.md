# 9. Publish the docs and the web app on one GitHub Pages site

**Date:** 2026-10-07
**Status:** Accepted (2026-10-07)

> **Implementation status (2026-10-11):** `.github/workflows/docs.yml` builds and checks the
> web app on every run, in its own `web-app` job, and adds it to the Pages artifact only when
> the repository variable `PUBLISH_WEB_APP` is `true`. Issue #70 tracks what must be true
> before the variable is set.

## Context

The project is GitHub-native and has no backend (ADR 0002). A static web app and the Starlight
documentation site (`website/`) both need hosting. GitHub Pages serves one site per
repository, at `https://<owner>.github.io/<repo>/` for project sites.

## Decision

- **One site.** The documentation site is served at the Pages root and the web app under
  `/app/`. `.github/workflows/docs.yml` builds both into a single Pages artifact and deploys
  it from `main` only.
- **Publishing the app is opt-in.** The app joins the Pages artifact only when the
  repository variable `PUBLISH_WEB_APP` is `true`. Until then it is still built and checked
  on every run, pull requests included, so a wrong base path or a lost Content Security
  Policy fails the change that causes it (the job that builds the Pages artifact fails when
  the app's job does, rather than being skipped, which would count as passed); setting the
  variable is the decision to publish, and unsetting it removes the app on the next deploy.
- **The app is built in a job of its own.** A separate `web-app` job installs, builds and
  checks it with a token that can only read the repository, and hands the build over as a
  workflow artifact. The job that builds and uploads the Pages artifact never runs the app's
  toolchain and restores no cache: code in any job can write the Actions cache, and a
  restored archive can overwrite files outside its own directory, the checker among them,
  before the checker runs. It downloads the build only when publishing and, just before
  copying it under `app/` (after `npm ci` and the docs build, so no later step can change
  what was checked), checks it again with the repository's own checker, which refuses any
  file but `index.html` and the scripts, stylesheets and fonts under `assets/`. No code
  from the app's job runs in that job or in the deploy. What remains: compromised
  build-time code can still hide a script in the app's own bundles, which pass those checks
  and are published with the app. The job that uploads the Pages artifact runs the docs
  site's own third-party dependencies (`npm ci` and the Astro build) before the check, so
  they could change the checker or the files it reads, as they could change every docs
  page they build. And, unverified: code in the app's job may be able to take that job's
  runtime token and, while the run lasts, delete the `github-pages` artifact after it is
  uploaded and upload another under the same name, which `deploy-pages` picks by name.
  Comparing the run's `github-pages` artifact ID with the one the build job uploaded,
  before deploying, would close that path; it is an idea tracked on issue #70, not
  implemented.
- **Base paths come from the build.** They come from `actions/configure-pages` at build time,
  read once in one job for both the docs and the app, never from a hardcoded repository name.
- **The CLI comes later.** It will be published to npm once v0.1 is usable. Until then it runs
  from a clone.

## Consequences

- **Free hosting** with no new infrastructure. Every deploy is tied to a reviewed commit on
  `main`.
- **Docs and app release together.** An app hotfix also ships whatever docs are on `main`.
  That is acceptable while both live in one repository.
- **Repository renames are free.** The app's base path is configurable, so renaming the
  repository or adding a custom domain changes no code.
- **The app shares its origin.** GitHub Pages serves every Pages site of an account from one
  origin, `https://<owner>.github.io`, so the app shares it with these docs and with every
  other Pages site of the same account, including sites this project does not control. A
  page on that origin can open the app in a window and read what it shows, a tax number and
  parsed broker rows included: the frame guard cannot help against a same-origin page, and
  `'self'` in the app's Content Security Policy covers the whole origin. On 2026-10-12 the
  maintainer decided, for the preview, to accept publishing on the shared `github.io`
  origin, with the frame guard (the app does not start inside a frame) and a note on the
  privacy page. An origin that holds nothing else, a custom domain for the Pages site or a
  dedicated GitHub account or organization for the app, is wanted later. The account's
  other Pages site that loaded a third-party script has been unpublished. The decision is
  recorded in issue #4.
- **A service worker stays possible.** The policy keeps `worker-src 'self' blob:`, so the
  app's own code could register a service worker, which can outlive taking the app down.
  Allowing only `blob:` was tried and stops the engine in Chromium, Firefox and WebKit: the
  bootstrap's static `import` of the engine is checked against `worker-src`. A service
  worker can only control pages under the folder its script is served from, and the build
  check allows scripts only in `app/assets/`, where no page of the app lives. A bootstrap
  that loads the engine with a dynamic `import()` works under `blob:` alone only while the
  engine bundle has no static imports, because Firefox checks static imports of a `blob:`
  worker against `worker-src`; and a failed load then reaches the page only at the
  client's timeout. So it would change ADR 0013's bootstrap and is not done here.

## On Acceptance

Accepted at project setup, before the issue tracker existed: `scripts/adr-accepted-issue-sweep.py`
had 0 open issues to re-read.
