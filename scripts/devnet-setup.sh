#!/usr/bin/env bash
# Devnet setup helper for the MPP echo mock demo.
#
# What this does:
#   1. Generates a payer keypair at ./client-keypair.json (if missing)
#   2. Generates a recipient keypair at ./mock-recipient.json (if missing)
#   3. Airdrops 2 SOL to the payer on devnet (for tx fees, not USDC)
#   4. Prints next steps for funding payer with devnet USDC via Circle's faucet
#
# Run from docs/research-artifacts/mpp-mock-service/:
#   bash scripts/devnet-setup.sh
#
# Requires: solana CLI (https://docs.solana.com/cli/install-solana-cli-tools)
# Windows users: run inside Git Bash, WSL, or use the .ps1 variant.

set -e

cd "$(dirname "$0")/.."

if ! command -v solana >/dev/null 2>&1; then
  echo "[setup] solana CLI not found. Install: https://docs.solana.com/cli/install-solana-cli-tools" >&2
  exit 1
fi

solana config set --url https://api.devnet.solana.com >/dev/null

# 1. Payer keypair (client)
if [ ! -f client-keypair.json ]; then
  echo "[setup] Generating payer keypair → client-keypair.json"
  solana-keygen new --no-bip39-passphrase --outfile client-keypair.json --silent
else
  echo "[setup] Payer keypair already exists at client-keypair.json"
fi
PAYER_PUBKEY=$(solana-keygen pubkey client-keypair.json)
echo "[setup] Payer pubkey: $PAYER_PUBKEY"

# 2. Recipient keypair (server)
if [ ! -f mock-recipient.json ]; then
  echo "[setup] Generating recipient keypair → mock-recipient.json"
  solana-keygen new --no-bip39-passphrase --outfile mock-recipient.json --silent
else
  echo "[setup] Recipient keypair already exists at mock-recipient.json"
fi
RECIPIENT_PUBKEY=$(solana-keygen pubkey mock-recipient.json)
echo "[setup] Recipient pubkey: $RECIPIENT_PUBKEY"

# 3. Airdrop SOL for tx fees on the payer
echo "[setup] Airdropping 2 SOL devnet to payer (for gas)..."
solana airdrop 2 "$PAYER_PUBKEY" --url devnet || echo "[setup] (Airdrop may be rate-limited; retry in a few minutes if it failed.)"

# 4. Write/update .env to point the server at the recipient
if [ -f .env ]; then
  echo "[setup] Updating SOLANA_RECIPIENT in existing .env"
  if grep -q "^SOLANA_RECIPIENT=" .env; then
    sed -i.bak "s|^SOLANA_RECIPIENT=.*|SOLANA_RECIPIENT=$RECIPIENT_PUBKEY|" .env
  else
    echo "SOLANA_RECIPIENT=$RECIPIENT_PUBKEY" >> .env
  fi
else
  echo "[setup] Creating .env"
  cp .env.example .env
  sed -i.bak "s|^SOLANA_RECIPIENT=.*|SOLANA_RECIPIENT=$RECIPIENT_PUBKEY|" .env
fi
rm -f .env.bak

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  Setup complete. Now:"
echo "  ─────────────────────────────────────────────────────────────────"
echo "  1. Fund the payer with devnet USDC:"
echo "       Visit https://faucet.circle.com/"
echo "       Network: Solana Devnet"
echo "       Address: $PAYER_PUBKEY"
echo "       Click 'Request 20 USDC'"
echo ""
echo "  2. Start the server:"
echo "       bun run dev"
echo ""
echo "  3. In another terminal, pay it:"
echo "       bun run client/pay-echo.ts"
echo "═══════════════════════════════════════════════════════════════════"
