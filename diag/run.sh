#!/bin/sh
# Diagnostic only (not for merge). Runs inside the s390x container.
set -u
apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl libatomic1 xz-utils >/dev/null
curl -fsSL "https://nodejs.org/dist/v$NODE/node-v$NODE-linux-s390x.tar.xz" | tar -xJ -C /usr/local --strip-components=1
node --version
mkdir -p /work && cd /work && cp /cadmpeg-ts/diag/one.mjs . && echo '{"type":"module"}' > package.json
ls /cadmpeg-ts/tarballs
npm install --no-audit --no-fund /cadmpeg-ts/tarballs/cadmpeg-ts-0*.tgz /cadmpeg-ts/tarballs/*s390x*.tgz >/dev/null 2>&1 || npm install --no-audit --no-fund /cadmpeg-ts/tarballs/cadmpeg-ts-0*.tgz /cadmpeg-ts/tarballs/*s390x*.tgz
TARGETS=$(node -e "import('cadmpeg-ts/formats').then(m=>console.log(m.outputs.map(o=>o.id).join(' ')))")
echo "targets: $TARGETS"
for flags in "" "--liftoff-only" "--no-liftoff"; do
  for backend in native wasm; do
    [ -n "$flags" ] && [ "$backend" = native ] && continue
    for to in $TARGETS; do
      node $flags one.mjs "$backend" "$to" /cadmpeg-ts/tests/fixtures/nist_ftc_06_asme1_rd_sw1802.SLDPRT
      echo "  exit=$? flags='$flags' backend=$backend to=$to"
    done
  done
done
