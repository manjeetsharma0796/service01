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

import { Hono, type MiddlewareHandler } from "hono";
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

// Honor Render/Cloudflare/proxy x-forwarded-proto so generated URLs use
// https on production deployments instead of the internal http origin.
function publicOrigin(c: { req: { url: string; header: (k: string) => string | undefined } }): string {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto");
  const host = c.req.header("x-forwarded-host") ?? url.host;
  return `${proto ?? url.protocol.replace(":", "")}://${host}`;
}

// Agent-friendly hint injected into every 402 body so misintegrating clients
// see the correct wire format in the response they're already reading.
// Reason this exists: the canonical failure mode is agents inventing headers
// like `X-Payment-Proof` and sending bare tx signatures. Putting the spec
// inline at the point of failure is the highest-leverage place to fix it.
const enrich402: MiddlewareHandler = async (c, next) => {
  await next();
  if (
    c.res.status === 402 &&
    c.res.headers.get("Content-Type")?.includes("application/problem+json")
  ) {
    const origin = publicOrigin(c);
    const body = await c.res.clone().json() as Record<string, unknown>;
    const enriched = {
      ...body,
      helpUrl: `${origin}/llms.txt`,
      recommendedClient: "https://www.npmjs.com/package/@solana/mpp",
      integrationHint:
        "Send credential in `Authorization: Payment <token>` header where " +
        "<token> = base64url(JSON.stringify({challenge, payload:{type:'signature',signature}})). " +
        "The `challenge` MUST echo the full WWW-Authenticate challenge from this 402 (id, realm, " +
        "method, intent, request, expires, digest, opaque). The `signature` is a base58 Solana tx " +
        "signature for an on-chain transfer matching the offer in `request`. Do NOT use headers " +
        "like X-Payment-Proof or X-Payment - only Authorization: Payment is read.",
    };
    const headers = new Headers(c.res.headers);
    c.res = new Response(JSON.stringify(enriched), {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  }
};

// Free: liveness probe
app.get("/health", (c) => c.json({ ok: true, network: NETWORK, recipient: SOLANA_RECIPIENT }));

// Agent-discoverable plain-text spec. Follows Jeremy Howard's llms.txt
// convention (also used by mpp.dev itself at /services/llms.txt).
app.get("/llms.txt", (c) => {
  const origin = publicOrigin(c);
  const assetLabel = isSol ? "SOL" : "USDC";
  const human = isSol
    ? `${Number(amount) / 10 ** decimals} SOL`
    : `${(Number(amount) / 10 ** decimals).toFixed(2)} USDC`;
  const text = `# Klink MPP Echo Mock

Minimal MPP (Machine Payments Protocol) merchant on Solana ${NETWORK}.
Charges ${human} (${amount} base units, ${decimals} decimals) per call to /echo.
Asset: ${assetLabel}${isSol ? "" : ` (mint ${currency})`}.
Recipient: ${SOLANA_RECIPIENT}.

## Endpoints

- GET ${origin}/health        free liveness probe (200 JSON)
- GET ${origin}/echo          paid endpoint; first call returns 402
- GET ${origin}/openapi.json  OpenAPI 3.1 discovery doc with x-payment-info
- GET ${origin}/llms.txt      this file

## Payment handshake (HTTP 402 Payment Required, RFC 9110 + paymentauth.org)

1. Client: GET /echo
2. Server: 402 + header  WWW-Authenticate: Payment id="...", realm="...",
   method="solana", intent="charge", request="<base64url JSON offer>",
   expires="<ISO>", digest="...", opaque="..."
3. Client: build a Solana SPL/SOL transfer matching the offer in 'request'
   (recipient, amount, mint, network). Sign and broadcast on-chain. Get a
   base58 tx signature.
4. Client: GET /echo  with header:

     Authorization: Payment <token>

   where <token> = base64url-unpadded(JSON.stringify({
     challenge: { /* THE ENTIRE CHALLENGE FROM STEP 2, VERBATIM */ },
     payload:   { type: "signature", signature: "<base58 tx sig>" }
   }))

5. Server: HMAC-verifies the echoed challenge, looks up the signature on
   ${NETWORK}, verifies the transfer matches the offer, returns 200 + body
   plus a Payment-Receipt header.

## Common mistakes (do not do these)

- Wrong header name: X-Payment-Proof, X-Payment, X-Payment-Signature.
  Only Authorization: Payment <token> is read.
- Bare signature in the header: Authorization: Payment 2KQm...
  Must be the full base64url JSON envelope above. Server runs JSON.parse on it.
- Missing 'challenge' echo: just sending { payload:{...} } without the
  challenge object. Server uses the echoed challenge to recompute HMAC; without
  it, the credential is rejected and a fresh 402 is returned.
- On-chain memo: not required. Payment is bound to the challenge by HMAC echo
  + matching the on-chain transfer to (recipient, amount, mint) from 'request'.
- Expired challenge: each challenge is valid for ~5 minutes (see 'expires').
  Request a fresh 402 if more than 5 min have passed since you got the offer.

## Reference client implementations

- TypeScript / Node / Bun: \`@solana/mpp\` + \`mppx\` (npm).
  Example: https://github.com/manjeetsharma0796/service01/blob/main/client/pay-echo.ts
- Hand-rolled HTTP: see "Payment handshake" above. The whole credential
  builder is ~30 lines. See mppx/dist/Credential.js serialize() for canonical
  wire format.

## Spec

- MPP / Payment auth spec: https://paymentauth.org/draft-httpauth-payment-00.html
- MPP directory: https://mpp.dev/services
- mppx server SDK: https://www.npmjs.com/package/mppx
- @solana/mpp:    https://www.npmjs.com/package/@solana/mpp
`;
  return c.text(text);
});

// Paid: the echo merchant. $0.01 USDC. On payment verified, returns dummy JSON.
app.get(
  "/echo",
  enrich402,
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
console.log(`[mpp-mock]   GET /llms.txt      — plain-text agent integration spec`);

export default {
  port,
  fetch: app.fetch,
};
