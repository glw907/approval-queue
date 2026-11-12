import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from '#lib/doc/parse.ts';
import { createDocument, listMerged, writeDecision } from '#lib/store/store.ts';

const CLI = fileURLToPath(new URL('./index.js', import.meta.url));
const MOCKUP = fileURLToPath(new URL('../../docs/mockup/', import.meta.url));
const REF = 'aq-fixture/app#7';
const HEAD = 'abc123def456';

// Serves `repo view` from repo.json (a default of main), `pr view <n>` from pr-<n>.json (then pr-<n>.2.json once
// the first was read), and `pr merge` unless merge-fails exists. Every call is logged.
const STUB = `#!/usr/bin/env bash
dir=$(dirname "$0")
printf '%s\\n' "gh $*" >>"$dir/gh.log"
case "$1 $2" in
  "repo view")
    if [ -e "$dir/repo.json" ]; then cat "$dir/repo.json"; else echo '{"defaultBranchRef":{"name":"main"}}'; fi ;;
  "pr view")
    n=$3
    if [ -e "$dir/pr-$n.2.json" ] && [ -e "$dir/read-$n" ]; then cat "$dir/pr-$n.2.json"; else touch "$dir/read-$n"; cat "$dir/pr-$n.json"; fi ;;
  "pr merge")
    if [ -e "$dir/merge-fails" ]; then echo "GraphQL: head moved" >&2; exit 1; fi ;;
  *) echo "unexpected gh call" >&2; exit 1 ;;
esac
`;

const PASSED = [{ name: 'gate', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const view = (over: object = {}) => ({
	state: 'OPEN',
	isDraft: false,
	headRefOid: HEAD,
	body: 'A small fix.',
	baseRefName: 'main',
	statusCheckRollup: PASSED,
	...over
});

let dir: string;
let state: string;
let root: string;

function serve(file: string, body: object) {
	writeFileSync(join(dir, file), JSON.stringify(body));
}

function run(args: string[], extra: Record<string, string> = {}) {
	const result = spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		env: { ...process.env, APPROVAL_QUEUE_STATE: state, PATH: `${dir}:${process.env.PATH}`, ...extra }
	});
	return { code: result.status, out: result.stdout, err: result.stderr };
}

const ghLog = () => (existsSync(join(dir, 'gh.log')) ? readFileSync(join(dir, 'gh.log'), 'utf8') : '');
const merges = () => ghLog().split('\n').filter((l) => l.startsWith('gh pr merge'));
const land = (extra: Record<string, string> = {}) => run(['land', REF, 'Fixes a typo.'], extra);

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'aq-land-'));
	state = join(dir, 'state');
	root = join(state, 'store');
	mkdirSync(state);
	writeFileSync(join(dir, 'gh'), STUB);
	chmodSync(join(dir, 'gh'), 0o755);
	serve('pr-7.json', view());
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('land', () => {
	it('merges a clean pull request at its head and records the sentence', () => {
		const { code } = land();
		expect(code).toBe(0);
		expect(merges()).toEqual([`gh pr merge 7 --repo aq-fixture/app --merge --match-head-commit ${HEAD}`]);
		const { lines } = listMerged(root);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ repo: 'aq-fixture/app', number: 7, sentence: 'Fixes a typo.' });
	});

	it('refuses a failing check, naming it, and merges nothing', () => {
		serve('pr-7.json', view({ statusCheckRollup: [{ name: 'gate', status: 'COMPLETED', conclusion: 'FAILURE' }] }));
		const { code, err } = land();
		expect(code).toBe(2);
		expect(err).toContain('the check "gate" failed');
		expect(merges()).toEqual([]);
		expect(listMerged(root).lines).toEqual([]);
	});

	for (const [label, over] of [
		['merged', { state: 'MERGED' }],
		['closed', { state: 'CLOSED' }],
		['a draft', { isDraft: true }],
		['off the default branch', { baseRefName: 'next' }],
		['carrying a Before merge section', { body: 'Text.\n\n## Before merge\n\nRun a step.' }]
	] as const) {
		it(`refuses a pull request that is ${label}`, () => {
			serve('pr-7.json', view(over));
			const { code } = land();
			expect(code).toBe(2);
			expect(merges()).toEqual([]);
		});
	}

	it('refuses while checks stay pending, and merges when they finish after the first poll', () => {
		serve('pr-7.json', view({ statusCheckRollup: [{ name: 'gate', status: 'IN_PROGRESS' }] }));
		const began = Date.now();
		const slow = land({ APPROVAL_QUEUE_POLL_S: '1', APPROVAL_QUEUE_POLL_MAX_S: '2' });
		expect(Date.now() - began).toBeLessThan(10_000);
		expect(slow.code).toBe(2);
		expect(slow.err).toContain('still has checks pending');
		expect(merges()).toEqual([]);
		rmSync(join(dir, 'read-7'));
		serve('pr-7.2.json', view());
		const done = land({ APPROVAL_QUEUE_POLL_S: '1', APPROVAL_QUEUE_POLL_MAX_S: '5' });
		expect(done.code).toBe(0);
		expect(merges()).toHaveLength(1);
	}, 30_000);

	it('refuses a pull request in a waiting document until its decision is handed over', () => {
		const source = readFileSync(join(MOCKUP, 'content/10-merge-gaps.md'), 'utf8');
		const id = createDocument(root, source, { kind: 'merge', title: parse(source).doc.title }).id;
		const ref = 'glw907/workstation#230';
		serve('pr-230.json', view());
		const held = run(['land', ref, 'Fixes it.']);
		expect(held.code).toBe(2);
		expect(held.err).toContain(id);
		expect(ghLog()).toBe('');
		const at = new Date().toISOString();
		writeDecision(root, id, { action: 'approve', at });
		writeDecision(root, id, { action: 'handed', at, decision: 1 });
		expect(run(['land', ref, 'Fixes it.']).code).toBe(0);
		expect(merges()).toHaveLength(1);
	});

	it('exits 1 with the error from gh when the merge fails', () => {
		writeFileSync(join(dir, 'merge-fails'), '');
		const { code, err } = land();
		expect(code).toBe(1);
		expect(err).toContain('head moved');
		expect(listMerged(root).lines).toEqual([]);
	});

	it('prints the usage for a bad ref, a blank sentence, and a third argument', () => {
		for (const args of [['land', 'not-a-ref', 'x'], ['land', REF, '   '], ['land', REF, 'x', 'y'], ['land', REF]]) {
			const { code, err } = run(args);
			expect(code).toBe(2);
			expect(err).toContain('usage: approval-queue');
		}
		expect(ghLog()).toBe('');
	});
});
