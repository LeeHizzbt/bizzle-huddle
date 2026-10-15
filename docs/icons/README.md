# Icons — single place to swap the logo
1. Save the final logo as `docs/icons/source.png` (square, 1024×1024+, transparent or dark background).
2. Run `python3 scripts/make-icons.py` — it regenerates icon-192/512, maskable-512, apple-touch-icon and the Android launcher mipmaps.
3. Optionally replace `favicon.svg`.
4. Run `scripts/bump-version.sh` so the service worker cache refreshes, then commit.
The manifest (`docs/manifest.webmanifest`) already points at these file names.
