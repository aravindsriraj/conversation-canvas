#!/usr/bin/env bash
# Fast iteration deploy script.
# Pulls the latest commit on the Vultr VM, reinstalls deps, rebuilds, and
# restarts the pm2 process. Assumes the VM has already been provisioned and
# `.env.local` already lives at /home/canvas/conversation-canvas/.env.local.
set -euo pipefail

VM_USER="${VM_USER:-canvas}"
VM_HOST="${VM_HOST:-139.84.137.113}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"

ssh -i "$SSH_KEY" -o IdentitiesOnly=yes "$VM_USER@$VM_HOST" bash -lc '
  set -euo pipefail
  cd ~/conversation-canvas
  git pull --ff-only
  pnpm install --frozen-lockfile
  # Wipe `.next/` before every build. Discovered May 18 (one day before
  # the demo) that pnpm build was silently no-op-ing — Next.js was
  # treating the existing `.next/` as up-to-date and skipping the
  # rebuild. pm2 then restarted on a stale bundle while git HEAD pointed
  # at the latest commit, producing the "shapes never render" failure
  # mode (server emitting actions, client running yesterday-s code).
  # Forcing a clean rebuild costs ~30 extra seconds per deploy and
  # eliminates the entire class of bug.
  rm -rf .next
  pnpm build
  pm2 restart conversation-canvas
  pm2 status
'
