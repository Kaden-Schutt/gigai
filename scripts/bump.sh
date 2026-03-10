#!/bin/sh
set -e

if [ -z "$1" ]; then
  echo "Usage: ./scripts/bump.sh <version>"
  echo "Example: ./scripts/bump.sh 0.6.0"
  exit 1
fi

V="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- Check for uncommitted changes ---
if [ -n "$(git diff --name-only)" ] || [ -n "$(git diff --cached --name-only)" ]; then
  echo "ERROR: You have uncommitted changes. Commit or stash them first."
  git diff --name-only
  git diff --cached --name-only
  exit 1
fi

# --- Update versions ---

for f in \
  package.json \
  packages/shared/package.json \
  packages/server/package.json \
  packages/cli/package.json \
  packages/kon/package.json \
  .claude-plugin/plugin.json
do
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$V\"/" "$f"
  echo "  updated $f"
done

# Update VERSION constants
printf 'export const VERSION = "%s";\n' "$V" > packages/cli/src/version.ts
echo "  updated packages/cli/src/version.ts"

sed -i '' "s/export const VERSION = \"[^\"]*\"/export const VERSION = \"$V\"/" packages/server/src/routes/health.ts
echo "  updated packages/server/src/routes/health.ts"

# --- Commit, tag, push ---

git add \
  package.json \
  packages/shared/package.json \
  packages/server/package.json \
  packages/cli/package.json \
  packages/kon/package.json \
  packages/cli/src/version.ts \
  packages/server/src/routes/health.ts \
  .claude-plugin/plugin.json

git commit -m "chore: bump version to $V"
git tag -a "v$V" -m "v$V"
git push origin main --follow-tags

echo ""
echo "v$V pushed — CI release will build binaries + publish to npm"
