# Nightly test run with retries

Cron jobs are managed by the CLI, not by a JSON file. These commands add an unattended job that runs the test suite every night, retries transient failures up to 3 times, and fails after 30 minutes.

```bash
larecode cron add "nightly-tests" \
  --schedule "0 2 * * *" \
  --prompt "Run the test suite, fix only test failures that are safe to fix, then re-run until green." \
  --policy read,write,shell \
  --retries 3 \
  --timeout 1800000
```

```bash
larecode cron list
larecode cron logs nightly-tests
larecode cron run nightly-tests
```

The gateway and cron surfaces run with explicit pre-authorized groups only; anything else is denied.
