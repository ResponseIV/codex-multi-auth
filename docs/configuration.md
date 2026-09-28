# Configuration

Runtime configuration is resolved from unified settings, optional override files, and environment variables.

---

## Canonical Files

| Layer | Path | Purpose |
| --- | --- | --- |
| Unified settings | `~/.codex/multi-auth/settings.json` | Dashboard display and runtime `pluginConfig` |
| Optional config override | `CODEX_MULTI_AUTH_CONFIG_PATH=<path>` | External config file source |
| Root override | `CODEX_MULTI_AUTH_DIR=<path>` | Re-home settings/accounts/cache/log directories |

---

## Settings Shape

```json
{
  "version": 1,
  "dashboardDisplaySettings": {
    "menuAutoFetchLimits": true,
    "menuSortEnabled": true,
    "menuSortMode": "ready-first",
    "menuShowQuotaSummary": true,
    "menuShowQuotaCooldown": true,
    "menuLayoutMode": "compact-details"
  },
  "pluginConfig": {
    "codexMode": true,
    "codexRuntimeRotationProxy": true,
    "liveAccountSync": true,
    "sessionAffinity": true,
    "proactiveRefreshGuardian": true,
    "preemptiveQuotaEnabled": true,
    "fetchTimeoutMs": 60000,
    "streamStallTimeoutMs": 45000
  }
}
```

---

## Resolution Precedence

Runtime config **source selection** is resolved in this order. The persisted object is still named `pluginConfig` for compatibility with earlier releases.

1. File from `CODEX_MULTI_AUTH_CONFIG_PATH` when that env var is set **and the file already exists** (preferred load path; also the save target when set).
2. Unified settings `pluginConfig` from `settings.json` under the multi-auth root (when present and valid).
3. Legacy compatibility config files when unified settings are absent/invalid.
4. Hardcoded defaults in `DEFAULT_PLUGIN_CONFIG`.

After a config source is selected, environment variables override individual runtime settings.
Dashboard display values are resolved from persisted `dashboardDisplaySettings` and then normalized defaults.

Notes:

- A set-but-missing `CODEX_MULTI_AUTH_CONFIG_PATH` is ignored for load until the file is created; the next save still writes to that path when the env var is set.
- `CODEX_MULTI_AUTH_DIR` re-homes multi-auth-owned files. If `CODEX_HOME` is set to a non-default directory, multi-auth resolves strictly to `$CODEX_HOME/multi-auth` without scanning other roots for existing pools.

---

## Stable Environment Overrides

These are safe for most operators and frequently used in day-to-day workflows.

| Variable | Effect |
| --- | --- |
| `CODEX_MULTI_AUTH_DIR` | Override root directory for multi-auth-managed runtime files |
| `CODEX_MULTI_AUTH_CONFIG_PATH` | Load configuration from alternate path |
| `CODEX_MODE=0/1` | Disable or enable Codex mode |
| `CODEX_MULTI_AUTH_RUNTIME_ROTATION_PROXY=0/1` | Opt out/in of live Codex Responses routing through the localhost account-rotation proxy |
| `CODEX_MULTI_AUTH_FORCE_ACCOUNT=<index\|email\|id>` | Force one account for a single forwarded `codex-multi-auth-codex` run (equivalent to the `--account` flag, which wins when both are set). Ephemeral and fail-hard; requires the runtime rotation proxy. See [Force an account for one invocation](reference/commands.md#force-an-account-for-one-invocation) |
| `CODEX_MULTI_AUTH_APP_ROTATION_IDLE_MS=<ms>` | Override idle shutdown for the wrapper-launched Codex app helper |
| `CODEX_MULTI_AUTH_APP_ROTATION_MAX_LIFETIME_MS=<ms>` | Absolute ceiling on a runtime helper's life regardless of activity (default 24h; `0` disables) |
| `CODEX_MULTI_AUTH_APP_ROTATION_DETACHED_IDLE_MS=<ms>` | Idle window that applies once a helper's launcher is gone, nothing is connected, and the helper has never served a request (default 15m; `0` restores the full idle timeout) |
| `CODEX_MULTI_AUTH_APP_BIND=0/1` | Alias-style opt-out for first-run packaged Codex app bind (see also `CODEX_MULTI_AUTH_APP_BIND_INSTALL`) |
| `CODEX_MULTI_AUTH_APP_BIND_INSTALL=0/1` | Opt out/in of packaged Codex app bind self-heal on first durable CLI run or rotation enable |
| `CODEX_MULTI_AUTH_APP_LAUNCHER_INSTALL=0/1` | Opt out/in of supported user-level launcher routing on first durable CLI run or rotation enable |
| `CODEX_TUI_V2=0/1` | Disable or enable TUI v2 |
| `CODEX_TUI_COLOR_PROFILE=truecolor|ansi256|ansi16` | Color profile selection |
| `CODEX_TUI_GLYPHS=ascii|unicode|auto` | Glyph mode selection |
| `CODEX_AUTH_FETCH_TIMEOUT_MS=<ms>` | HTTP request timeout override |
| `CODEX_AUTH_STREAM_STALL_TIMEOUT_MS=<ms>` | Stream stall timeout override |
| `CODEX_AUTH_MIN_ROTATION_INTERVAL_MS=<ms>` | Minimum time between global account switches (default `60000`). The proxy biases selection toward the last-served account within this window to reduce the rate at which different OAuth tokens appear from the same IP. Set to `0` to disable. |
| `CODEX_AUTH_SCHEDULING_STRATEGY=hybrid/sequential` | Account scheduling strategy (default `hybrid`). `sequential` (drain-first) keeps one active account until it is fully exhausted before advancing to the next; see [Sequential / drain-first scheduling](#sequential--drain-first-scheduling). |
| `CODEX_AUTH_TOKEN_INVALIDATION_COOLDOWN_MS=<ms>` | Cooldown applied to an account when the upstream or token-refresh endpoint explicitly revokes its OAuth token (default `300000`, 5 minutes). Raise this if accounts continue to be re-invalidated after re-login. |

---

## Advanced and Internal Overrides

Use these only when debugging, controlled benchmarking, or maintainer workflows.
The complete `pluginConfig` ↔ env accessor matrix is in [development/CONFIG_FIELDS.md](development/CONFIG_FIELDS.md).

| Variable | Effect |
| --- | --- |
| `CODEX_MULTI_AUTH_SYNC_CODEX_CLI` | Force/disable active-account sync into official Codex CLI files |
| `CODEX_MULTI_AUTH_REAL_CODEX_BIN` | Override official Codex binary discovery path (absolute path required) |
| `CODEX_MULTI_AUTH_BYPASS=1` | Skip multi-auth intercept; forward everything to official Codex |
| `CODEX_MULTI_AUTH_FORCE_ACCOUNT_INDEX` | Internal 0-based pin published by the wrapper after `--account` / `CODEX_MULTI_AUTH_FORCE_ACCOUNT` resolution |
| `CODEX_MULTI_AUTH_STATUSLINE=0/1` | Disable/enable forwarded-session status line |
| `CODEX_MULTI_AUTH_AUTO_SYNC_ON_STARTUP=0/1` | Control startup account sync |
| `CODEX_MULTI_AUTH_FORCE_FILE_AUTH_STORE=0/1` | Opt out of the wrapper-injected `-c` file auth store override and the wrapper-startup `config.toml` reconcile |
| `CODEX_MULTI_AUTH_ENFORCE_CLI_FILE_AUTH_STORE=0/1` | Opt out of every persisted `cli_auth_credentials_store = "file"` rewrite in `~/.codex/config.toml` (first-run, switch/login sync, `doctor --fix`) |
| `CODEX_MULTI_AUTH_DEBUG=1` | Verbose wrapper/debug notices |
| `CODEX_AUTH_FAST_SESSION*` | Fast-session trimming knobs |
| `CODEX_AUTH_RETRY_ALL_*` | All-accounts rate-limit wait/retry budgets |
| `CODEX_AUTH_UNSUPPORTED_MODEL_POLICY` / `CODEX_AUTH_FALLBACK_*` | Unsupported Codex model policy |
| `CODEX_AUTH_TOKEN_REFRESH_SKEW_MS` | Refresh-before-expiry skew |
| `CODEX_AUTH_SESSION_RECOVERY` / `CODEX_AUTH_AUTO_RESUME` | Session recovery toggles |
| `CODEX_AUTH_PER_PROJECT_ACCOUNTS` | Project-scoped pools |
| `CODEX_AUTH_PARALLEL_PROBING*` / `CODEX_AUTH_EMPTY_RESPONSE_*` | Probe concurrency and empty-response retries |
| `CODEX_AUTH_RATE_LIMIT_*` | Rate-limit windows, backoff, toast debounce |
| `CODEX_AUTH_LIVE_ACCOUNT_SYNC*` / `CODEX_AUTH_SESSION_AFFINITY*` | Live sync and sticky sessions |
| `CODEX_AUTH_RESPONSE_CONTINUATION` / `CODEX_AUTH_PROACTIVE_GUARDIAN*` / `CODEX_AUTH_PREEMPTIVE_QUOTA_*` | Continuation, guardian, quota deferral |
| `CODEX_AUTH_NETWORK_ERROR_COOLDOWN_MS` / `CODEX_AUTH_SERVER_ERROR_COOLDOWN_MS` | Failure cooldowns |
| `CODEX_AUTH_STORAGE_BACKUP_ENABLED` / `CODEX_AUTH_STORAGE_BACKUP_MIN_INTERVAL_MS` / `CODEX_AUTH_TOAST_DURATION_MS` | Storage backups and toast duration |
| `CODEX_AUTH_PID_OFFSET_ENABLED` / `CODEX_AUTH_ROUTING_MUTEX` / `CODEX_AUTH_BACKGROUND_RESPONSES` | Swarm bias, selection mutex, background Responses |
| `CODEX_CLI_ACCOUNTS_PATH` / `CODEX_CLI_AUTH_PATH` | Override official Codex account/auth file paths |
| `CODEX_AUTH_REFRESH_LEASE*` | Cross-process refresh lease directory/TTL/wait/poll knobs |
| `MCODEX_MONITOR_INTERVAL` / `MCODEX_TMUX_SESSION` / `MCODEX_TMUX_HISTORY_LIMIT` | `mcodex` convenience launcher knobs |
| `CODEX_AUTH_NO_BROWSER` | Suppress browser launch for automation/headless login |

Full inventory: [development/CONFIG_FIELDS.md](development/CONFIG_FIELDS.md)

---

## Recommended Defaults

Keep these enabled for most environments:

- `menuAutoFetchLimits`
- `menuSortEnabled`
- `liveAccountSync`
- `sessionAffinity`
- `proactiveRefreshGuardian`
- `preemptiveQuotaEnabled`

---

## Runtime Rotation Proxy

`codexRuntimeRotationProxy` is enabled by default. When enabled through defaults, settings, `codex-multi-auth rotation enable`, or `CODEX_MULTI_AUTH_RUNTIME_ROTATION_PROXY=1`, the `codex-multi-auth-codex` wrapper starts a localhost-only Responses proxy for forwarded official Codex sessions, including CLI request commands, `codex app-server`, and `codex app` launches through the wrapper. For non-interactive request commands and `codex app`, the wrapper writes a temporary shadow `CODEX_HOME/config.toml` that selects a custom provider named `codex-multi-auth-runtime-proxy`, launches the official Codex surface against that provider, and removes the shadow home after the owning process exits. Interactive TUI sessions (with or without the optional initial prompt), `resume`/`fork`, and `codex app-server` instead stay on the canonical `CODEX_HOME` and receive the same provider through `-c` overrides, which avoids reindexing session history on every launch and leaves the real `config.toml` untouched. Set `codexRuntimeRotationProxy=false`, run `codex-multi-auth rotation disable`, or set `CODEX_MULTI_AUTH_RUNTIME_ROTATION_PROXY=0` to bypass the proxy.

A single forwarded run can be pinned to one account with `codex-multi-auth-codex --account <selector>` (or `CODEX_MULTI_AUTH_FORCE_ACCOUNT`). The pin is applied per-invocation by that run's own proxy instance, so it never touches the persisted `switch` pin and cannot leak across concurrent sessions. Because the proxy is required for the pin to take effect, `--account` fails hard when the proxy is disabled rather than silently using a rotated account. See [Force an account for one invocation](reference/commands.md#force-an-account-for-one-invocation).

The proxy preserves request bodies and streaming responses, replaces outbound auth headers with the selected managed account, and rotates to another account before response bytes are streamed when it sees rate limits, server errors, network failures, or refresh failures. It removes hop-by-hop headers, private account metadata headers, and stale decoded `content-encoding` from client responses. If every account is unavailable, the proxy returns a structured pool-exhaustion error that points to `codex-multi-auth rotation status`.

**Anti-abuse protection.** Rapidly switching OAuth tokens from the same IP can trigger OpenAI's anti-abuse detection and cause accounts to be invalidated in sequence. The proxy includes two mitigations:

- **Token-invalidation detection**: when the upstream or the token-refresh endpoint returns an explicit OAuth revocation message, the proxy returns the error directly to the client instead of rotating to the next account. The affected account receives a 5-minute cooldown (`tokenInvalidationCooldownMs`, default `300000`) instead of the generic 30-second auth-failure cooldown. Configure via `CODEX_AUTH_TOKEN_INVALIDATION_COOLDOWN_MS`.
- **Rotation-rate throttle**: the proxy biases account selection toward the last-served account for a configurable window (default 60 seconds, `minRotationIntervalMs`). Accounts that are rate-limited or cooling down are still rotated around. Configure via `CODEX_AUTH_MIN_ROTATION_INTERVAL_MS` or set to `0` to disable.

### Sequential / drain-first scheduling

`schedulingStrategy` controls how the proxy picks an account for each request:

- `hybrid` (default) spreads load across all available accounts using a weighted health/token/freshness score. Both accounts tend to consume quota at a similar pace.
- `sequential` (drain-first) routes every new request to one active account and only advances to the next available account once the current one is fully exhausted (rate-limited, cooling down, or circuit-open). Because the scan wraps the pool, an earlier account that has recovered its quota window is reclaimed as soon as the current account drains. This staggers quota recovery across accounts for longer uninterrupted sessions.

In `sequential` mode a manual pin (`codex-multi-auth switch <index>`) still takes precedence and is never overridden. Sequential mode intentionally ignores per-session affinity: once the active account changes, all subsequent requests follow the new active account regardless of which account originally handled a conversation. Enable it with `schedulingStrategy: "sequential"` in settings or `CODEX_AUTH_SCHEDULING_STRATEGY=sequential` for a per-process trial.

### Many parallel agents / high concurrency

When you drive many agents in parallel (for example a swarm of deep agents), each is usually a separate `codex-multi-auth-codex` process with its own in-process rotation state. Concentrated load on a small pool causes cascading `429`s. The relevant knobs:

- `pidOffsetEnabled` (default `true`, env `CODEX_AUTH_PID_OFFSET_ENABLED`): gives each process a small deterministic account-selection bias so separate processes prefer different accounts instead of all selecting the same one. This is the primary lever for the multi-process swarm case and is on by default; it is a no-op for single-account pools, and a manual pin plus health/quota scoring still take precedence over the small offset. Set `false` (or `CODEX_AUTH_PID_OFFSET_ENABLED=0`) to force every process to score accounts identically.
- `retryAllAccountsRateLimited` (default `false`), with `retryAllAccountsMaxRetries` (default `0`) and `retryAllAccountsMaxWaitMs` (default `0`): when every account is momentarily rate-limited, wait for the soonest quota window and retry instead of returning pool-exhaustion immediately. Keep the retry/wait budgets bounded so a blocking wait does not exceed the host client's own request timeout.
- `routingMutex` (default `legacy`, env `CODEX_AUTH_ROUTING_MUTEX`): set to `enabled` to serialize account selection *within a single process*. It has no effect across separate agent processes.

The structural fix is more accounts: with N accounts and M ≫ N concurrent agents, roughly `M/N` agents share each account, so rate-limit pressure only drops as N grows. See [High parallelism / swarms of agents](troubleshooting.md#high-parallelism--swarms-of-agents) for the full playbook, including the host-client-side `Provider response headers timed out after 10000ms` timeout (which this plugin cannot change).

Microsoft/Outlook SSO accounts may be more sensitive to proxy-mediated token use. If an Outlook-linked account is invalidated on every first request through the proxy but works normally on ChatGPT web, the root cause is likely IP or device binding on the Microsoft side. Raising `CODEX_AUTH_TOKEN_INVALIDATION_COOLDOWN_MS` and re-logging in the affected account typically resolves the cascade. If the problem persists, consider excluding the Microsoft account from the rotation pool via `codex-multi-auth switch`.

For `codex app` launches that go through the wrapper, the wrapper automatically starts a small internal helper so rotation can keep working if the desktop app launcher detaches. The helper stores only local runtime status, uses the same per-session proxy client key as the CLI path, and exits after an idle timeout.

`codex-multi-auth rotation enable` also binds the packaged desktop app to a persistent localhost router. This backs up the real Codex `config.toml`, writes the `codex-multi-auth-runtime-proxy` provider into the real Codex home, starts the router immediately, and installs a user login startup entry: a Startup `.cmd` on Windows or a LaunchAgent on macOS. The persistent provider is marked as not requiring OpenAI auth and uses a local app-bind client token, so the desktop runtime does not display the selected multi-auth account while codex-multi-auth status and quota views still read the router's last-account telemetry. `codex-multi-auth rotation disable` and `codex-multi-auth rotation unbind-app` stop that router, remove the startup entry, and restore the backed-up Codex config. The official app files are not patched.

Package install scripts stay side-effect-free (postinstall prints a short notice only). First-run self-heal of desktop defaults runs once on a durable global install when you invoke `codex-multi-auth ...`, and again as needed from `codex-multi-auth rotation enable`:

- The official CLI credential store is pinned to `cli_auth_credentials_store = "file"` in `~/.codex/config.toml`, so front-ends that exec the official binary directly stop triggering macOS login-keychain prompts. Set `CODEX_MULTI_AUTH_ENFORCE_CLI_FILE_AUTH_STORE=0` to skip.
- Packaged Codex app bind is repaired when a Codex desktop app is detected. Set `CODEX_MULTI_AUTH_APP_BIND=0` or `CODEX_MULTI_AUTH_APP_BIND_INSTALL=0` to skip, or `CODEX_MULTI_AUTH_APP_BIND_INSTALL=1` to force it.
- Supported user-level launcher routing is installed for global installs. Set `CODEX_MULTI_AUTH_APP_LAUNCHER_INSTALL=0` to skip shortcut routing, or run `codex-multi-auth-app-launcher --remove` to restore backed-up Windows shortcuts or remove the managed macOS wrapper later.
- The one-time claim is recorded at `~/.codex/multi-auth/first-run-setup.json`. `npx` and project-local installs skip first-run setup so they do not consume the marker. An existing marker from before the auth-store step is migrated in place, replaying only that step — app bind and launcher install are not rerun.
- Installed wrappers may perform a best-effort daily npm version check during normal forwarded Codex startup. When npm has a newer release, the wrapper only prints a manual notice: `npm install -g codex-multi-auth@latest`. It never runs npm install or update commands for you. Notices are shown only on a TTY or when `CODEX_MULTI_AUTH_DEBUG=1`.

Some Windows installs expose Codex only as a packaged `shell:AppsFolder` app entry. Those entries cannot be retargeted like `.lnk` files, so the persistent app bind is the supported path for making the pinned packaged app use rotation automatically.

---

## Shipped Templates

The shipped config templates expose first-class current OpenAI model aliases:

- both templates lead with GPT-6 Astra: `gpt-6-astra` and the long-horizon `gpt-6-astra-aeon`. Bare `gpt-6` and `astra` resolve to the flagship, `astra-aeon` to the long-horizon variant. Astra takes the same reasoning ladder as GPT-5.6 (`low` through `max`, plus `ultra`) and rejects `none`/`minimal`, which are coerced up to `low`
- both templates also list GPT-6 Sol (`gpt-6-sol`, the everyday workhorse) and GPT-6 Luna (`gpt-6-luna`, the small, cheap tier), added to the upstream Codex catalog on 2026-09-22. Sol takes `low` through `ultra`; Luna stops at `max`, the same split as the 5.6 tiers. Both default to `medium`. There is no GPT-6 Terra: an id such as `gpt-6-terra` resolves to Sol, which is where upstream Codex migrates `gpt-5.6-terra` users. Bare `sol` and `luna` are not aliases for the GPT-6 tiers
- any GPT-6 id the alias table does not name resolves to Astra rather than falling back to GPT-5.5, unless it carries a `sol` or `luna` tier token, which picks that tier (`gpt-6-sol-2026-09-22` stays on Sol). That covers the `gpt-6-astra-pro` plan tier, dated snapshots such as `gpt-6-astra-2026-09-03`, and tiers added after this release. An id carrying `aeon` stays on `gpt-6-astra-aeon`, because it is a different model rather than a rename of the flagship
- the Daybreak cyber models (`gpt-daybreak-blue-latest`, `gpt-daybreak-red-latest`, shorthand `daybreak-blue` / `daybreak-red`) resolve to their own ids but are not listed in the templates, matching their hidden visibility in the upstream Codex picker. An unrecognised Daybreak id resolves to `blue`, the defensive variant
- both `config/codex-modern.json` and `config/codex-legacy.json` include the GPT-5.6 tiers (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`), plus `gpt-5.5` and `gpt-5.5-pro`. The modern template collapses each tier's efforts into `variants`; the legacy template lists one entry per effort (for example `gpt-5.6-sol-high`) for Codex builds that predate the `variants` picker
- GPT-5.6 adds two reasoning tiers above `xhigh`: `max`, and `ultra` on Sol/Terra only. `ultra` selects Codex's automatic subagent delegation and is sent to the API as `max`, mirroring upstream Codex
- no GPT-5.6 tier accepts `none` or `minimal` reasoning effort; requests using them are coerced up to `low`
- `gpt-5.6` on its own resolves to Sol, the flagship tier; the legacy `gpt-5` alias still resolves to `gpt-5.5`
- retired models are gone from both templates and no longer run under their own names. Every model older than GPT-5.5 is retired: the codex models and the `*-chat-latest` snapshots are past their shutdown date on OpenAI's deprecations page, `gpt-5.1`, `gpt-5.2`, `gpt-5.4` and `gpt-5.4-mini` left the upstream Codex catalog (`gpt-5.4` with `retirement_at: 2026-08-31`), and the `gpt-5-mini`/`gpt-5-nano` snapshots shut down on 2026-12-11. Their ids, with or without an effort suffix, stay accepted as aliases of the replacement OpenAI names:

  | Retired id | Now runs as |
  | --- | --- |
  | `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.2-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `codex-max`, `gpt-5-codex`, any other id containing `codex` | `gpt-5.6-sol` |
  | `gpt-5.1-codex-mini`, `gpt-5-codex-mini`, `codex-mini-latest` | `gpt-5.6-terra` |
  | `gpt-5.4` | `gpt-6-sol` |
  | `gpt-5.4-mini`, `gpt-5.4-nano` | `gpt-6-luna` |
  | `gpt-5.4-pro`, `gpt-5.2-pro` | `gpt-5.5-pro` |
  | `gpt-5.2`, `gpt-5.1`, `gpt-5-chat-latest`, `gpt-5.1-chat-latest`, `gpt-5.2-chat-latest`, `gpt-5.3-chat-latest` | `gpt-5.6-sol` |
  | `gpt-5-mini` | `gpt-5.6-terra` |
  | `gpt-5-nano` | `gpt-5.6-luna` |

- because codex ids now run on `gpt-5.6-sol`, they use the `gpt-5.2` prompt family and rotation bucket like every other live model. A per-family account assignment saved under `gpt-5-codex`, `codex-max` or `gpt-5.1` is no longer consulted
- a retired id sent through the pass-through rotation proxy still reaches the backend under its old name; the unsupported-model chain carries one hop from each retired id to its replacement, so that response turns into a working request. `gpt-5.5` and `gpt-5.5-pro` are the floor of every walk, since `gpt-5.4` is no longer served
- `fallbackToGpt52OnUnsupportedGpt53` is kept for config compatibility but has no effect: it only gated the `gpt-5.3-codex` to `gpt-5.2-codex` hop, and both models are retired
- GPT-6 Astra has its own entry in that chain: `gpt-6-astra` steps to `gpt-5.6-sol`, `gpt-5.6-sol` steps to `gpt-5.5`, and `gpt-6-astra-aeon` steps to `gpt-6-astra` first. `gpt-6-sol` steps to `gpt-5.6-sol` and `gpt-6-luna` to `gpt-5.6-luna`, then on to `gpt-5.5`; neither steps sideways into Astra. Astra rolls out org by org, so an account without entitlement gets a real unsupported-model response for it. It never fires pre-emptively, only after that response
- the two paths gate it differently, which is easy to get wrong. In the plugin-host runtime the chain applies only when `fallbackOnUnsupportedCodexModel` is on, and it defaults to `false`. The `codex-multi-auth-codex` wrapper has always retried unconditionally on an unsupported-model response from the real Codex CLI, with no setting to consult; it prints `model <name> is unsupported on this ChatGPT Codex surface. Retrying with <fallback>.` to stderr each time
- the chain is walked one hop at a time: each unsupported response resolves from the model that just failed, not from the one you originally asked for. A model with no entry of its own ends the walk, which is why `gpt-5.6-sol` and `gpt-5.6-luna` carry one. The `gpt-5.6-luna` row is new with GPT-6 Luna, so a direct `gpt-5.6-luna` request that gets an unsupported-model response now retries on `gpt-5.5` (higher per-token price) where it used to stop. `unsupportedCodexFallbackChain` overrides follow the same rule, so a multi-hop path needs an entry per hop
- depth costs attempts. Every hop spends one of the shared per-request outbound attempts, and a single-account balanced session has a budget of 5. The longest walk (`gpt-6-astra-aeon` through to `gpt-5.5`) uses 4, leaving one attempt for a retry or stream failover; spend two and the last hop is unreachable, ending in an attempt-budget-exhausted 503. That needs an account entitled to none of aeon, Astra or 5.6 Sol

---

## Validate Effective Configuration

```bash
codex-multi-auth status
codex-multi-auth list
codex-multi-auth check
codex-multi-auth forecast --live
```

---

## Related

- [reference/settings.md](reference/settings.md)
- [reference/storage-paths.md](reference/storage-paths.md)
- [upgrade.md](upgrade.md)
- [development/CONFIG_FLOW.md](development/CONFIG_FLOW.md)
