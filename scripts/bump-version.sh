#!/usr/bin/env bash
# Bump the build id everywhere so the service worker cache is busted.
# usage: scripts/bump-version.sh [new-build-id]   (default: YYYY-MM-DD.HHMM)
set -euo pipefail
cd "$(dirname "$0")/.."
NEW="${1:-$(date +%Y-%m-%d.%H%M)}"
OLD=$(sed -n "s/^window.HUDDLE_BUILD = '\(.*\)';/\1/p" docs/js/config.js)
[ -n "$OLD" ] || { echo "could not read old build"; exit 1; }
sed -i "s/$OLD/$NEW/g" docs/js/config.js docs/sw.js docs/index.html
echo "build $OLD -> $NEW (config.js, sw.js CACHE + precache URLs, index.html ?v=)"
