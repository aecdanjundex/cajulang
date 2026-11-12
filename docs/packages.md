# Packages (`caju pkg`)

A Caju package is a GitHub repository with a `caju.toml` at its root. The package name is the
repository path, which is also what programs import:

```caju
import "github.com/acme/strutil"            # the package's main file
import "github.com/acme/strutil/extra"      # another file in the package (extra.caju)

print(strutil.shout("oi"))
```

## `caju.toml`: the manifest

Every package, and every project that uses packages, has a `caju.toml` ([TOML](https://toml.io)):

```toml
[package]
name = "github.com/acme/greet"     # required: github.com/owner/repository
version = "0.3.0"                  # semantic version MAJOR.MINOR.PATCH
description = "Saudações"
license = "MIT"
authors = ["Acme"]
entry = "greet.caju"               # optional; default: <repository name>.caju
caju = "0.1.0"                     # optional; minimum compiler version

[dependencies]
"github.com/acme/strutil" = "1.1.0"   # the MINIMUM version this package needs
```

## Publishing a version

1. Set `version` in `caju.toml` (e.g. `1.2.0`).
2. Commit, and create a tag with the same number prefixed by `v`: `git tag v1.2.0 && git push --tags`.

The manager checks that tag `vX.Y.Z` has `version = "X.Y.Z"` in its `caju.toml`; if it doesn't, the
package is rejected. A published version must not change: if the tag is moved to another commit,
anyone who already has a `caju.lock` gets an error.

## Commands

```sh
caju pkg init [github.com/dono/repo]   # creates caju.toml (with no name: uses the git origin remote)
caju pkg add github.com/acme/greet     # latest published version; or ...@0.2.0
caju pkg remove github.com/acme/greet
caju pkg update [nome]                 # moves dependencies to their latest published version
caju pkg install                       # downloads what is missing and checks everything against caju.lock
caju pkg verify                        # checks the cached packages against the hashes in the lock
caju pkg tree                          # dependency tree
caju pkg hash [dir]                    # the hash of a package directory
```

`add`, `remove` and `update` edit only the `[dependencies]` section of `caju.toml` (comments and the
rest of the file are left as they are) and, if the installation fails, restore the file to what it was.

## Recursive dependencies and version selection

`install` reads the project's dependencies, downloads each one, reads its `caju.toml` and follows
its dependencies, and so on. When two packages ask for different versions of the same package, the
**highest of the requested minimum versions** wins (*minimal version selection*, as in Go):

```
app      needs greet ≥ 0.3.0 and strutil ≥ 1.0.0
greet    needs strutil ≥ 1.1.0
→ greet 0.3.0, strutil 1.1.0
```

The result does not change when someone publishes a new version: it only changes when a `caju.toml`
asks for a higher version. Versions with different MAJOR numbers (1.x and 2.x) are not compatible:
asking for both is an error.

## `caju.lock`: versions and hashes

`install` writes `caju.lock`, which pins every package used (direct or indirect):

```toml
version = 1
requires = ["github.com/acme/greet@0.3.0"]   # the caju.toml dependencies when the lock was made

[[package]]
name = "github.com/acme/strutil"
version = "1.1.0"
source = "https://github.com/acme/strutil"
commit = "f24b50965ae800cdfeef2d9f9bc3e21f5e12d6a3"
hash = "sha256:fe890cc2d93fc5890a50a22d1d8638543b47e2e3e7953481fa272bb6120c1531"
dependencies = []
```

Commit `caju.lock`. With it, everyone compiles exactly the same files.

**The hash** is computed over the files, not over git: for each file in the package (in path order,
excluding `.git`), the line `<sha256 of the contents>  <path>`; the package hash is the SHA-256 of
that list. A symbolic link counts as the text `symlink <target>`. The same contents always give the
same hash, on any machine.

**The checks:**

| when | what is checked |
|---|---|
| `install` / `add` downloading a package | the tag's commit and the file hash match `caju.lock` (if the package is already in it) |
| `install` with the package already cached | the hash of the cached files matches `caju.lock` |
| `caju build` / `caju run` | `caju.lock` is up to date with `caju.toml`, and the hash of each cached package matches the lock |
| `caju pkg verify` | the hash of each cached package, with a report |

Any mismatch is an error, with both hashes (or commits) in the message.

## Where the files live

- Cache: `$CAJU_HOME/pkg/<name>@<version>/` (default `~/.caju/pkg`), with `<name>@<version>.info`
  holding the commit.
- Download: `git clone --depth 1 --branch vX.Y.Z https://github.com/dono/repo`. `git` must be
  installed. `CAJU_PKG_SOURCE=/caminho` replaces `https://` with a local directory or mirror
  (`/caminho/github.com/dono/repo`); the tests use this.

## Rules for package code

- Inside a package, files import each other by their full path:
  `import "github.com/acme/strutil/extra"`, not `import "extra"`. The compiler gives a clear error
  if a package file uses a relative path.
- The standard library is imported as usual (`import "std/strings"`).
- A package should only import the packages listed in its `[dependencies]`.
