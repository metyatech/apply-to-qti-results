# PR #1 Review Fixes Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Fix the published entry point and dependency graph so consumers can import the package reliably and installs are consistent.

**Architecture:** Add a library entry module (`src/index.ts`) that re-exports the intended public API and ensure `package.json` points to the built `dist/index.js` (and types). Remove duplicate runtime dependencies from `devDependencies` and regenerate `package-lock.json`.

**Tech Stack:** Node.js, TypeScript, ESM (`"type": "module"`), npm.

### Task 1: Regenerate AGENTS.md and prep worktree

**Files:**

- Modify: `.gitignore`
- Modify: `AGENTS.md`

**Steps:**

1. Ensure `.worktrees/` is ignored in `.gitignore`.
2. Ensure `AGENTS.md` is regenerated via `compose-agentsmd`.
3. Commit these housekeeping changes.

### Task 2: Fix package entry point

**Files:**

- Create: `src/index.ts`
- Modify: `package.json`

**Steps:**

1. Add `src/index.ts` that re-exports the public API (keep it minimal and stable).
2. Ensure build output includes `dist/index.js` and `dist/index.d.ts`.
3. Update `package.json` (`main` and/or `exports`) so consumers resolve `dist/index.js` correctly.

### Task 3: Remove duplicate dependency and regenerate lockfile

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

**Steps:**

1. Remove `fast-xml-parser` from `devDependencies` (keep it only in `dependencies`).
2. Regenerate `package-lock.json` using npm.

### Task 4: Verification

**Steps:**

1. Run: `npm run lint`
2. Run: `npm run typecheck`
3. Run: `npm run build`
4. If a verify script exists, run it.

### Task 5: Ship

**Steps:**

1. Commit functional changes referencing `#1`.
2. Push the branch to update PR #1.
