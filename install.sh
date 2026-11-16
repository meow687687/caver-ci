#!/bin/sh
# Install caver-ci into a user-owned npm prefix. No sudo is required.
set -eu

for command in git node npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Error: %s is required to install caver-ci.\n' "$command" >&2
    exit 1
  fi
done

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 24)) { console.error("Error: Node.js 20.19+, 22.12+, or 24+ is required."); process.exit(1); }'

prefix=${CAVER_CI_PREFIX:-"$HOME/.local"}
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/caver-ci-install.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT
trap 'exit 1' HUP INT TERM

printf 'Downloading caver-ci...\n'
git clone --quiet --depth 1 --branch main https://github.com/meow687687/caver-ci.git "$tmp_dir/repo"
cd "$tmp_dir/repo"
printf 'Installing build dependencies and building...\n'
npm ci --ignore-scripts
npm run build
archive=$(npm pack --silent --ignore-scripts --pack-destination "$tmp_dir")
printf 'Installing to %s...\n' "$prefix"
npm install --global --ignore-scripts --prefix "$prefix" "$tmp_dir/$archive"
printf '\ncaver-ci installed at %s/bin/caver-ci\n' "$prefix"
case ":$PATH:" in
  *":$prefix/bin:"*) ;;
  *) printf 'Add %s/bin to your PATH to run caver-ci.\n' "$prefix" ;;
esac
