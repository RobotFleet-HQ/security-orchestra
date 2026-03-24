# Lessons Learned — Render Deployment Failures (2026-03-23)

Three commits introduced in one session broke both Render services. This documents
exactly what went wrong and how to avoid repeating it.

---

## Incident 1 — sqlite3 v6.0.1 upgrade (root cause of GLIBC_2.38 error)

**Commit:** `6895020` — *security: upgrade sqlite3 to v6.0.1 — fix 7 HIGH vulns*

**What broke:** Both services failed at container startup with:
```
Error: /lib/x86_64-linux-gnu/libc.so.6: version 'GLIBC_2.38' not found
```

**Why:** sqlite3 v6.0.1 ships a prebuilt Linux binary compiled against glibc 2.38.
Render's Docker base image (`node:20-slim` / Debian Bookworm) ships glibc 2.36.
The binary is downloaded by `node-pre-gyp` at `npm install` time, not from the
lock file — so regenerating the lock file on Linux would not have helped.

**How to fix when upgrading sqlite3:** Add a postinstall script to force a source
build on the target platform:
```json
"postinstall": "npm rebuild sqlite3 --build-from-source"
```
**BUT** this requires Python and `node-gyp` build tools, which must be present in
the Docker image. If using the slim Node image, install them first:
```dockerfile
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
```
Alternatively, pin to the last known-good version (`^5.1.7`) until the Render base
image is updated to a glibc version that satisfies v6.

**Rule:** Before upgrading any native addon (sqlite3, bcrypt, sharp, canvas, etc.),
check the prebuilt binary's glibc requirement against the Render Docker base image.
Run `npm install && node -e "require('sqlite3')"` inside the target Docker image
before committing the upgrade.

---

## Incident 2 — dotenv imported in code before it was in package.json

**Commits:** `710ad67` (import added) — dotenv was missing from `billing-api/package.json`

**What broke:** Render's `npm install && npm run build` (tsc) failed with:
```
error TS2307: Cannot find module 'dotenv'
```

**Why:** `src/index.ts` was updated to `import dotenv from "dotenv"` but
`billing-api/package.json` had no `dotenv` dependency. The orchestrator's
`package.json` was updated correctly in the same session, but billing-api's was
missed.

**Rule:** Any time you add an import for a new package, update `package.json` and
commit both files together. TypeScript will compile cleanly locally if the package
is already in `node_modules` (installed globally or from a prior `npm install`),
masking the missing dependency until Render's clean-install build catches it.

---

## Incident 3 — package-lock.json generated on Windows

**Context:** All package-lock.json regeneration in this session happened on Windows
(Node v24, Windows 10).

**Risk:** `package-lock.json` records platform metadata (`os`, `cpu`, `libc` fields
in npm 7+ lockfiles). For packages that use prebuilt binaries (sqlite3, canvas,
sharp), the lock file can bake in resolved binary URLs that are platform-specific.
Running `npm install` on Linux from a Windows-generated lock may still download the
correct Linux binary via `node-pre-gyp` — but the glibc version of that binary
depends entirely on which sqlite3 release is being installed, not the OS that
generated the lock file.

**Actual impact here:** The lock file was not the direct cause — the sqlite3 v6.0.1
prebuilt Linux binary always requires GLIBC_2.38 regardless of where the lock was
generated. However, committing a Windows-generated lock for a project that deploys
on Linux is a code-smell that should be avoided.

**Rule:** Regenerate `package-lock.json` on Linux (or inside the target Docker
image) before committing, or use `npm install --ignore-scripts` locally and rely on
the Docker build to run `postinstall` scripts in the correct environment.

---

## Recovery procedure used

1. Identified `fc49ff9` as the last commit before sqlite3 v6.0.1 was introduced.
2. `git reset --hard fc49ff9`
3. `git push --force origin main`
4. Render redeployed both services successfully from `fc49ff9`.

Commits dropped:
```
2a2a24d  fix: rebuild sqlite3 from source on install (postinstall — incomplete fix)
710ad67  fix: add dotenv support and DB directory auto-creation
de77f06  security: timing-safe admin key comparison via crypto.timingSafeEqual
903ee05  security: replace disposable email blocklist
9843d28  security: atomic credit deduction
757100e  security: replace in-memory rate limiting with SQLite
6895020  security: upgrade sqlite3 to v6.0.1  ← root cause
```

The security improvements from these commits (timing-safe comparison, atomic credit
deduction, SQLite rate limiting) are worth re-landing once the sqlite3 glibc issue
is resolved via a proper Docker base image upgrade or source build.

---

## Standing rules going forward

1. **Never commit a sqlite3 (or other native addon) version bump without first
   verifying the prebuilt binary runs in the target Docker environment.**
2. **Always add a new `import` and its `package.json` entry in the same commit.**
3. **After `npm install` on Windows, verify `npm run build` would pass on the
   Render environment before pushing** — or use a CI step.
4. **The root `.gitignore` now includes `node_modules/`** — service-level ignores
   existed but the repo root did not have this rule.
