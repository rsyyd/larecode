---
title: Install options
parent: Getting started
nav_order: 1
description: npm, curl installer, Homebrew, Scoop, PKGBUILD, and manual binary installs
---

# Install options

The same larecode binary is available through several package managers and as a direct download. Pick one, then run `larecode setup` once.

| Platform | Options                                      |
| -------- | -------------------------------------------- |
| Linux    | npm, curl, Homebrew, PKGBUILD, manual binary |
| macOS    | npm, curl, Homebrew, manual binary           |
| Windows  | npm, Scoop, manual binary                    |

## npm

```bash
npm install -g larecode
```

Requires Node 20+.

## curl (Linux and macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/rsyyd/larecode/main/install.sh | sh
```

The script detects your OS and architecture, downloads the matching binary from the latest GitHub release into `~/.local/bin`, and verifies it runs before moving it into place. Optional environment variables:

| Variable                | Default            | Purpose                          |
| ----------------------- | ------------------ | -------------------------------- |
| `LARECODE_INSTALL_DIR`  | `$HOME/.local/bin` | where the binary is placed       |
| `LARECODE_SHA256`       | unset              | verified against the download    |
| `LARECODE_INSTALL_BASE` | latest release URL | mirror or pin a specific version |

Every release publishes a `checksums.txt` asset with the SHA-256 of each binary, so you can pin `LARECODE_SHA256` to the matching line.

## Homebrew (macOS and Linux)

```bash
brew tap rsyyd/larecode
brew install larecode
```

The formula installed by the tap is generated from the release binaries on every tagged release.

## Scoop (Windows)

```powershell
scoop bucket add larecode https://github.com/rsyyd/larecode-scoop
scoop install larecode
```

## Arch Linux (PKGBUILD)

```bash
curl -fsSLO https://github.com/rsyyd/larecode/releases/latest/download/PKGBUILD
makepkg -si
```

The release PKGBUILD pins the checksums and installs the prebuilt binary for x86_64 or aarch64. An AUR package is prepared and will be published once AUR registration reopens.

## Manual

Download the binary for your platform from [releases](https://github.com/rsyyd/larecode/releases): `larecode-linux-x64`, `larecode-linux-arm64`, `larecode-darwin-x64`, `larecode-darwin-arm64`, or `larecode-windows-x64.exe`. Then:

```bash
chmod +x larecode-linux-x64
mv larecode-linux-x64 ~/.local/bin/larecode
```

## First run

```bash
larecode setup --provider openai-compatible --base-url http://localhost:20128/v1
larecode doctor
larecode run "explain this repository"
```

`setup` writes `~/.larecode/config.json` (owner-only). `doctor` verifies the configuration, provider reachability, and permissions. Update later with `larecode update`.

## Uninstall

Delete the binary and, if you want a clean slate, `~/.larecode` (config, sessions, cron jobs, gateway mappings).
