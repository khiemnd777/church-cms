#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_root"
browser_script="${1:-browser-check.ts}"
case "$browser_script" in browser-check.ts|browser-churches.ts|browser-ui-standard.ts|browser-accounts.ts|browser-organization.ts|browser-members.ts|browser-families.ts|browser-organization-runtime.ts|browser-data-exchange.ts|browser-overview.ts|browser-attendance.ts|browser-qr.ts|browser-prep-classes.ts|browser-rites.ts|browser-certificates.ts|browser-p3-reporting.ts) ;; *) exit 2 ;; esac
container_name="church-cms-p1-verify-$(date +%s)-$$"
cleanup() { docker rm "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
bun run build
bun run build:ui
docker build -f tools/browser.Dockerfile -t church-cms-browser:p1.1 .
status=0
set --
if [[ "$(uname -s)" == "Linux" ]]; then
  # Compose publishes Mongo/Redis on host loopback; Docker Desktop supplies this alias on macOS.
  set -- --network host --add-host host.docker.internal:127.0.0.1
fi
docker run "$@" --name "$container_name" --init --shm-size=512m -e CHURCH_BROWSER_CONTAINER=1 -e "CHURCH_EVIDENCE_DIR=${CHURCH_EVIDENCE_DIR:-output/p1.3}" \
 --mount "type=bind,source=$project_root/api,target=/work/api,readonly" \
 --mount "type=bind,source=$project_root/scripts,target=/work/scripts,readonly" \
 --mount "type=bind,source=$project_root/node_modules,target=/work/node_modules,readonly" \
 --mount "type=bind,source=$project_root/dist,target=/work/dist,readonly" \
 --mount "type=bind,source=$project_root/output/ui-reference-dist,target=/work/ui-reference-dist,readonly" \
 --mount "type=bind,source=$project_root/tools/ui-reference,target=/work/reference,readonly" \
 --mount "type=bind,source=$project_root/package.json,target=/work/package.json,readonly" \
 church-cms-browser:p1.1 bun "scripts/$browser_script" || status=$?
docker cp "$container_name:/work/output/." "$project_root/output/"
exit "$status"
