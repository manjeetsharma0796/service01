#!/usr/bin/env bun
/**
 * Patch @solana/mpp's verifier so it walks `tx.meta.innerInstructions` in
 * addition to the outer `tx.transaction.message.instructions`.
 *
 * Why: vendored @solana/mpp (<= 0.5.x) only inspects outer instructions when
 * looking for the merchant-required TransferChecked. That breaks any wallet
 * whose USDC is held in a program-derived account and moved via CPI from a
 * program — Squads, Phoenix, Drift, **klink**. The on-chain bytes contain a
 * perfectly valid SPL TransferChecked; the verifier just never looks at it
 * because it's an inner CPI rather than an outer instruction.
 *
 * Idempotent: leaves a sentinel string after patching so re-runs are no-ops.
 * Runs in postinstall so a fresh `bun install` always re-applies after
 * dependency hydration.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(import.meta.dir, "..", "node_modules/@solana/mpp/dist/server/Charge.js");

if (!existsSync(target)) {
  // @solana/mpp not installed yet (likely a `bun add --no-save` style call).
  // Don't fail — the next real install will trigger postinstall again.
  console.log("[patch-mpp] target not found, skipping:", target);
  process.exit(0);
}

const SENTINEL = "// @solana/mpp inner-ixs patch v1";
let src = readFileSync(target, "utf8");

if (src.includes(SENTINEL)) {
  console.log("[patch-mpp] already patched, no-op.");
  process.exit(0);
}

const OLD = `    const instructions = tx.transaction.message.instructions;
    await verifyInstructions(instructions, challenge, recipient);`;

// Flatten outer + inner ixs so program-mediated TransferChecked is visible.
const NEW = `    // ${SENTINEL}
    const innerIxs = (tx.meta?.innerInstructions ?? []).flatMap(g => g.instructions);
    const instructions = [...tx.transaction.message.instructions, ...innerIxs];
    await verifyInstructions(instructions, challenge, recipient);`;

let count = 0;
while (src.includes(OLD)) {
  src = src.replace(OLD, NEW);
  count++;
}

if (count === 0) {
  console.error("[patch-mpp] FAILED — expected sentinel block not found at the two known call-sites in dist/server/Charge.js.");
  console.error("[patch-mpp] @solana/mpp may have changed; re-author the patch by hand.");
  process.exit(1);
}

writeFileSync(target, src);
console.log(`[patch-mpp] patched ${count} call-site(s) in ${target}`);
