import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fc } from "./setup.js";
import {
	deduplicateAccounts,
	loadAccounts,
	normalizeAccountStorage,
	saveAccounts,
	setStoragePathDirect,
	type AccountMetadataV3,
	type AccountStorageV3,
} from "../../lib/storage.js";
import { MODEL_FAMILIES } from "../../lib/request/helpers/model-map.js";
import { removeWithRetry } from "../helpers/remove-with-retry.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ACCOUNT_ID_SOURCES = ["token", "id_token", "org", "manual"] as const;
const COOLDOWN_REASONS = [
	"auth-failure",
	"network-error",
	"server-error",
	"rate-limit",
] as const;
const SWITCH_REASONS = [
	"rate-limit",
	"initial",
	"rotation",
	"best",
	"restore",
	"manual",
] as const;

const arbTimestamp = fc.integer({ min: 0, max: 4_000_000_000_000 });

const arbNonBlank = fc
	.string({ minLength: 1, maxLength: 24 })
	.filter((value) => value.trim().length > 0);

const arbWorkspace = fc.record({
	id: arbNonBlank,
	name: fc.option(fc.string({ maxLength: 24 }), { nil: undefined }),
	enabled: fc.boolean(),
	disabledAt: fc.option(arbTimestamp, { nil: undefined }),
	isDefault: fc.option(fc.boolean(), { nil: undefined }),
});

// A schema-shaped V3 account. Identity facets are uniquified afterwards so
// generated pools can be split into "distinct-identity" storages (where the
// field-preservation invariants apply) or left colliding (for dedup/idempotency).
const arbAccountCore = fc.record({
	recordId: fc.option(arbNonBlank, { nil: undefined }),
	accountId: fc.option(arbNonBlank, { nil: undefined }),
	accountIdSource: fc.option(fc.constantFrom(...ACCOUNT_ID_SOURCES), {
		nil: undefined,
	}),
	accountLabel: fc.option(fc.string({ maxLength: 24 }), { nil: undefined }),
	email: fc.option(arbNonBlank, { nil: undefined }),
	// Required, non-blank: accounts without one are dropped by normalize.
	refreshToken: arbNonBlank,
	accessToken: fc.option(fc.string({ maxLength: 24 }), { nil: undefined }),
	expiresAt: fc.option(arbTimestamp, { nil: undefined }),
	enabled: fc.option(fc.boolean(), { nil: undefined }),
	addedAt: arbTimestamp,
	lastUsed: arbTimestamp,
	lastSwitchReason: fc.option(fc.constantFrom(...SWITCH_REASONS), {
		nil: undefined,
	}),
	// Non-empty numeric entries: the three-way merge recomputes the map as
	// max-per-key, so {} / undefined-valued entries are rewritten rather than
	// preserved (see mergeRuntimeAccount in lib/storage/snapshot-merge.ts).
	rateLimitResetTimes: fc.option(
		fc.dictionary(fc.constantFrom(...MODEL_FAMILIES), arbTimestamp, {
			minKeys: 1,
		}),
		{ nil: undefined },
	),
	coolingDownUntil: fc.option(arbTimestamp, { nil: undefined }),
	cooldownReason: fc.option(fc.constantFrom(...COOLDOWN_REASONS), {
		nil: undefined,
	}),
	// Must be finite + positive to survive normalize; invalid values are
	// dropped together with the error code by design.
	authInvalidatedAt: fc.option(fc.integer({ min: 1, max: 4_000_000_000_000 }), {
		nil: undefined,
	}),
	authInvalidationErrorCode: fc.option(arbNonBlank, { nil: undefined }),
	workspaces: fc.option(fc.array(arbWorkspace, { maxLength: 3 }), {
		nil: undefined,
	}),
	currentWorkspaceIndex: fc.option(fc.nat(2), { nil: undefined }),
	codexCliMirror: fc.option(
		fc.record({ forAccountId: arbNonBlank, accountId: arbNonBlank }),
		{ nil: undefined },
	),
});

// Post-process a generated account so every present identity facet is unique
// across the pool (index-suffixed). Distinct facets guarantee the identity
// matcher can never merge two generated records.
function uniquifyAccountFacets(
	account: Record<string, unknown>,
	index: number,
): Record<string, unknown> {
	const next = { ...account };
	if (typeof next.accountId === "string") next.accountId = `${next.accountId}-a${index}`;
	if (typeof next.email === "string") next.email = `${next.email}-a${index}`;
	if (typeof next.refreshToken === "string") {
		next.refreshToken = `${next.refreshToken}-r${index}`;
	}
	if (typeof next.recordId === "string") next.recordId = `${next.recordId}-i${index}`;
	if (Array.isArray(next.workspaces)) {
		next.workspaces = next.workspaces.map((workspace, workspaceIndex) => {
			const record = workspace as Record<string, unknown>;
			return { ...record, id: `${String(record.id)}-a${index}w${workspaceIndex}` };
		});
		// mergeWorkspaces resolves currentWorkspaceIndex by workspace id and
		// re-points it at the first enabled workspace when the chosen one is
		// disabled. Only pin the index to an enabled workspace (or omit it) so
		// the merge is the identity function on equal inputs.
		const workspaces = next.workspaces as Array<{ enabled: boolean }>;
		const cwi = next.currentWorkspaceIndex;
		if (
			typeof cwi !== "number" ||
			cwi >= workspaces.length ||
			workspaces[cwi]?.enabled === false
		) {
			const firstEnabled = workspaces.findIndex((w) => w.enabled !== false);
			if (firstEnabled >= 0) {
				next.currentWorkspaceIndex = firstEnabled;
			} else {
				delete next.currentWorkspaceIndex;
			}
		}
	}
	// normalizeAccountStorage deletes authInvalidatedAt AND its error code
	// together whenever the timestamp is absent or not finite-positive — the
	// code is metadata about the timestamp and is meaningless alone.
	const invalidatedAt = next.authInvalidatedAt;
	if (
		typeof invalidatedAt !== "number" ||
		!Number.isFinite(invalidatedAt) ||
		invalidatedAt <= 0
	) {
		delete next.authInvalidatedAt;
		delete next.authInvalidationErrorCode;
	}
	return next;
}

const arbDistinctAccount = arbAccountCore;

const arbActiveIndexByFamily = fc.dictionary(
	fc.constantFrom(...MODEL_FAMILIES),
	fc.integer({ min: 0, max: 20 }),
	{ maxKeys: MODEL_FAMILIES.length },
);

const arbStorageV3 = fc
	.record({
		version: fc.constant(3 as const),
		accounts: fc.array(arbDistinctAccount, { maxLength: 8 }),
		activeIndex: fc.integer({ min: 0, max: 20 }),
		activeIndexByFamily: fc.option(arbActiveIndexByFamily, { nil: undefined }),
		pinnedAccountIndex: fc.option(fc.integer({ min: 0, max: 20 }), {
			nil: undefined,
		}),
		affinityGeneration: fc.option(
			fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
			{ nil: undefined },
		),
	})
	.map((storage) => ({
		...storage,
		accounts: storage.accounts.map((account, index) =>
			uniquifyAccountFacets(account as Record<string, unknown>, index),
		),
	}));

// A noisier sibling: colliding identity facets, junk index values, and V1
// inputs exercise migration + dedup + clamping; the invariant under test is
// only that normalize is a fixpoint, never field preservation.
// Sparse records that only carry a subset of identity facets; a small shared
// pool so identities actually collide and exercise the merge/veto tiers.
const arbSparseAccount = fc.record({
	accountId: fc.option(fc.constantFrom("id-a", "id-b", "id-c"), {
		nil: undefined,
	}),
	email: fc.option(
		fc.constantFrom("x@y.test", "X@Y.TEST", " x@y.test ", "p@q.test"),
		{ nil: undefined },
	),
	refreshToken: fc.option(fc.constantFrom("rt-1", "rt-2", "rt-3", " "), {
		nil: undefined,
	}),
	addedAt: arbTimestamp,
	lastUsed: arbTimestamp,
});

const arbNoisyStorage = fc.constantFrom(1, 3).chain((version) =>
	fc.record({
		version: fc.constant(version),
		accounts: fc.array(
			version === 1
				? // V1 junk rows must stay OBJECTS: migrateV1ToV3 currently throws
					// on null/undefined entries (a real crash — pinned separately in
					// the .fails regression below), so null stays V3-only until that
					// bug is fixed rather than silently hiding it here.
					fc.oneof(
						arbAccountCore,
						arbSparseAccount,
						fc.constantFrom(42, "junk", [], {}),
					)
				: fc.oneof(
						arbAccountCore,
						arbSparseAccount,
						fc.constantFrom(null, 42, "junk", [], {}),
					),
			{ maxLength: 8 },
		),
	activeIndex: fc.oneof(
		fc.integer({ min: -10, max: 40 }),
		fc.double({ min: -1e6, max: 1e6, noNaN: true }),
		fc.constant(Number.NaN),
	),
	activeIndexByFamily: fc.option(
		fc.dictionary(
			fc.constantFrom(...MODEL_FAMILIES, "bogus-family"),
			fc.oneof(
				fc.integer({ min: -10, max: 40 }),
				fc.constant(1.5),
				fc.constant("nope"),
			),
			{ maxKeys: MODEL_FAMILIES.length + 1 },
		),
		{ nil: undefined },
	),
	pinnedAccountIndex: fc.option(
		fc.oneof(
			fc.integer({ min: -5, max: 30 }),
			fc.constant(2.5),
			fc.constant("zero"),
		),
		{ nil: undefined },
	),
	affinityGeneration: fc.option(
		fc.oneof(
			fc.integer({ min: -5, max: Number.MAX_SAFE_INTEGER }),
			fc.constant(1.5),
			fc.constant(Number.POSITIVE_INFINITY),
		),
		{ nil: undefined },
	),
	}),
);

// ---------------------------------------------------------------------------
// Expected-normalization helpers (mirror lib/storage.ts semantics so the
// "no field silently dropped" assertions check exact values, not just types)
// ---------------------------------------------------------------------------

function clampIndex(index: number, length: number): number {
	if (length <= 0) return 0;
	if (Number.isNaN(index)) return 0;
	return Math.max(0, Math.min(Math.trunc(index), length - 1));
}

const jsonRoundtrip = <T>(value: T): T =>
	JSON.parse(JSON.stringify(value)) as T;

// load→save→load goes through mergeAccountSnapshot, which deliberately treats
// `enabled: true` and an absent flag identically ("omitted and true both mean
// enabled; serialization does not express a user edit"), and never persists
// the load-time restore* annotations (`fields()` in snapshot-merge.ts excludes
// them, and load re-derives them for empty storages anyway). Canonicalize
// those documented, non-durable differences so the fixpoint compares
// everything else verbatim.
function canonicalizeForMerge(storage: AccountStorageV3): AccountStorageV3 {
	const clone = structuredClone(storage) as AccountStorageV3 & {
		restoreEligible?: boolean;
		restoreReason?: string;
	};
	delete clone.restoreEligible;
	delete clone.restoreReason;
	for (const account of clone.accounts) {
		if (account.enabled !== false) delete account.enabled;
	}
	return clone as AccountStorageV3;
}

const tempDirs: string[] = [];
function freshTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "cma-prop-storage-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	setStoragePathDirect(null);
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await removeWithRetry(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("normalizeAccountStorage properties", () => {
	// REAL BUG (surfaced by this suite on its first run):
	// migrateV1ToV3 in lib/storage/migrations.ts maps over v1.accounts reading
	// account.rateLimitResetTime without an isRecord guard, so a V1 file whose
	// accounts array contains a null/undefined entry makes
	// normalizeAccountStorage THROW a TypeError instead of returning null or a
	// filtered storage. The V3 path (validAccounts .filter(isRecord …)) drops
	// the same junk row gracefully, so corrupt V1 files are strictly less
	// resilient than corrupt V3 files: the throw escapes normalize, propagates
	// through loadAccountsFromPath, and in loadAccountsInternal it is caught as
	// a generic read failure — the whole file is then treated as unreadable and
	// the caller loses every account where V3 would have recovered the good
	// rows. Pinned as .fails per suite policy: this must not pass until the
	// migration gains a null-safe map.
	it.fails(
		"V1 storage with a null account entry must not throw (migrateV1ToV3 crash)",
		() => {
			expect(() =>
				normalizeAccountStorage({
					version: 1,
					accounts: [
						{ refreshToken: "rt-ok", addedAt: 1, lastUsed: 1 },
						null,
						{ refreshToken: "rt-ok-2", addedAt: 2, lastUsed: 2 },
					],
					activeIndex: 0,
				}),
			).not.toThrow();
		},
	);

	it("is a fixpoint on arbitrary V1/V3-shaped input (N(N(x)) === N(x))", () => {
		fc.assert(
			fc.property(arbNoisyStorage, (raw) => {
				const once = normalizeAccountStorage(structuredClone(raw));
				if (once === null) return;
				expect(normalizeAccountStorage(structuredClone(once))).toEqual(once);
			}),
		);
	});

	it("never grows the account array and only emits valid records", () => {
		fc.assert(
			fc.property(arbNoisyStorage, (raw) => {
				const normalized = normalizeAccountStorage(structuredClone(raw));
				if (normalized === null) return;
				const validInput = (raw.accounts as unknown[]).filter(
					(account) =>
						account !== null &&
						typeof account === "object" &&
						typeof (account as { refreshToken?: unknown }).refreshToken ===
							"string" &&
						(account as { refreshToken: string }).refreshToken.trim()
							.length > 0,
				);
				expect(normalized.accounts.length).toBeLessThanOrEqual(
					validInput.length,
				);
				for (const account of normalized.accounts) {
					expect(typeof account.refreshToken).toBe("string");
					expect(account.refreshToken.trim().length).toBeGreaterThan(0);
				}
				expect(normalized.activeIndex).toBeLessThanOrEqual(
					Math.max(0, normalized.accounts.length - 1),
				);
				expect(normalized.activeIndex).toBeGreaterThanOrEqual(0);
			}),
		);
	});

	it("deduplicateAccounts is a non-growing fixpoint on storage-shaped pools", () => {
		fc.assert(
			fc.property(arbNoisyStorage, (raw) => {
				const pool = (raw.accounts as unknown[]).filter(
					(account): account is AccountMetadataV3 =>
						account !== null && typeof account === "object",
				);
				const deduplicated = deduplicateAccounts([...pool]);
				expect(deduplicated.length).toBeLessThanOrEqual(pool.length);
				for (const account of deduplicated) {
					expect(pool).toContain(account);
				}
				expect(deduplicateAccounts([...deduplicated])).toStrictEqual(
					deduplicated,
				);
			}),
		);
	});

	it("drops no schema field for valid inputs with distinct identities", () => {
		fc.assert(
			fc.property(arbStorageV3, (raw) => {
				const input = jsonRoundtrip(raw);
				const normalized = normalizeAccountStorage(structuredClone(input));
				expect(normalized).not.toBeNull();
				const result = normalized as AccountStorageV3;

				// Distinct identity facets make merging impossible: every account
				// survives verbatim and in order.
				expect(result.accounts.length).toBe(input.accounts.length);
				for (let index = 0; index < input.accounts.length; index += 1) {
					expect(result.accounts[index]).toEqual(input.accounts[index]);
				}

				// Index fields resolve to the same slots the input pointed at.
				const expectedActive = clampIndex(
					input.activeIndex,
					input.accounts.length,
				);
				expect(result.activeIndex).toBe(expectedActive);
				for (const family of MODEL_FAMILIES) {
					const familyRaw =
						input.activeIndexByFamily?.[family] ?? input.activeIndex;
					expect(result.activeIndexByFamily?.[family]).toBe(
						clampIndex(familyRaw, input.accounts.length),
					);
				}

				if (input.pinnedAccountIndex !== undefined) {
					const valid =
						input.pinnedAccountIndex >= 0 &&
						Number.isInteger(input.pinnedAccountIndex) &&
						input.pinnedAccountIndex < result.accounts.length;
					expect(result.pinnedAccountIndex).toBe(
						valid ? input.pinnedAccountIndex : undefined,
					);
				}
				if (input.affinityGeneration !== undefined) {
					expect(result.affinityGeneration).toBe(input.affinityGeneration);
				}
			}),
		);
	});
});

describe("account storage disk round-trip", () => {
	it("save→load→save→load is a fixpoint for valid V3 storage", async () => {
		await fc.assert(
			fc.asyncProperty(arbStorageV3, async (raw) => {
				const dir = freshTempDir();
				setStoragePathDirect(join(dir, "accounts.json"));

				await saveAccounts(jsonRoundtrip(raw) as AccountStorageV3);
				const first = await loadAccounts();
				expect(first).not.toBeNull();

				await saveAccounts(first as AccountStorageV3);
				const second = await loadAccounts();
				expect(second).not.toBeNull();

				expect(canonicalizeForMerge(second as AccountStorageV3)).toEqual(
					canonicalizeForMerge(first as AccountStorageV3),
				);
			}),
		);
	});

	it("load after save preserves every schema field for distinct-identity accounts", async () => {
		await fc.assert(
			fc.asyncProperty(arbStorageV3, async (raw) => {
				const dir = freshTempDir();
				setStoragePathDirect(join(dir, "accounts.json"));
				const input = jsonRoundtrip(raw) as AccountStorageV3;

				await saveAccounts(input);
				const loaded = await loadAccounts();
				expect(loaded).not.toBeNull();
				const result = loaded as AccountStorageV3;

				expect(result.accounts.length).toBe(input.accounts.length);
				for (let index = 0; index < input.accounts.length; index += 1) {
					expect(result.accounts[index]).toEqual(input.accounts[index]);
				}
				expect(result.activeIndex).toBe(
					clampIndex(input.activeIndex, input.accounts.length),
				);
			}),
		);
	});
});
