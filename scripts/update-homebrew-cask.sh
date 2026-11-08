#!/bin/sh
# Points the Homebrew cask in github.com/MeterLuma/homebrew-tap at a published release, so
# `brew install --cask meterluma/tap/meterluma` installs it. Run after latest.json offers the version.
# Usage: scripts/update-homebrew-cask.sh 0.2.0
# See docs/release-process.md, "Publish".
set -eu

version="${1:-}"
if ! printf '%s\n' "$version" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+'; then
  echo "Usage: $0 <version>, for example $0 0.2.0" >&2
  exit 1
fi

base="https://downloads.meterluma.com/$version"
dmg="MeterLuma_${version}_universal.dmg"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

published=$(curl -fsS "https://downloads.meterluma.com/latest.json?check=$(date +%s)" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')
if [ "$published" != "$version" ]; then
  echo "latest.json offers $published, not $version. Publish the release first." >&2
  exit 1
fi

# The cask records the disk image's SHA-256; check the published file against SHA256SUMS.txt.
curl -fsS "$base/SHA256SUMS.txt" -o "$work/SHA256SUMS.txt"
expected=$(awk -v name="$dmg" '$2 == name { print $1 }' "$work/SHA256SUMS.txt")
if [ -z "$expected" ]; then
  echo "$dmg is not listed in $base/SHA256SUMS.txt." >&2
  exit 1
fi
curl -fsS "$base/$dmg" -o "$work/$dmg"
actual=$(shasum -a 256 "$work/$dmg" | cut -c1-64)
if [ "$actual" != "$expected" ]; then
  echo "The published $dmg does not match SHA256SUMS.txt." >&2
  exit 1
fi

gh repo clone MeterLuma/homebrew-tap "$work/tap" -- --quiet
cask="$work/tap/Casks/meterluma.rb"
sed -E -e "s/^  version \"[^\"]+\"$/  version \"$version\"/" -e "s/^  sha256 \"[0-9a-f]{64}\"$/  sha256 \"$actual\"/" \
  "$cask" > "$work/meterluma.rb"
if ! grep -qx "  version \"$version\"" "$work/meterluma.rb" || ! grep -qx "  sha256 \"$actual\"" "$work/meterluma.rb"; then
  echo "Could not find the version and sha256 lines in Casks/meterluma.rb." >&2
  exit 1
fi
mv "$work/meterluma.rb" "$cask"
if git -C "$work/tap" diff --quiet; then
  echo "The cask already installs $version."
  exit 0
fi
git -C "$work/tap" commit -qam "Update MeterLuma to $version"
git -C "$work/tap" push -q origin HEAD
echo "The cask now installs MeterLuma $version (sha256 $actual)."
