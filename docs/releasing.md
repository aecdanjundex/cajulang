# Publishing a version

The distribution is a Linux x86-64 package published in GitHub Releases:

```
caju-linux-x86_64.tar.gz          caju-<version>/bin/caju, lib/, rt/, examples/, README.md
caju-linux-x86_64.tar.gz.sha256
caju-wasm.tar.gz                  the compiler in WebAssembly (tools/wasm/package.sh, docs/wasm.md)
caju-wasm.tar.gz.sha256
```

`caju` finds `lib/` and `rt/` in the directory above the binary (or in `CAJU_ROOT`). The symbolic
link in `~/.local/bin` works because `os.executable()` reads `/proc/self/exe`, which resolves the link.

## Changelog

Every user-visible change adds a line under `## [Unreleased]` in `CHANGELOG.md` (format: [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/), sections Added, Changed, Fixed, Removed). To
release, move those lines to a new `## [X.Y.Z] - date` section and add its compare link at the
bottom. The release workflow publishes that section as the notes of the GitHub release
(`tools/changelog.sh vX.Y.Z` prints it) and stops if the section is missing.

## Steps

1. Update `VERSION` in `compiler/pkg.caju` (it is what `caju version` shows), move the
   `[Unreleased]` lines of `CHANGELOG.md` to the new version, and commit
   (`chore(release): vX.Y.Z`).
2. Run locally: `TAG=v0.2.0 tools/release.sh`. The script runs the JS → stage 1 → 2 → 3 chain,
   requires stage 2 == stage 3, assembles `dist/` and tests the package outside the repository.
3. `git tag v0.2.0 && git push origin main v0.2.0`.
4. The `.github/workflows/release.yml` workflow rebuilds everything, runs the suite and the installer,
   builds `caju-wasm.tar.gz` (the compiler in wasm must compile itself to the same bytes) and
   creates the release with the notes of `CHANGELOG.md`.

The tag must match `VERSION`, or the workflow fails. The installer (`install.sh`, at the root) uses
`releases/latest`, so the new release becomes the default as soon as it is published.

To test the installer without downloading anything:

```sh
CAJU_PACKAGE=dist/caju-linux-x86_64.tar.gz CAJU_HOME=/tmp/c/.caju CAJU_BIN_DIR=/tmp/c/bin sh install.sh
```

## Current limitations

- Linux x86-64 only. The compiler built for Windows (`--target windows compiler/main.caju`) does not
  run there yet (it exits with code 5 right at startup; what the compiler itself uses from the system
  still has to be ported). Programs built for Windows work.
- `caju bench` and the language tests exist only in the repository, not in the package.
