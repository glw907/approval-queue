import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from '#lib/doc/parse.ts';
import { createDocument, listDocuments, readDecisions, readDocument, writeDecision } from '#lib/store/store.ts';

const CLI = fileURLToPath(new URL('./index.js', import.meta.url));
const MOCKUP = fileURLToPath(new URL('../../docs/mockup/', import.meta.url));
const REPORT = join(MOCKUP, 'content/30-round-report.md');
const MERGE = join(MOCKUP, 'content/10-merge-gaps.md');

// Serves `gh pr view <n> --repo <owner>/<repo>` from pr-<owner>-<repo>-<n>.json beside it.
const STUB = `#!/usr/bin/env bash
dir=$(dirname "$0")
printf '%s\\n' "gh $*" >>"$dir/gh.log"
repo="" n=""
args=("$@")
for ((i = 2; i < \${#args[@]}; i++)); do
  case \${args[i]} in
    --repo) repo=\${args[i + 1]}; i=$((i + 1)) ;;
    --json) i=$((i + 1)) ;;
    -*) ;;
    *) [ -z "$n" ] && n=\${args[i]} ;;
  esac
done
f="$dir/pr-\${repo//\\//-}-$n.json"
[ -e "$f" ] || { echo "no pull requests found for $repo#$n" >&2; exit 1; }
cat "$f"
`;

const PASSED = [{ name: 'gate', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const ALL_PRS = [230, 231, 232, 233, 234];
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

let dir: string;
let state: string;
let root: string;
const children: ChildProcess[] = [];

const env = () => ({ ...process.env, APPROVAL_QUEUE_STATE: state, PATH: `${dir}:${process.env.PATH}` });

function serve(number: number, view: object) {
	writeFileSync(join(dir, `pr-glw907-workstation-${number}.json`), JSON.stringify(view));
}

function run(...args: string[]) {
	const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: env() });
	return { code: result.status, out: result.stdout, err: result.stderr };
}

/** Starts the command and returns handles to read its output and await its exit. */
function start(...args: string[]) {
	const child = spawn(process.execPath, [CLI, ...args], { env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
	children.push(child);
	const seen = { out: '', err: '', code: undefined as number | null | undefined };
	child.stdout.on('data', (d) => (seen.out += d));
	child.stderr.on('data', (d) => (seen.err += d));
	const done = new Promise<number | null>((resolve) =>
		child.on('exit', (code) => {
			seen.code = code;
			resolve(code);
		})
	);
	return { child, seen, done };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(test: () => boolean, ms: number): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (test()) return true;
		await sleep(50);
	}
	return test();
}

function stored(path: string, kind: string) {
	const source = readFileSync(path, 'utf8');
	return createDocument(root, source, { kind, title: parse(source).doc.title }).id;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'aq-send-'));
	state = join(dir, 'state');
	root = join(state, 'store');
	mkdirSync(state);
	writeFileSync(join(dir, 'gh'), STUB);
	chmodSync(join(dir, 'gh'), 0o755);
	for (const n of ALL_PRS) serve(n, { state: 'OPEN', isDraft: false, statusCheckRollup: PASSED });
});

afterEach(() => {
	for (const child of children.splice(0)) child.kill('SIGKILL');
	rmSync(dir, { recursive: true, force: true });
});

describe('send', () => {
	it('exits at once on a report and prints only the id', () => {
		const began = Date.now();
		const { code, out } = run('send', REPORT);
		expect(Date.now() - began).toBeLessThan(5000);
		expect(code).toBe(0);
		expect(out).toMatch(/^\d{8}-\d{6}-[0-9a-f]{6}\n$/);
		const id = out.trim();
		expect(readDocument(root, id).source).toBe(readFileSync(REPORT, 'utf8'));
	});

	it('exits with the decision once it is handed over, and collect prints the same line', async () => {
		const sent = start('send', MERGE);
		expect(await until(() => /stored \d{8}-\d{6}-[0-9a-f]{6}/.test(sent.seen.err), 10000)).toBe(true);
		const id = /stored (\S+?);/.exec(sent.seen.err)![1];
		writeDecision(root, id, { action: 'approve', at: ago(25) });
		expect(await Promise.race([sent.done, sleep(5000).then(() => 'late')])).toBe(0);
		const line = sent.seen.out;
		expect(JSON.parse(line)).toMatchObject({ id, action: 'approve' });
		expect(readDecisions(root, id).map((r) => r.action)).toEqual(['approve', 'handed']);
		const again = run('collect', id);
		expect(again.code).toBe(0);
		expect(again.out).toBe(line);
	}, 20000);

	it('is recovered by collect after send is killed, with no server running', async () => {
		const sent = start('send', MERGE);
		expect(await until(() => sent.seen.err.includes('stored '), 10000)).toBe(true);
		const id = /stored (\S+?);/.exec(sent.seen.err)![1];
		sent.child.kill('SIGKILL');
		await sent.done;
		writeDecision(root, id, { action: 'sendback', at: ago(25) });
		const { code, out } = run('collect', id);
		expect(code).toBe(0);
		expect(JSON.parse(out)).toMatchObject({ id, action: 'sendback' });
	}, 20000);

	it('holds a fresh decision until it is 20 seconds old', async () => {
		const id = stored(MERGE, 'merge');
		writeDecision(root, id, { action: 'approve', at: ago(15) });
		const collected = start('collect', id);
		await sleep(3000);
		expect(collected.seen.out).toBe('');
		expect(await until(() => collected.seen.out !== '', 5000)).toBe(true);
		expect(JSON.parse(collected.seen.out)).toMatchObject({ id, action: 'approve' });
	}, 20000);

	it('keeps waiting through an undone decision and prints the next one', async () => {
		const id = stored(MERGE, 'merge');
		writeDecision(root, id, { action: 'approve', at: ago(25) });
		writeDecision(root, id, { action: 'undo', at: ago(25) });
		const collected = start('collect', id);
		await sleep(3000);
		expect(collected.seen.code).toBeUndefined();
		writeDecision(root, id, { action: 'approve', at: ago(25), seq: 2 });
		expect(await until(() => collected.seen.out !== '', 5000)).toBe(true);
		expect(JSON.parse(collected.seen.out)).toMatchObject({ id, action: 'approve', seq: 2 });
	}, 20000);

	it('refuses a pending check and a merged pull request, storing nothing', () => {
		serve(231, { state: 'OPEN', isDraft: false, statusCheckRollup: [{ name: 'gate', status: 'IN_PROGRESS' }] });
		let result = run('send', MERGE);
		expect(result.code).toBe(1);
		expect(result.err).toContain('the check "gate" is still running.');
		expect(result.err).toContain('a check is still running; send it when the checks finish');
		expect(listDocuments(root).documents).toEqual([]);
		serve(231, { state: 'MERGED', isDraft: false, statusCheckRollup: PASSED });
		result = run('send', MERGE);
		expect(result.code).toBe(1);
		expect(result.err).toContain('is merged.');
		expect(listDocuments(root).documents).toEqual([]);
	});
});

describe('collect', () => {
	it('exits 1 on a report, 2 on a bad id, and 1 on an id with no document', () => {
		const report = stored(REPORT, 'report');
		expect(run('collect', report).code).toBe(1);
		const bad = run('collect', '../x');
		expect(bad.code).toBe(2);
		expect(bad.err).toContain('usage: approval-queue');
		const none = run('collect', '20260101-000000-abcdef');
		expect(none.code).toBe(1);
		expect(none.err).toContain('20260101-000000-abcdef');
	});

	it('exits 1 when the document is withdrawn beside it', async () => {
		const id = stored(MERGE, 'merge');
		const collected = start('collect', id);
		await sleep(1500);
		const out = run('withdraw', id);
		expect(out.code).toBe(0);
		expect(await Promise.race([collected.done, sleep(5000).then(() => 'late')])).toBe(1);
		expect(collected.seen.err).toContain('was withdrawn');
	}, 20000);
});

describe('withdraw', () => {
	it('refuses a decided document and prints the decision', () => {
		const id = stored(MERGE, 'merge');
		writeDecision(root, id, { action: 'approve', at: new Date().toISOString() });
		const { code, out, err } = run('withdraw', id);
		expect(code).toBe(2);
		expect(JSON.parse(out)).toMatchObject({ id, action: 'approve' });
		expect(err).toContain('was decided before the withdraw');
		expect(err).toContain('can still be undone');
	});

	it('names a decision file that cannot be read, in collect and in withdraw', () => {
		const id = stored(MERGE, 'merge');
		// The one hand-written record: writeDecision refuses a bad one.
		const file = join(root, id, 'decision-1.json');
		writeFileSync(file, '{"action":');
		for (const verb of ['collect', 'withdraw']) {
			const { code, err } = run(verb, id);
			expect(code).toBe(1);
			expect(err).toContain(file);
		}
	});
});
