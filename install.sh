#!/bin/sh
# Installs Caju from the GitHub releases.
#
#   curl -fsSL https://raw.githubusercontent.com/aecdanjundex/caju/main/install.sh | sh
#
# Environment:
#   CAJU_VERSION=0.1.0     a given version (default: the latest release)
#   CAJU_HOME=~/.caju      where the files go (bin/, lib/, rt/, examples/)
#   CAJU_BIN_DIR=~/.local/bin   where the `caju` command is linked
#   CAJU_PACKAGE=file.tar.gz    install from a local package instead of downloading
set -eu

repo="aecdanjundex/caju"
home="${CAJU_HOME:-$HOME/.caju}"
bin_dir="${CAJU_BIN_DIR:-$HOME/.local/bin}"
asset="caju-linux-x86_64.tar.gz"

fail() { echo "caju install: $*" >&2; exit 1; }

case "$(uname -s)" in
  Linux) ;;
  *) fail "only Linux x86-64 has a package for now (on Windows, use WSL)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ;;
  *) fail "only x86-64 is supported (this machine is $(uname -m))" ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ -n "${CAJU_PACKAGE:-}" ]; then
  cp "$CAJU_PACKAGE" "$tmp/$asset"
else
  if [ -n "${CAJU_VERSION:-}" ]; then
    url="https://github.com/$repo/releases/download/v${CAJU_VERSION#v}/$asset"
  else
    url="https://github.com/$repo/releases/latest/download/$asset"
  fi
  echo "Downloading $url"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmp/$asset" || fail "download failed"
    curl -fsSL "$url.sha256" -o "$tmp/$asset.sha256" || fail "checksum download failed"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$tmp/$asset" || fail "download failed"
    wget -q "$url.sha256" -O "$tmp/$asset.sha256" || fail "checksum download failed"
  else
    fail "needs curl or wget"
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$tmp" && sha256sum -c "$asset.sha256" >/dev/null) || fail "checksum does not match"
  fi
fi

tar -C "$tmp" -xzf "$tmp/$asset" || fail "could not extract the package"
src=$(find "$tmp" -mindepth 1 -maxdepth 1 -type d -name 'caju-*' | head -n 1)
[ -n "$src" ] && [ -x "$src/bin/caju" ] || fail "unexpected package layout"

# replace the previous installation as a whole (old lib/ files must not linger)
mkdir -p "$(dirname "$home")"
rm -rf "$home.new"
mv "$src" "$home.new"
rm -rf "$home"
mv "$home.new" "$home"

mkdir -p "$bin_dir"
ln -sf "$home/bin/caju" "$bin_dir/caju"

echo "Installed $("$home/bin/caju" version) in $home"
case ":$PATH:" in
  *":$bin_dir:"*) echo "Run: caju run $home/examples/hello-world.caju" ;;
  *) echo "Add $bin_dir to your PATH, e.g.:"
     echo "  echo 'export PATH=\"$bin_dir:\$PATH\"' >> ~/.bashrc && . ~/.bashrc" ;;
esac
