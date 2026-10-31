#!/bin/sh
# Signs src/additional/provider-list.json and publishes it to
# https://downloads.meterluma.com/providers/list.json. Increase "version" before every publish.
# See docs/release-process.md, "Signed provider list".
set -eu
cd "$(dirname "$0")/.."

list=src/additional/provider-list.json
key="${METERLUMA_PROVIDER_LIST_KEY:-$HOME/.tauri/meterluma-provider-list.key}"
url=https://downloads.meterluma.com/providers/list.json

version=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$list")
published=$(curl -fsS "$url?check=$(date +%s)" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).version)}catch{console.log(0)}})' || echo 0)
if [ "$version" -le "$published" ]; then
  echo "Set \"version\" in $list above the published version $published first." >&2
  exit 1
fi

# The rule tests fail if any entry would be ignored by the app.
cargo test --manifest-path src-tauri/Cargo.toml --lib provider_list --quiet

if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(security find-generic-password -s "MeterLuma provider list signing key password" -w)
fi
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" npx tauri signer sign -f "$key" "$list" > /dev/null

put() {
  npx --yes wrangler@4.156.0 r2 object put "meterluma-downloads/providers/$1" --file "$2" \
    --content-type "$3" --cache-control "public, max-age=300" --remote
}
put list.json.sig "$list.sig" "text/plain; charset=utf-8"
put list.json "$list" application/json
echo "Published provider list version $version to $url"
