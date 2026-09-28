# Privacy And Data Handling

`codex-multi-auth` is local-first. Every file it owns lives under `~/.codex/multi-auth` (or `CODEX_MULTI_AUTH_DIR` if you override it), with `0600`/`0700` permissions on credential material. There is no telemetry pipeline and no project-run remote service — nothing reports home, because there is no home.

---

## Telemetry

- No analytics, no crash reporting, no usage phone-home.
- No project-owned remote database or dashboard.
- Network calls go only to the endpoints listed below.

---

## What It Stores, And Where

| Data | Default path | Notes |
| --- | --- | --- |
| Account pool | `~/.codex/multi-auth/openai-codex-accounts.json` | V3 JSON, mode `0600`; holds OAuth tokens. Backed by a WAL and rotating `.bak` snapshots |
| Flagged accounts | `~/.codex/multi-auth/openai-codex-flagged-accounts.json` | Accounts sidelined by hard auth failures |
| Settings | `~/.codex/multi-auth/settings.json` | Dashboard + backend config, `.bak` fallback |
| Quota cache | `~/.codex/multi-auth/quota-cache.json` | Cached quota snapshots for fast forecasts |
| Runtime observability | `~/.codex/multi-auth/runtime-observability.json` | Local request counters; feeds `status`/`report` |
| Usage ledger | `~/.codex/multi-auth/usage/usage-ledger.jsonl` | Redacted request metadata: hashed account/email identifiers, no prompts, no auth headers |
| Account policies | `~/.codex/multi-auth/account-policies.json` | Tags, weights, pause/drain, notes — keyed by hashed account identity |
| Budget guards | `~/.codex/multi-auth/budget-guards.json` | Local request/token/cost limits |
| Routing profiles | `~/.codex/multi-auth/routing-profiles.json` | Project-aware preferences, keyed by project identity |
| Bridge client tokens | `~/.codex/multi-auth/local-client-tokens.json` | SHA-256 hashes + prefixes only; plaintext `cma_local_*` tokens show once at creation |
| Refresh leases | `~/.codex/multi-auth/refresh-leases/` | Short-lived cross-process refresh locks |
| Named backups | `~/.codex/multi-auth/backups/` | Operator-exported pool backups |
| Per-project pools | `~/.codex/multi-auth/projects/<project-key>/` | Repo-keyed account pools |
| App bind state | `~/.codex/multi-auth/app-bind/` | Reversible router state, backup metadata, local log |
| App helper status | `~/.codex/multi-auth/runtime-rotation-app-helper*.<pid>.json` | Per-helper status + owner files; cleaned on exit |
| First-run marker | `~/.codex/multi-auth/first-run-setup.json` | One-time setup claim; not a secret |
| Logs | `~/.codex/multi-auth/logs/codex-plugin/` | Optional diagnostics |
| Prompt cache | `~/.codex/multi-auth/cache/` | Cached prompt/template metadata |
| Official Codex state | `~/.codex/auth.json`, `~/.codex/accounts.json`, `~/.codex/config.toml` | Owned by the official CLI; `codex-multi-auth` syncs the active account into `auth.json` |

`CODEX_MULTI_AUTH_DIR` moves every `multi-auth` path above. `CODEX_MULTI_AUTH_CONFIG_PATH` overrides where configuration loads from.

---

## What Leaves The Machine

| Destination | Why |
| --- | --- |
| `auth.openai.com` | OAuth sign-in, device-code flow, token refresh |
| ChatGPT/Codex backend | The requests you make through Codex, carrying the selected account's token |
| GitHub (raw/releases) | Prompt-template sync with ETag caching |
| npm registry | Optional best-effort daily version check during forwarded wrapper startup |

Local listeners — the OAuth callback on `localhost:1455`, the rotation proxy, the app router, and the optional local bridge — are loopback-only. The proxy and router authenticate local clients with a per-process random token and forward upstream; the bridge requires a bearer token.

---

## Tokens And Logs

- Access and refresh tokens exist only in the pool file and the official `~/.codex/auth.json` they sync to.
- Tokens are **never** written to logs. Where a log must identify a token, it prints an 8-character SHA-256 fingerprint — never the value.
- OAuth URLs printed to the terminal redact `state`, `code`, and PKCE parameters. The exception is `--manual` mode, which must print the full URL for you to copy.
- The device-code flow's PKCE verifier is never persisted — it goes straight to the token exchange.
- Usage-ledger rows carry hashed identifiers only: no prompts, no auth headers, no raw account ids.

Optional debug logging:

| Variable | Effect |
| --- | --- |
| `ENABLE_PLUGIN_REQUEST_LOGGING=1` | Log request metadata |
| `CODEX_PLUGIN_LOG_BODIES=1` | Also log raw request/response bodies — these can contain sensitive text; treat the logs as secrets and rotate or delete them as needed |

---

## Data Cleanup

`codex-multi-auth uninstall --clear-accounts` wipes stored credentials as part of a full uninstall. For a manual wipe, delete the files below (adjust for `CODEX_MULTI_AUTH_DIR` if you override the root):

```bash
rm -f ~/.codex/multi-auth/settings.json
rm -f ~/.codex/multi-auth/openai-codex-accounts.json
rm -f ~/.codex/multi-auth/openai-codex-flagged-accounts.json
rm -f ~/.codex/multi-auth/quota-cache.json
rm -f ~/.codex/multi-auth/runtime-observability.json
rm -f ~/.codex/multi-auth/first-run-setup.json
rm -f ~/.codex/multi-auth/config.json
rm -f ~/.codex/multi-auth/account-policies.json
rm -f ~/.codex/multi-auth/routing-profiles.json
rm -f ~/.codex/multi-auth/budget-guards.json
rm -f ~/.codex/multi-auth/local-client-tokens.json
rm -rf ~/.codex/multi-auth/refresh-leases
rm -rf ~/.codex/multi-auth/usage
rm -rf ~/.codex/multi-auth/backups
rm -rf ~/.codex/multi-auth/projects
rm -f ~/.codex/multi-auth/runtime-rotation-app-helper*.json
rm -rf ~/.codex/multi-auth/app-bind
rm -rf ~/.codex/multi-auth/logs/codex-plugin
rm -rf ~/.codex/multi-auth/cache
# Override roots (only if the variables are set):
[ -n "${CODEX_MULTI_AUTH_DIR:-}" ] && rm -rf "$CODEX_MULTI_AUTH_DIR"
[ -n "${CODEX_MULTI_AUTH_CONFIG_PATH:-}" ] && rm -f "$CODEX_MULTI_AUTH_CONFIG_PATH"
```

```powershell
Remove-Item "$HOME\.codex\multi-auth\settings.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\openai-codex-accounts.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\openai-codex-flagged-accounts.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\quota-cache.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\runtime-observability.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\first-run-setup.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\config.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\account-policies.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\routing-profiles.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\budget-guards.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\local-client-tokens.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\refresh-leases" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\usage" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\backups" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\projects" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\runtime-rotation-app-helper*.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\app-bind" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\logs\codex-plugin" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$HOME\.codex\multi-auth\cache" -Recurse -Force -ErrorAction SilentlyContinue
# Override roots (only if the variables are set):
if ($env:CODEX_MULTI_AUTH_DIR) { Remove-Item "$env:CODEX_MULTI_AUTH_DIR" -Recurse -Force -ErrorAction SilentlyContinue }
if ($env:CODEX_MULTI_AUTH_CONFIG_PATH) { Remove-Item "$env:CODEX_MULTI_AUTH_CONFIG_PATH" -Force -ErrorAction SilentlyContinue }
```

For a lighter reset that keeps the ledger, budgets, policies, and backups, see [troubleshooting.md](troubleshooting.md#soft-reset-pool--settings-only).

---

## Policy Responsibility

Your use of OpenAI services is governed by OpenAI's policies:

- https://openai.com/policies/terms-of-use/
- https://openai.com/policies/privacy-policy/

---

## Related

- [configuration.md](configuration.md)
- [troubleshooting.md](troubleshooting.md)
- [reference/storage-paths.md](reference/storage-paths.md)
- [../SECURITY.md](../SECURITY.md)
