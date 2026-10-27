---
title: Automation
nav_order: 9
description: HTTP server, share links, cron jobs, Telegram gateway, and updates
---

# Automation

Run larecode without sitting in front of it: an HTTP server, cron jobs, and a Telegram gateway. Share links hand a finished session to someone else, read-only.

## HTTP server

```bash
larecode serve --port 4096 --token "$LARECODE_SERVER_TOKEN"
```

Bearer-token authenticated JSON API with SSE streaming. Scopes gate what a token can do: `read`, `write`, `run`. Timed-safe token comparison, a request body size limit, and a `/health` endpoint come standard. Without a `--token`, a random one is generated and printed.

## Share links

Turn a session into a read-only web page:

```
POST /sessions/:id/share   ->   { "url": "https://.../share/<token>" }
```

Share tokens are unguessable, stored in `~/.larecode/shares.json` (0600), and revoked by deleting the entry. Secrets are redacted at render time, so a link never exposes keys that were visible in the original session.

## Cron jobs

```bash
larecode cron add "daily at 09:00" "summarize new issues and open a draft PR" --allow shell,network
larecode cron list
larecode cron run <id>
larecode cron start        # run due jobs until interrupted
```

Schedules accept natural phrases (`every 30 minutes`, `weekdays at 9am`) or 5-field cron expressions. Each job records its last result (output tail and exit state) in `~/.larecode/jobs.json` (0600). Jobs are unattended: only groups listed with `--allow` are pre-authorized, and `secrets`/`destructive` are refused at parse time. See [permissions](permissions.md).

## Telegram gateway

```bash
LARECODE_TELEGRAM_TOKEN=... LARECODE_TELEGRAM_CHAT_ID=12345 larecode gateway --allow network
```

Long-polls the Bot API, replies in chunks under the message limit, and keeps one conversation per chat in `~/.larecode/gateway.json` (0600). Commands: `/start`, `/help`, `/new` (fresh session), `/reset`. The allowlist is single-owner by design: the human on the other end is the device owner, and multi-user tenancy is out of scope. `LARECODE_TELEGRAM_API_BASE` points the gateway at a proxy or a local fake for tests.

## Upgrades

```bash
larecode update            # prints upgrade instructions for how you installed
larecode update --check    # report the latest version without instructions
```

Offline runs report `registry check failed (reason)` and exit non-zero, so scripts can detect it.
