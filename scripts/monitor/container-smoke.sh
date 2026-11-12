#!/usr/bin/env bash
set -euo pipefail
# Isolated synthetic HTTPS target; the internal Docker network has no Internet egress.
monitor_image="${1:?Pass the already-built monitor image}"
monitor_fixture="$(mktemp -d)"
monitor_tag="mansora-monitor-smoke-$$"
cleanup() {
  docker rm -f "$monitor_tag-checker" "$monitor_tag-target" >/dev/null 2>&1 || true
  docker network rm "$monitor_tag" >/dev/null 2>&1 || true
  rm -rf "$monitor_fixture"
}
trap cleanup EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout "$monitor_fixture/key.pem" -out "$monitor_fixture/cert.pem" -subj /CN=uptime-target -addext 'subjectAltName=DNS:uptime-target,IP:127.0.0.1' >/dev/null 2>&1
chmod 600 "$monitor_fixture/key.pem"
cat > "$monitor_fixture/upstream.cjs" <<'JS'
const fs=require('node:fs');require('node:https').createServer({key:fs.readFileSync('/fixture/key.pem'),cert:fs.readFileSync('/fixture/cert.pem')},(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true,"mode":"team-staging"}');}).listen(8443,'0.0.0.0');
JS
docker network create --internal "$monitor_tag" >/dev/null
docker run -d --name "$monitor_tag-target" --network "$monitor_tag" --network-alias uptime-target --mount "type=bind,src=$monitor_fixture,dst=/fixture,readonly" -e NODE_EXTRA_CA_CERTS=/fixture/cert.pem node:22-bookworm-slim node /fixture/upstream.cjs >/dev/null
for attempt in {1..30}; do
  if docker exec "$monitor_tag-target" node -e "fetch('https://127.0.0.1:8443/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker run -d --name "$monitor_tag-checker" --network "$monitor_tag" --mount "type=bind,src=$monitor_fixture/cert.pem,dst=/fixture/cert.pem,readonly" -e NODE_EXTRA_CA_CERTS=/fixture/cert.pem -e MANSORA_MONITOR_URL=https://uptime-target:8443/healthz -e PLATFORM_ALERT_EMAIL=alerts@example.test -e RESEND_FROM_EMAIL=sender@example.test -e RESEND_API_KEY=synthetic-unusable-fixture "$monitor_image" >/dev/null
for attempt in {1..30}; do
  if docker exec "$monitor_tag-checker" node -e "fetch('http://127.0.0.1:8080/healthz').then(async r=>{const s=await r.json();if(!r.ok||s.role!=='uptime-monitor'||s.outcome!=='ready'||process.getuid()===0)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo 'Independent monitor image: non-root, HTTPS probe and self-health verified without a database, retail volume or real email.'
    exit 0
  fi
  sleep 1
done
docker logs "$monitor_tag-checker"
exit 1
