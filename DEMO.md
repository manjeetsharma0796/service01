# Hackathon demo — split-screen narrative

**Target runtime**: 2:30–3:00 video. Split-screen: **left = server (protocol)**, **right = client (product)**.

## Pre-flight (do once, day before recording)

```bash
cd docs/research-artifacts/mpp-mock-service

# 1. Install
bun install

# 2. Generate keypairs + airdrop devnet SOL + write .env
bash scripts/devnet-setup.sh   # or: pwsh scripts/devnet-setup.ps1 on Windows

# 3. Fund payer with devnet USDC (from Circle's faucet — link printed by step 2)
#    https://faucet.circle.com/  →  Solana Devnet  →  paste payer pubkey

# 4. Smoke-test
bun run dev               # Terminal 1 — server boots, prints listening on :3000
bun run client/pay-echo.ts # Terminal 2 — should print "✅ Done" within ~5s
```

If `bun run dev` errors on `mppx` imports — pin versions in `package.json` to the latest stable tags shown by `bun pm view mppx`.

## Recording flow — 3 acts

### Act 1 — The gap (0:00–0:30)

**Left pane**: Browser open to [mpp.dev/services](https://mpp.dev/services).
**Right pane**: Terminal showing the [Solana x402 services catalog memo](../../memos/2026-05-10-solana-x402-services-catalog.md) — the table where MPP-Solana row is 0.

**Voiceover** (suggested):
> *"mpp.dev lists 32 services. Every single one settles on Tempo. The MPP spec supports Solana — the IETF draft is even called 'solana-charge' — but zero deployed services have flipped it on. Klink is a Solana-native agent wallet. We built the first MPP-Solana service to close this gap."*

### Act 2 — The protocol side (0:30–1:30)

**Left pane (server)**:
```bash
bun run dev
# [mpp-mock] Advertising methods: mainnet, devnet
# [mpp-mock] Recipient: <recipient pubkey>
# [mpp-mock] Listening on http://localhost:3000
```

**Right pane (curl, no payment)**:
```bash
curl -is http://localhost:3000/echo
# HTTP/1.1 402 Payment Required
# WWW-Authenticate: Payment id="...", method="solana", intent="charge", ...  # mainnet
# WWW-Authenticate: Payment id="...", method="solana", intent="charge", ...  # devnet
```

**Voiceover**:
> *"30 lines of TypeScript. Two `solana.charge()` calls register mainnet and devnet. Hit `/echo` without payment — you get a 402 advertising both. This is the first MPP 402 in the wild that says 'pay me on Solana'."*

Decode the base64 `request` field on-screen to show:
```json
{
  "amount": "10000",
  "currency": "EPjFWdd5...DDt1v",
  "recipient": "<your pubkey>",
  "methodDetails": { "network": "devnet", "decimals": 6 }
}
```

### Act 3 — The product side (1:30–2:30)

**Right pane**:
```bash
bun run client/pay-echo.ts
# [client] Payer pubkey: <pubkey>
# [client] Target: http://localhost:3000/echo
# [client] Calling http://localhost:3000/echo (expect 402, then sign, then 200)...
# [client] mpp event: challenge
# [client] mpp event: signing
# [client] mpp event: signed
# [client] mpp event: paying
# [client] mpp event: confirming
# [client] mpp event: paid
# [client] HTTP 200 in 4231ms
# [client] Settlement receipt: <base64>...
# [client] Response body: {
#   "message": "Paid! 🎉",
#   "timestamp": 1747...,
#   "requestId": "..."
# }
# [client] ✅ Done.
```

**Left pane**: server logs scrolling, showing the inbound retry with `Authorization: Payment ...` header, settlement, receipt issued.

**Voiceover**:
> *"On the client side: mppx detects the 402, picks the devnet method, signs a USDC SPL transfer with our local keypair, submits, waits for on-chain confirmation. The server verifies the tx, issues a receipt, and finally serves the response. Real signature, real on-chain tx, devnet USDC — only the response body is mock. End-to-end MPP-on-Solana, working."*

### Closer (2:30–3:00)

**On-screen text**:
- *"Service: docs/research-artifacts/mpp-mock-service/"*
- *"Built with: mppx + @solana/mpp + Hono + Bun"*
- *"Next: register at mppscan.com + open PR to mpp.dev/services"*
- *"Klink integration: parser delta scoped in docs/memos/2026-05-09-mpp-tempo-migration-finding.md"*

**Voiceover**:
> *"This service goes from zero to first-on-Solana once we register it. Klink's agent wallet integration is a 2-day parser change away. Solana stops being a second-class citizen of MPP. Submission: github.com/<your-repo>."*

## What can go wrong on demo day (and the fix)

| Symptom | Likely cause | Fix |
|---|---|---|
| `bun run dev` exits with "Cannot find module 'mppx/hono'" | Package not yet on `latest` tag | `bun pm view mppx versions --json` → pin to a tagged version in `package.json` |
| 402 returns but only one `WWW-Authenticate` header | `ADVERTISE` env was set to a single network | `unset ADVERTISE` or set `ADVERTISE=mainnet,devnet` in `.env` |
| Client hangs on `paying` event | Devnet RPC slow or down | Switch RPC: `SOLANA_RPC_URL=https://api.devnet.solana.com` (the public one) — usually faster than custom endpoints |
| Client `signing` event fails immediately | Keypair has no devnet USDC | Re-airdrop SOL **and** re-claim from Circle's faucet. SOL covers gas, USDC is the asset being transferred |
| Client succeeds but server logs "verification failed" | Recipient pubkey in `.env` doesn't match the ATA the client signed | Re-run `devnet-setup.sh` — it ensures recipient + server agree |

## Submission package

Include in your hackathon repo:
- The whole `docs/research-artifacts/mpp-mock-service/` folder
- A README at repo root explaining the journey + linking the memos
- The 3 most relevant project memos:
  - [`2026-05-09-mpp-tempo-migration-finding.md`](../../memos/2026-05-09-mpp-tempo-migration-finding.md) — why this gap exists
  - [`2026-05-10-solana-x402-services-catalog.md`](../../memos/2026-05-10-solana-x402-services-catalog.md) — the broader Solana payments landscape
  - [`2026-05-11-mpp-mock-service-and-registration.md`](../../memos/2026-05-11-mpp-mock-service-and-registration.md) — this artifact's design + registration plan
