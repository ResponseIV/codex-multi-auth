import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { saveAccounts, setStoragePathDirect } from "../lib/storage.js";
import { getAccountPolicyKey, saveAccountPolicyStore, upsertAccountPolicy, type AccountPolicyStore } from "../lib/account-policy.js";
import { createAutomaticSubscriptionCheck } from "../lib/runtime/automatic-subscription-checks.js";
import * as tokenRefresh from "../lib/runtime/rotation-token-refresh.js";
import { removeWithRetry } from "./helpers/remove-with-retry.js";
const { probe, saveQuota } = vi.hoisted(() => ({ probe: vi.fn(), saveQuota: vi.fn() }));
vi.mock("../lib/quota-cache.js", () => ({ loadQuotaCache: async () => ({ byAccountId: {}, byEmail: {} }), saveQuotaCache: saveQuota }));
vi.mock("../lib/quota-probe.js", () => ({ fetchCodexQuotaSnapshot: probe }));
let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(join(tmpdir(), "subscription-checks-")); vi.stubEnv("CODEX_MULTI_AUTH_DIR", dir); setStoragePathDirect(join(dir, "accounts.json")); saveQuota.mockReset(); probe.mockReset().mockResolvedValue({ status: 200, model: "fixture", primary: { usedPercent: 0 }, secondary: { usedPercent: 0 }, primingCompleted: true }); });
afterEach(async () => { vi.restoreAllMocks(); setStoragePathDirect(null); vi.unstubAllEnvs(); await removeWithRetry(dir, { recursive: true, force: true }); });
it("automatically enables first-use completion only for the opted-in saved subscription binding", async () => {
    const account = { recordId: "fixture", accountId: "personal", refreshToken: "fixture-refresh", accessToken: "fixture-access", expiresAt: Date.now() + 3600000, addedAt: 1, lastUsed: 1, workspaces: [{ id: "personal", enabled: true }, { id: "other", enabled: true }] };
    await saveAccounts({ version: 3, activeIndex: 0, accounts: [account] });
    const policies: AccountPolicyStore = { version: 1, accounts: {} };
    upsertAccountPolicy(policies, getAccountPolicyKey(account), p => { p.autoPrime = true; });
    await saveAccountPolicyStore(policies);
    const observed = vi.fn();
    const run = createAutomaticSubscriptionCheck(observed);
    await run(new AbortController().signal);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0]?.[0]).toMatchObject({ accountId: "personal", accessToken: "fixture-access", primeUnusedSubscription: true });
    expect(observed).toHaveBeenCalledTimes(1);
});
it("does not prime a disabled saved workspace even when a sibling is enabled", async () => {
    const account = { recordId: "fixture", accountId: "personal", refreshToken: "fixture-refresh", accessToken: "fixture-access", expiresAt: Date.now() + 3600000, addedAt: 1, lastUsed: 1, workspaces: [{ id: "personal", enabled: false }, { id: "other", enabled: true }] };
    await saveAccounts({ version: 3, activeIndex: 0, accounts: [account] });
    const policies: AccountPolicyStore = { version: 1, accounts: {} };
    upsertAccountPolicy(policies, getAccountPolicyKey(account), p => { p.autoPrime = true; });
    await saveAccountPolicyStore(policies);
    await createAutomaticSubscriptionCheck(vi.fn())(new AbortController().signal);
    expect(probe).not.toHaveBeenCalled();
});

it("does not probe credentials replaced while refreshing the saved account", async () => {
    const account = { recordId: "fixture", accountId: "personal", refreshToken: "fixture-refresh", accessToken: "fixture-access", expiresAt: Date.now() + 3600000, addedAt: 1, lastUsed: 1 };
    await saveAccounts({ version: 3, activeIndex: 0, accounts: [account] });
    const policies: AccountPolicyStore = { version: 1, accounts: {} };
    upsertAccountPolicy(policies, getAccountPolicyKey(account), p => { p.autoPrime = true; });
    await saveAccountPolicyStore(policies);
    vi.spyOn(tokenRefresh, "ensureFreshAccessToken").mockImplementationOnce(async ({ account: live }) => {
        await saveAccounts({ version: 3, activeIndex: 0, accounts: [{ ...account, refreshToken: "replacement-refresh", accessToken: "replacement-access" }] });
        return { ok: true, account: live, accessToken: "fixture-access" };
    });
    await createAutomaticSubscriptionCheck(vi.fn())(new AbortController().signal);
    expect(probe).not.toHaveBeenCalled();
});

async function selectedPersonalFixture() {
    const accounts = [0, 1].map(i => ({ recordId: `record-${i}`, accountId: "shared-org", email: `fixture-${i}@example.test`, refreshToken: `refresh-${i}`, accessToken: `access-${i}`, expiresAt: Date.now() + 3600000, addedAt: 1, lastUsed: 1, currentWorkspaceIndex: 1, workspaces: [{ id: "shared-org", name: "Organization", enabled: true }, { id: `personal-${i}`, name: "Personal", enabled: true }] }));
    const storage = { version: 3 as const, activeIndex: 0, accounts };
    await saveAccounts(storage);
    const policies: AccountPolicyStore = { version: 1, accounts: {} };
    for (const account of accounts) upsertAccountPolicy(policies, getAccountPolicyKey(account), p => { p.autoPrime = true; });
    await saveAccountPolicyStore(policies);
    return storage;
}
it("primes both selected Personal workspaces when credentials share an organization binding", async () => {
    await selectedPersonalFixture();
    const before = await fs.readFile(join(dir, "accounts.json"), "utf8");
    await createAutomaticSubscriptionCheck()(new AbortController().signal);
    expect(probe.mock.calls.map(call => call[0].accountId)).toEqual(["personal-0", "personal-1"]);
    expect(probe.mock.calls.map(call => call[0].accessToken)).toEqual(["access-0", "access-1"]);
    expect(await fs.readFile(join(dir, "accounts.json"), "utf8")).toBe(before);
    expect(saveQuota.mock.calls.map(call => Object.keys(call[0].byAccountId))).toEqual([["personal-0"], ["personal-1"]]);
    expect(saveQuota.mock.calls.every(call => Object.keys(call[0].byEmail).length === 0)).toBe(true);
});
it("does not fall back to the organization when the selected Personal workspace is disabled", async () => {
    const storage = await selectedPersonalFixture();
    for (const account of storage.accounts) account.workspaces[1]!.enabled = false;
    await saveAccounts(storage);
    await createAutomaticSubscriptionCheck(vi.fn())(new AbortController().signal);
    expect(probe).not.toHaveBeenCalled();
});
it("revalidates the selected workspace after token refresh", async () => {
    const storage = await selectedPersonalFixture();
    vi.spyOn(tokenRefresh, "ensureFreshAccessToken").mockImplementation(async ({ account }) => {
        storage.accounts[account.index]!.currentWorkspaceIndex = 0;
        await saveAccounts(storage);
        return { ok: true, account, accessToken: account.access! };
    });
    await createAutomaticSubscriptionCheck(vi.fn())(new AbortController().signal);
    expect(probe).not.toHaveBeenCalled();
});

it("does not probe a selected workspace disabled during refresh", async () => {
    const storage = await selectedPersonalFixture();
    vi.spyOn(tokenRefresh, "ensureFreshAccessToken").mockImplementation(async ({ account }) => {
        storage.accounts[account.index]!.workspaces[1]!.enabled = false;
        await saveAccounts(storage);
        return { ok: true, account, accessToken: account.access! };
    });
    await createAutomaticSubscriptionCheck(vi.fn())(new AbortController().signal);
    expect(probe).not.toHaveBeenCalled();
});
it("uses the stored binding only when no workspace selection metadata exists", async () => {
    const storage = await selectedPersonalFixture();
    storage.accounts.forEach(account => { account.workspaces = []; });
    await saveAccounts(storage);
    await createAutomaticSubscriptionCheck(vi.fn())(new AbortController().signal);
    expect(probe.mock.calls.map(call => call[0].accountId)).toEqual(["shared-org", "shared-org"]);
});
