#!/bin/sh
set -eu

echo "[uv_fetcher] Container starting..."

# Vérification que la crontab est bien installée
echo "[uv_fetcher] Installed crontab:"
crontab -l || echo "No crontab found!"

# Lancement de cron en mode daemon
echo "[uv_fetcher] Starting cron service..."
command -v cron >/dev/null 2>&1 || { echo "[uv_fetcher] ERROR: cron not found"; exit 1; }
cron

# Mini check : un process cron doit exister
ps -ef | grep -v grep | grep -q "[c]ron" || { echo "[uv_fetcher] ERROR: cron failed to start"; exit 1; }

echo "[uv_fetcher] Cron started successfully."
echo "[uv_fetcher] Container is now waiting for scheduled jobs..."

# Garde le conteneur vivant
# (PID 1 doit rester actif sinon Docker stoppe le container)
tail -f /dev/null