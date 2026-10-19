# Install

Four ways in, all landing on the same binary. After installing, run `larecode setup` once, then `larecode setup` output tells you the next command. Total time from a cold machine is under a minute on a normal connection.

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

| Variable               | Default            | Purpose                       |
| ---------------------- | ------------------ | ----------------------------- |
| `LARECODE_INSTALL_DIR` | `$HOME/.local/bin` | where the binary is placed    |
| `LARECODE_SHA256`      | unset              | verified against the download |

Every release publishes a `checksums.txt` asset with the SHA-256 of each binary, so you can pin `LARECODE_SHA256` to the matching line.
| `LARECODE_INSTALL_BASE` | latest release URL | mirror or pin a specific version |

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

## Arch Linux (AUR)

```bash
yay -S larecode
```

## Manual

Download the binary for your platform from [releases](https://github.com/rsyyd/larecode/releases), then:

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
