import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { removeWithRetry } from "./helpers/remove-with-retry.js";

describe("routing profiles", () => {
	let tempDir: string;
	let projectDir: string;
	let originalDir: string | undefined;

	beforeEach(async () => {
		originalDir = process.env.CODEX_MULTI_AUTH_DIR;
		tempDir = await fs.mkdtemp(join(tmpdir(), "codex-routing-profiles-"));
		projectDir = join(tempDir, "project");
		await fs.mkdir(projectDir, { recursive: true });
		await fs.writeFile(join(projectDir, "package.json"), "{}", "utf8");
		process.env.CODEX_MULTI_AUTH_DIR = join(tempDir, "multi-auth");
	});

	afterEach(async () => {
		if (originalDir === undefined) {
			delete process.env.CODEX_MULTI_AUTH_DIR;
		} else {
			process.env.CODEX_MULTI_AUTH_DIR = originalDir;
		}
		await removeWithRetry(tempDir, { recursive: true, force: true });
	});

	it("resolves profile identity through existing project storage helpers", async () => {
		const {
			createDefaultRoutingProfile,
			loadRoutingProfileStore,
			resolveProjectRoutingProfile,
			saveRoutingProfileStore,
			upsertRoutingProfile,
		} = await import("../lib/routing-profiles.js");

		const initial = await resolveProjectRoutingProfile(projectDir);
		expect(initial.projectRoot).toBe(projectDir);
		expect(initial.identityRoot).toBe(projectDir);
		expect(initial.projectKey).toMatch(/^project-/);
		expect(initial.profile).toBeNull();

		const store = await loadRoutingProfileStore();
		const profile = createDefaultRoutingProfile({
			projectKey: initial.projectKey!,
			projectName: "project",
			identityRoot: initial.identityRoot!,
			now: 100,
		});
		upsertRoutingProfile(
			store,
			profile,
			(next) => {
				next.preferredTags.push("Team A");
				next.modelAllowlist.push("GPT-5.3-Codex");
				next.accountWeightByKey["sha256:abc"] = 3;
				next.budgetKey = "default";
			},
			200,
		);
		await saveRoutingProfileStore(store);

		const resolved = await resolveProjectRoutingProfile(projectDir);
		expect(resolved.profile).toMatchObject({
			projectKey: initial.projectKey,
			preferredTags: ["team a"],
			modelAllowlist: ["gpt-5.3-codex"],
			accountWeightByKey: { "sha256:abc": 3 },
			budgetKey: "default",
			updatedAt: 200,
		});
	});

	it("re-applies update mutations over the freshest profile store", async () => {
		const {
			createDefaultRoutingProfile,
			loadRoutingProfileStore,
			resolveProjectRoutingProfile,
			updateRoutingProfileStore,
			upsertRoutingProfile,
		} = await import("../lib/routing-profiles.js");
		const { projectKey, identityRoot } =
			await resolveProjectRoutingProfile(projectDir);
		await updateRoutingProfileStore((store) => ({
			result: upsertRoutingProfile(
				store,
				createDefaultRoutingProfile({
					projectKey: projectKey!,
					projectName: "project",
					identityRoot: identityRoot!,
					now: 100,
				}),
				(next) => {
					next.preferredTags.push("team");
				},
				100,
			),
			dirty: true,
		}));
		const loaded = await loadRoutingProfileStore();
		expect(loaded.profiles[projectKey!]).toMatchObject({
			preferredTags: ["team"],
			updatedAt: 100,
		});
	});

	it("returns null profile when no profile is stored for the project", async () => {
		const { resolveProjectRoutingProfile } = await import(
			"../lib/routing-profiles.js"
		);
		const context = await resolveProjectRoutingProfile(projectDir);
		expect(context.projectKey).toMatch(/^project-/);
		expect(context.profile).toBeNull();
	});

	it("stores profiles keyed by Object.prototype member names without loss", async () => {
		// Profile keys are caller/project-derived strings; "constructor" and
		// "__proto__" are valid values (crafted store file or literal upsert).
		// On plain-object maps an absent "constructor" read resolves the
		// inherited Object function and looked "present" to the merge — the
		// incoming profile was silently dropped — while a "__proto__" write hit
		// the setter and mutated the prototype. Regression: these must behave
		// like ordinary keys end-to-end.
		const {
			createDefaultRoutingProfile,
			loadRoutingProfileStore,
			saveRoutingProfileStore,
			upsertRoutingProfile,
		} = await import("../lib/routing-profiles.js");

		const first = await loadRoutingProfileStore();
		upsertRoutingProfile(
			first,
			createDefaultRoutingProfile({
				projectKey: "constructor",
				projectName: "crafted",
				identityRoot: projectDir,
				now: 100,
			}),
			undefined,
			100,
		);
		await saveRoutingProfileStore(first);

		const loaded = await loadRoutingProfileStore();
		expect(Object.hasOwn(loaded.profiles, "constructor")).toBe(true);
		expect(loaded.profiles.constructor?.projectName).toBe("crafted");

		// A merge keyed on the same name must not mistake the inherited member
		// for an existing entry — the newer updatedAt must win. (upsert mutates
		// the existing profile when the key is present, so the rename goes
		// through `mutate`.)
		const second = await loadRoutingProfileStore();
		upsertRoutingProfile(
			second,
			createDefaultRoutingProfile({
				projectKey: "constructor",
				projectName: "ignored-when-existing",
				identityRoot: projectDir,
				now: 200,
			}),
			(next) => {
				next.projectName = "crafted-newer";
			},
			200,
		);
		await saveRoutingProfileStore(second);
		const merged = await loadRoutingProfileStore();
		expect(merged.profiles.constructor?.projectName).toBe("crafted-newer");
		expect(merged.profiles.constructor?.updatedAt).toBe(200);

		// "__proto__" must land as an own property — not a prototype mutation.
		const protoStore = await loadRoutingProfileStore();
		upsertRoutingProfile(
			protoStore,
			createDefaultRoutingProfile({
				projectKey: "__proto__",
				projectName: "proto-key",
				identityRoot: projectDir,
			}),
		);
		expect(Object.hasOwn(protoStore.profiles, "__proto__")).toBe(true);
		await saveRoutingProfileStore(protoStore);
		expect(
			(await loadRoutingProfileStore()).profiles["__proto__"]?.projectName,
		).toBe("proto-key");
	});
});
