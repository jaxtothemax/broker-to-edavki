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
  Policy fails the change that causes it; setting the variable is the decision to publish,
  and unsetting it removes the app on the next deploy.
- **The app is built in a job of its own.** A separate `web-app` job installs, builds and
  checks it with a token that can only read the repository, and hands the build over as a
  workflow artifact. The job that builds and uploads the Pages artifact never runs the app's
  toolchain: it downloads that build only when publishing, checks it again with the
  repository's own checker and copies it under `app/`. Compromised build-time code can
  still change the app's own files, but not the docs pages, the steps that build and upload
  the Pages artifact, or the deploy.
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

## On Acceptance

Accepted at project setup, before the issue tracker existed: `scripts/adr-accepted-issue-sweep.py`
had 0 open issues to re-read.
