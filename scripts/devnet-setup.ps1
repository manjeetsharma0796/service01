#!/usr/bin/env pwsh
# Devnet setup helper for the MPP echo mock demo (PowerShell variant for Windows).
#
# Run from docs/research-artifacts/mpp-mock-service/:
#   pwsh scripts/devnet-setup.ps1
#
# Requires: solana CLI on PATH (install: https://docs.solana.com/cli/install-solana-cli-tools)

$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command solana -ErrorAction SilentlyContinue)) {
  Write-Error "solana CLI not found. Install: https://docs.solana.com/cli/install-solana-cli-tools"
  exit 1
}

solana config set --url https://api.devnet.solana.com | Out-Null

# 1. Payer keypair (client)
if (-not (Test-Path client-keypair.json)) {
  Write-Host "[setup] Generating payer keypair → client-keypair.json"
  solana-keygen new --no-bip39-passphrase --outfile client-keypair.json --silent | Out-Null
} else {
  Write-Host "[setup] Payer keypair already exists at client-keypair.json"
}
$payerPubkey = (solana-keygen pubkey client-keypair.json).Trim()
Write-Host "[setup] Payer pubkey: $payerPubkey"

# 2. Recipient keypair (server)
if (-not (Test-Path mock-recipient.json)) {
  Write-Host "[setup] Generating recipient keypair → mock-recipient.json"
  solana-keygen new --no-bip39-passphrase --outfile mock-recipient.json --silent | Out-Null
} else {
  Write-Host "[setup] Recipient keypair already exists at mock-recipient.json"
}
$recipientPubkey = (solana-keygen pubkey mock-recipient.json).Trim()
Write-Host "[setup] Recipient pubkey: $recipientPubkey"

# 3. Airdrop SOL for tx fees on the payer
Write-Host "[setup] Airdropping 2 SOL devnet to payer (for gas)..."
try { solana airdrop 2 $payerPubkey --url devnet } catch { Write-Host "[setup] Airdrop may be rate-limited; retry in a few minutes." }

# 4. Write/update .env
if (Test-Path .env) {
  Write-Host "[setup] Updating SOLANA_RECIPIENT in existing .env"
  $envContent = Get-Content .env
  if ($envContent -match "^SOLANA_RECIPIENT=") {
    $envContent = $envContent -replace "^SOLANA_RECIPIENT=.*", "SOLANA_RECIPIENT=$recipientPubkey"
  } else {
    $envContent += "SOLANA_RECIPIENT=$recipientPubkey"
  }
  Set-Content .env $envContent -Encoding utf8
} else {
  Write-Host "[setup] Creating .env"
  Copy-Item .env.example .env
  (Get-Content .env) -replace "^SOLANA_RECIPIENT=.*", "SOLANA_RECIPIENT=$recipientPubkey" | Set-Content .env -Encoding utf8
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════════"
Write-Host "  Setup complete. Now:"
Write-Host "  ─────────────────────────────────────────────────────────────────"
Write-Host "  1. Fund the payer with devnet USDC:"
Write-Host "       Visit https://faucet.circle.com/"
Write-Host "       Network: Solana Devnet"
Write-Host "       Address: $payerPubkey"
Write-Host "       Click 'Request 20 USDC'"
Write-Host ""
Write-Host "  2. Start the server:"
Write-Host "       bun run dev"
Write-Host ""
Write-Host "  3. In another terminal, pay it:"
Write-Host "       bun run client/pay-echo.ts"
Write-Host "═══════════════════════════════════════════════════════════════════"
