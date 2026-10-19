# Install

Four ways in, all landing on the same binary. After installing, run `lumpscode setup` once, then `lumpscode setup` output tells you the next command. Total time from a cold machine is under a minute on a normal connection.

## npm

```bash
npm install -g lumpscode
```

Requires Node 20+.

## curl (Linux and macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/rsyyd/lumpscode/main/install.sh | sh
```

The script detects your OS and architecture, downloads the matching binary from the latest GitHub release into `~/.local/bin`, and verifies it runs before moving it into place. Optional environment variables:

| Variable                 | Default            | Purpose                          |
| ------------------------ | ------------------ | -------------------------------- |
| `LUMPSCODE_INSTALL_DIR`  | `$HOME/.local/bin` | where the binary is placed       |
| `LUMPSCODE_SHA256`       | unset              | verified against the download    |
| `LUMPSCODE_INSTALL_BASE` | latest release URL | mirror or pin a specific version |

## Homebrew (macOS and Linux)

```bash
brew tap rsyyd/lumpscode
brew install lumpscode
```

The formula installed by the tap is generated from the release binaries on every tagged release.

## Scoop (Windows)

```powershell
scoop bucket add lumpscode https://github.com/rsyyd/lumpscode-scoop
scoop install lumpscode
```

## Arch Linux (AUR)

```bash
yay -S lumpscode
```

## Manual

Download the binary for your platform from [releases](https://github.com/rsyyd/lumpscode/releases), then:

```bash
chmod +x lumpscode-linux-x64
mv lumpscode-linux-x64 ~/.local/bin/lumpscode
```

## First run

```bash
lumpscode setup --provider openai-compatible --base-url http://localhost:20128/v1
lumpscode doctor
lumpscode run "explain this repository"
```

`setup` writes `~/.lumpscode/config.json` (owner-only). `doctor` verifies the configuration, provider reachability, and permissions. Update later with `lumpscode update`.

## Uninstall

Delete the binary and, if you want a clean slate, `~/.lumpscode` (config, sessions, cron jobs, gateway mappings).
