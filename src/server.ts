/**
 * Klink MPP Echo Mock — research artifact (NOT production Klink code).
 *
 * Minimal Hono server that:
 *   - Returns HTTP 402 Payment Required on GET /echo
 *   - Advertises one Solana network (mainnet-beta, devnet, or localnet) via MPP
 *     (WWW-Authenticate: Payment). Run two instances to advertise both.
 *   - Auto-publishes a discovery doc at GET /openapi.json with x-payment-info
 *   - Serves dummy JSON on retry after payment verification
 *
 * Built specifically to be the FIRST MPP-on-Solana service registered at
 * mppscan.com and (via PR) mpp.dev/services. See the companion memo at
 * docs/memos/2026-05-11-mpp-mock-service-and-registration.md.
 *
 * Run: `bun install && bun run dev`
 * Deploy: see ../README.md
 */

import { Hono } from "hono";
import { Mppx, discovery } from "mppx/hono";
import { solana } from "@solana/mpp/server";

// ─── Config from env ────────────────────────────────────────────────────────

const SOLANA_RECIPIENT = process.env.SOLANA_RECIPIENT;
if (!SOLANA_RECIPIENT) {
  console.error("[fatal] SOLANA_RECIPIENT env var is required. See .env.example.");
  process.exit(1);
}

const MPP_SECRET_KEY = process.env.MPP_SECRET_KEY; // optional; mppx will gen one if undefined

// Network to advertise. mppx 0.6.x requires a unique (name, intent) per Mppx
// instance, so we advertise one Solana network per server. Pick the first
// value if a comma-separated list is given (back-compat with older .env).
const ADVERTISE_RAW = (process.env.ADVERTISE ?? "mainnet-beta").split(",").map((s) => s.trim()).filter(Boolean);
const NETWORK_INPUT = ADVERTISE_RAW[0] ?? "mainnet-beta";
const NETWORK: "mainnet-beta" | "devnet" | "localnet" =
  NETWORK_INPUT === "mainnet" ? "mainnet-beta" : (NETWORK_INPUT as "mainnet-beta" | "devnet" | "localnet");

if (!["mainnet-beta", "devnet", "localnet"].includes(NETWORK)) {
  console.error(`[fatal] ADVERTISE must be one of mainnet | mainnet-beta | devnet | localnet (got "${NETWORK_INPUT}").`);
  process.exit(1);
}
if (ADVERTISE_RAW.length > 1) {
  console.warn(`[mpp-mock] ADVERTISE="${process.env.ADVERTISE}" lists multiple networks; using "${NETWORK}". Run separate instances to advertise more.`);
}

// Token mints per network.
//   - "sol"                                          → native SOL (9 decimals)
//   - "EPjFWdd5...DT1v"  (mainnet USDC)              → Circle USDC on mainnet
//   - "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" → Circle USDC on devnet
const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// What asset to charge in. "sol" | "usdc" — picked at startup, single offer per server.
const ASSET = (process.env.ASSET ?? "sol").toLowerCase();

const isSol = ASSET === "sol";
const currency = isSol
  ? "sol"
  : NETWORK === "devnet"
    ? USDC_MINT_DEVNET
    : USDC_MINT_MAINNET;
const decimals = isSol ? 9 : 6;
// 0.01 USDC = 10000 (6 dec); 0.001 SOL = 1_000_000 (9 dec)
const amount = isSol ? "1000000" : "10000";

// ─── Build MPP methods array ────────────────────────────────────────────────

const methods = [
  solana.charge({
    recipient: SOLANA_RECIPIENT,
    currency,
    decimals,
    network: NETWORK,
  }),
];

console.log(`[mpp-mock] Advertising network: ${NETWORK}`);
console.log(`[mpp-mock] Asset: ${isSol ? "SOL" : `USDC (${currency})`}`);
console.log(`[mpp-mock] Recipient: ${SOLANA_RECIPIENT}`);

// ─── Mppx instance ──────────────────────────────────────────────────────────

const mppx = Mppx.create({
  methods,
  secretKey: MPP_SECRET_KEY,
});

// ─── Hono app ───────────────────────────────────────────────────────────────

const app = new Hono();

// Free: liveness probe
app.get("/health", (c) => c.json({ ok: true, network: NETWORK, recipient: SOLANA_RECIPIENT }));

// Paid: the echo merchant. $0.01 USDC. On payment verified, returns dummy JSON.
app.get(
  "/echo",
  mppx.charge({
    amount, // base units of `decimals` (see ASSET block above)
    currency,
    decimals,
    description: "Klink MPP echo - paid response with timestamp and request ID",
  }),
  (c) => {
    return c.json({
      message: "Paid! 🎉",
      timestamp: Date.now(),
      requestId: crypto.randomUUID(),
      info: {
        thisIs: "a research mock service",
        purpose:
          "to validate the mppx + @solana/mpp server SDK and to test MPP-on-Solana parsing in Klink",
        memo: "docs/memos/2026-05-11-mpp-mock-service-and-registration.md",
      },
    });
  },
);

// Discovery doc — MPPScan and other crawlers fetch this to index the service.
discovery(app, mppx, {
  auto: true,
  info: {
    title: "Klink MPP Echo Mock",
    version: "0.1.0",
    description:
      "Minimal MPP-on-Solana echo merchant. Returns a 402 challenge on /echo and serves dummy JSON on retry. Built as a research artifact for github.com/<klink-repo>; not a production service.",
    contact: { name: "Klink team", url: "https://github.com/" },
  },
});

// ─── Server bootstrap ───────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3000);

console.log(`[mpp-mock] Listening on http://localhost:${port}`);
console.log(`[mpp-mock]   GET /health        — free liveness probe`);
console.log(`[mpp-mock]   GET /echo          — paid ($0.01 USDC)`);
console.log(`[mpp-mock]   GET /openapi.json  — discovery doc for MPPScan`);

export default {
  port,
  fetch: app.fetch,
};
