#!/bin/sh
# Diagnostic only (not for merge). Runs inside the s390x container.
set -u
apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl libatomic1 xz-utils >/dev/null
curl -fsSL "https://nodejs.org/dist/v$NODE/node-v$NODE-linux-s390x.tar.xz" | tar -xJ -C /usr/local --strip-components=1
node --version
mkdir -p /work && cd /work && cp /cadmpeg-ts/diag/*.mjs . && echo '{"type":"module"}' > package.json
npm install --no-audit --no-fund /cadmpeg-ts/tarballs/cadmpeg-ts-0*.tgz /cadmpeg-ts/tarballs/*s390x*.tgz >/dev/null 2>&1
F=/cadmpeg-ts/tests/fixtures/nist_ftc_06_asme1_rd_sw1802.SLDPRT
for to in sldprt step; do
  node --no-liftoff one.mjs wasm "$to" "$F"; echo "  exit=$? flags=--no-liftoff backend=wasm to=$to"
done
for backend in wasm native; do
  node loop.mjs "$backend" step "$F" 12; echo "  exit=$? loop backend=$backend to=step"
done
