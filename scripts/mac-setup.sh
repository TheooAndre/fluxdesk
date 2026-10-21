#!/usr/bin/env bash
# Run after installing Node 22 LTS (using Homebrew, nvm or fnm).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo 'Install Node 22 LTS first. See README: Mac installation.'; exit 1; }
command -v corepack >/dev/null || { echo 'Corepack missing. Install corepack and rerun. See README.'; exit 1; }
corepack enable
corepack prepare pnpm@10.18.0 --activate
if [[ ! -f .env ]]; then cp .env.example .env; echo 'Created local .env from safe defaults.'; fi
pnpm install
node scripts/doctor.mjs
pnpm check
printf '\nLocal validation completed. Start the app using: pnpm dev\nThen open: http://127.0.0.1:5173\n'
