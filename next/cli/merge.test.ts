import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from '#lib/doc/parse.ts';
import { createDocument, listMerged, writeDecision, type Decision } from '#lib/store/store.ts';

const CLI = fileURLToPath(new URL('./index.js', import.meta.url));
const MOCKUP = fileURLToPath(new URL('../../docs/mockup/', import.meta.url));
const REPO = 'glw907/workstation';

// Serves `repo view` from repo.json (a default of main), `pr view <n>` from pr-<n>.json, and
// `pr merge <n>` unless merge-fails-<n> exists. Every call is logged.
const STUB = `#!/usr/bin/env bash
dir=$(dirname "$0")
printf '%s\\n' "gh $*" >>"$dir/gh.log"
case "$1 $2" in
  "repo view")
    if [ -e "$dir/repo.json" ]; then cat "$dir/repo.json"; else echo '{"defaultBranchRef":{"name":"main"}}'; fi ;;
  "pr view")
    [ -e "$dir/pr-$3.json" ] || { echo "no pull requests found for #$3" >&2; exit 1; }
    cat "$dir/pr-$3.json" ;;
  "pr merge")
    if [ -e "$dir/merge-fails-$3" ]; then echo "GraphQL: Head branch was modified" >&2; exit 1; fi ;;
  *) echo "unexpected gh call" >&2; exit 1 ;;
esac
`;

const PASSED = [{ name: 'gate', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const HEADS = [
	{ repo: REPO, number: 233, head: 'aaa233' },
	{ repo: REPO, number: 234, head: 'bbb234' }
];
const view = (head: string, over: object = {}) => ({
	state: 'OPEN',
	isDraft: false,
	headRefOid: head,
	baseRefName: 'main',
	statusCheckRollup: PASSED,
	...over
});

let dir: string;
let state: string;
let root: string;

function serve(number: number, body: object) {
	writeFileSync(join(dir, `pr-${number}.json`), JSON.stringify(body));
}

function run(...args: string[]) {
	const result = spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		env: { ...process.env, APPROVAL_QUEUE_STATE: state, PATH: `${dir}:${process.env.PATH}` }
	});
	return { code: result.status, out: result.stdout, err: result.stderr };
}

const ghLog = () => (existsSync(join(dir, 'gh.log')) ? readFileSync(join(dir, 'gh.log'), 'utf8') : '');
const merges = () => ghLog().split('\n').filter((l) => l.startsWith('gh pr merge'));

/** Stores a mockup document and its records, written with `writeDecision`. */
function stored(file: string, records: Decision[]): string {
	const source = readFileSync(join(MOCKUP, 'content', file), 'utf8');
	const { doc } = parse(source);
	const id = createDocument(root, source, { kind: doc.kind as string, title: doc.title }).id;
	for (const record of records) writeDecision(root, id, record);
	return id;
}

const at = () => new Date().toISOString();
const approve = (): Decision => ({ action: 'approve', at: at(), heads: HEADS });
const handed = (n = 1): Decision => ({ action: 'handed', at: at(), decision: n });

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'aq-merge-'));
	state = join(dir, 'state');
	root = join(state, 'store');
	mkdirSync(state);
	writeFileSync(join(dir, 'gh'), STUB);
	chmodSync(join(dir, 'gh'), 0o755);
	serve(233, view('aaa233'));
	serve(234, view('bbb234'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('merge', () => {
	it('merges each pull request at the head Geoff read, in order, and records each', () => {
		const id = stored('20-survey-edit.md', [approve(), handed()]);
		const { code, out } = run('merge', id);
		expect(code).toBe(0);
		expect(merges()).toEqual([
			`gh pr merge 233 --repo ${REPO} --merge --match-head-commit aaa233`,
			`gh pr merge 234 --repo ${REPO} --merge --match-head-commit bbb234`
		]);
		expect(out.trim().split('\n')).toHaveLength(2);
		expect(out).toContain(`${REPO}#233`);
		const lines = listMerged(root).lines;
		expect(lines.map((l) => l.number).sort()).toEqual([233, 234]);
		expect(lines.find((l) => l.number === 233)?.sentence).toBe('the packet skill, updated for rounds');
	});

	it('exits 2 and merges neither when the second head moved after the approve', () => {
		const id = stored('20-survey-edit.md', [approve(), handed()]);
		serve(234, view('ccc999'));
		const { code, err } = run('merge', id);
		expect(code).toBe(2);
		expect(err).toContain(`${REPO}#234`);
		expect(err).toContain('ccc999');
		expect(merges()).toEqual([]);
		expect(listMerged(root).lines).toEqual([]);
	});

	it('says nothing more was merged when a rerun skips one already merged, then refuses', () => {
		const id = stored('20-survey-edit.md', [approve(), handed()]);
		serve(233, view('aaa233', { state: 'MERGED' }));
		serve(234, view('ccc999'));
		const { code, err } = run('merge', id);
		expect(code).toBe(2);
		expect(err).toContain('nothing more was merged');
		expect(merges()).toEqual([]);
	});

	it('names the second pull request when GitHub refuses its merge, and the first stays merged', () => {
		const id = stored('20-survey-edit.md', [approve(), handed()]);
		writeFileSync(join(dir, 'merge-fails-234'), '');
		const { code, err, out } = run('merge', id);
		expect(code).toBe(2);
		expect(err).toContain(`${REPO}#234`);
		expect(err).toContain('Head branch was modified');
		expect(merges()).toHaveLength(2);
		expect(out).toContain(`${REPO}#233`);
		expect(listMerged(root).lines.map((l) => l.number)).toEqual([233]);
	});

	it('goes on from a part-way failure, skipping the one already merged', () => {
		const id = stored('20-survey-edit.md', [approve(), handed()]);
		writeFileSync(join(dir, 'merge-fails-234'), '');
		run('merge', id);
		rmSync(join(dir, 'merge-fails-234'));
		rmSync(join(dir, 'gh.log'));
		serve(233, view('aaa233', { state: 'MERGED' }));
		const { code } = run('merge', id);
		expect(code).toBe(0);
		expect(merges()).toEqual([`gh pr merge 234 --repo ${REPO} --merge --match-head-commit bbb234`]);
		expect(listMerged(root).lines.map((l) => l.number).sort()).toEqual([233, 234]);
	});

	it('refuses one merged at a head other than the one Geoff read', () => {
		const id = stored('20-survey-edit.md', [approve(), handed()]);
		serve(233, view('ddd000', { state: 'MERGED' }));
		const { code, err } = run('merge', id);
		expect(code).toBe(2);
		expect(err).toContain(`${REPO}#233`);
		expect(merges()).toEqual([]);
	});

	it('refuses a pull request off the default branch, naming it', () => {
		const id = stored('20-survey-edit.md', [approve(), handed()]);
		serve(234, view('bbb234', { baseRefName: 'next' }));
		const { code, err } = run('merge', id);
		expect(code).toBe(2);
		expect(err).toContain(`${REPO}#234`);
		expect(err).toContain('next');
		expect(merges()).toEqual([]);
	});

	it('refuses a failing check and a pending one, merging nothing', () => {
		const id = stored('20-survey-edit.md', [approve(), handed()]);
		serve(234, view('bbb234', { statusCheckRollup: [{ name: 'gate', status: 'COMPLETED', conclusion: 'FAILURE' }] }));
		expect(run('merge', id).code).toBe(2);
		serve(234, view('bbb234', { statusCheckRollup: [{ name: 'gate', status: 'IN_PROGRESS' }] }));
		const pending = run('merge', id);
		expect(pending.code).toBe(2);
		expect(pending.err).toContain('still running');
		expect(merges()).toEqual([]);
	});

	it('refuses a pull request GitHub cannot read, naming it', () => {
		const id = stored('20-survey-edit.md', [approve(), handed()]);
		rmSync(join(dir, 'pr-234.json'));
		const { code, err } = run('merge', id);
		expect(code).toBe(2);
		expect(err).toContain(`${REPO}#234`);
		expect(merges()).toEqual([]);
	});

	it('refuses a decided document not yet handed over', () => {
		const id = stored('20-survey-edit.md', [approve()]);
		const { code, err } = run('merge', id);
		expect(code).toBe(2);
		expect(err).toContain('handed');
		expect(ghLog()).toBe('');
	});

	it('refuses a send-back', () => {
		const id = stored('20-survey-edit.md', [{ action: 'sendback', at: at() }, handed()]);
		const { code, err } = run('merge', id);
		expect(code).toBe(2);
		expect(err).toContain('sent back');
		expect(ghLog()).toBe('');
	});

	it('refuses a report, and a document that is not a merge', () => {
		const report = stored('30-round-report.md', [{ action: 'read', at: at() }]);
		expect(run('merge', report).code).toBe(2);
		const design = stored('40-queue-design.md', [{ action: 'approve', at: at() }, handed()]);
		const { code, err } = run('merge', design);
		expect(code).toBe(2);
		expect(err).toContain('not a merge document');
		expect(ghLog()).toBe('');
	});

	it('refuses an approve that carries no heads', () => {
		const id = stored('20-survey-edit.md', [{ action: 'approve', at: at() }, handed()]);
		expect(run('merge', id).code).toBe(2);
		expect(ghLog()).toBe('');
	});

	it('exits 1 on an id with no document, and prints the usage with no id', () => {
		const none = run('merge', '20260101-000000-abcdef');
		expect(none.code).toBe(1);
		expect(none.err).toContain('20260101-000000-abcdef');
		const bare = run('merge');
		expect(bare.code).toBe(2);
		expect(bare.err).toContain('merge <id>');
		expect(bare.err).toMatch(/^usage: approval-queue check\|send <doc\.md>/);
	});
});
