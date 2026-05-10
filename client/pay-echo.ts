/**
 * Klink MPP Echo Mock — DEMO CLIENT.
 *
 * Tiny mppx client that:
 *   1. GETs the local mock's /echo
 *   2. Receives a 402 advertising Solana mainnet + devnet
 *   3. Picks the devnet method (matches our env)
 *   4. Signs a USDC SPL transfer with a local Solana keypair
 *   5. Retries with the Credential
 *   6. Prints the receipt + paid response
 *
 * This is the CLIENT side of the split-screen hackathon demo. The mppx SDK
 * does the heavy lifting — we just configure it with a Solana keypair and
 * let it handle the 402 → sign → retry loop.
 *
 * Per the companion memo: Klink's own /v1/spend/sign-payment doesn't speak
 * MPP yet — that's a separate parser-delta task. This script bypasses Klink
 * and uses mppx's client SDK directly. Equivalent functionality, available
 * today, zero Klink code changes.
 *
 * Run: `bun run client/pay-echo.ts`
 */

import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { Mppx } from "mppx/client";
import { solana } from "@solana/mpp/client";

// ─── Load keypair ────────────────────────────────────────────────────────────

const KEYPAIR_PATH = process.env.SOLANA_PAYER_KEYPAIR ?? "./client-keypair.json";
const TARGET_URL = process.env.TARGET_URL ?? "http://localhost:3000/echo";

let payer: Keypair;
try {
  const secret = JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"));
  payer = Keypair.fromSecretKey(new Uint8Array(secret));
} catch (e) {
  console.error(`[client] Could not load keypair from ${KEYPAIR_PATH}`);
  console.error(`[client] Generate one with: solana-keygen new --no-bip39-passphrase --outfile ${KEYPAIR_PATH}`);
  console.error(`[client] Then fund it with devnet USDC at https://faucet.circle.com/`);
  console.error(`[client] Error: ${(e as Error).message}`);
  process.exit(1);
}

console.log(`[client] Payer pubkey: ${payer.publicKey.toBase58()}`);
console.log(`[client] Target: ${TARGET_URL}`);

// ─── Set up mppx client ──────────────────────────────────────────────────────

const mppx = Mppx.create({
  methods: [
    solana.charge({
      keypair: payer,
      onProgress(event: { type: string }) {
        // Lifecycle events: challenge → signing → signed → paying → confirming → paid
        console.log(`[client] mpp event: ${event.type}`);
      },
    }),
  ],
  polyfill: false, // explicit mppx.fetch — no globalThis.fetch patching
});

// ─── Pay & fetch ─────────────────────────────────────────────────────────────

console.log(`[client] Calling ${TARGET_URL} (expect 402, then sign, then 200)...`);

const start = Date.now();
const response = await mppx.fetch(TARGET_URL);
const elapsed = Date.now() - start;

console.log(`[client] HTTP ${response.status} in ${elapsed}ms`);

// Receipt header on success
const receipt = response.headers.get("Payment-Receipt") ?? response.headers.get("PAYMENT-RESPONSE");
if (receipt) {
  console.log(`[client] Settlement receipt: ${receipt.slice(0, 80)}...`);
}

const body = await response.json();
console.log(`[client] Response body:`);
console.log(JSON.stringify(body, null, 2));

console.log(`\n[client] ✅ Done. Total elapsed: ${elapsed}ms.`);
