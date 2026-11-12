import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The command and documents are found from this file, so a copy of next/ runs its own command.
const CLI = fileURLToPath(new URL('./index.js', import.meta.url));
const MOCKUP = fileURLToPath(new URL('../../docs/mockup/', import.meta.url));

// Serves `gh pr view <n> --repo <owner>/<repo>` from pr-<owner>-<repo>-<n>.json beside it and logs each call,
// as tests/packet.test.sh does.
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

let dir: string;

function serve(number: number, view: object) {
	writeFileSync(join(dir, `pr-glw907-workstation-${number}.json`), JSON.stringify(view));
}

function run(...args: string[]) {
	const result = spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }
	});
	return { code: result.status, out: result.stdout, err: result.stderr };
}

const ghLog = () => (existsSync(join(dir, 'gh.log')) ? readFileSync(join(dir, 'gh.log'), 'utf8') : '');

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'aq-check-'));
	writeFileSync(join(dir, 'gh'), STUB);
	chmodSync(join(dir, 'gh'), 0o755);
	for (const n of ALL_PRS) serve(n, { state: 'OPEN', isDraft: false, statusCheckRollup: PASSED });
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('check on the mockup documents', () => {
	const docs = [
		'content/10-merge-gaps.md',
		'content/20-survey-edit.md',
		'content/30-round-report.md',
		'content/40-queue-design.md',
		'content/50-backlog.md',
		'specimen/markdown.md',
		'specimen/long.md'
	];
	for (const doc of docs) {
		it(`passes ${doc}`, () => {
			const path = join(MOCKUP, doc);
			const { code, out } = run('check', path);
			expect(out).toBe(`${path}: no faults\n`);
			expect(code).toBe(0);
			if (!doc.includes('merge-gaps') && !doc.includes('survey-edit')) expect(ghLog()).toBe('');
		});
	}

	it('reads each pull request of a merge document from GitHub', () => {
		run('check', join(MOCKUP, 'content/10-merge-gaps.md'));
		const calls = ghLog().trim().split('\n');
		expect(calls).toHaveLength(3);
		expect(calls[1]).toContain('pr view 231 --repo glw907/workstation');
	});
});

describe('check on pull request faults', () => {
	const doc = () => join(MOCKUP, 'content/10-merge-gaps.md');

	for (const [label, view, said] of [
		['merged', { state: 'MERGED', isDraft: false, statusCheckRollup: PASSED }, 'is merged.'],
		['closed', { state: 'CLOSED', isDraft: false, statusCheckRollup: PASSED }, 'is closed.'],
		['a draft', { state: 'OPEN', isDraft: true, statusCheckRollup: PASSED }, 'is a draft.']
	] as const) {
		it(`refuses a document whose second pull request is ${label}`, () => {
			serve(231, view);
			const { code, out } = run('check', doc());
			expect(code).toBe(1);
			expect(out).toContain(`glw907/workstation#231 (the planning-miss count in the pass report) ${said}`);
			expect(out).toMatch(/10-merge-gaps\.md:5: /);
		});
	}

	it('refuses a failing check and names it', () => {
		serve(232, { state: 'OPEN', isDraft: false, statusCheckRollup: [{ name: 'gate', status: 'COMPLETED', conclusion: 'FAILURE' }] });
		const { code, out } = run('check', doc());
		expect(code).toBe(1);
		expect(out).toContain('glw907/workstation#232 (the round rules): the check "gate" failed.');
	});

	it('passes a check still running with a pending line', () => {
		serve(232, { state: 'OPEN', isDraft: false, statusCheckRollup: [{ name: 'gate', status: 'IN_PROGRESS' }] });
		const { code, out } = run('check', doc());
		expect(out).toBe(
			`glw907/workstation#232 (the round rules): the check "gate" is still running.\n${doc()}: no faults\n`
		);
		expect(code).toBe(0);
	});

	it('refuses a pull request it cannot read', () => {
		rmSync(join(dir, 'pr-glw907-workstation-230.json'));
		const { code, out } = run('check', doc());
		expect(code).toBe(1);
		expect(out).toContain('could not read glw907/workstation#230 from GitHub: no pull requests found');
	});
});

describe('check on document faults', () => {
	it('prints every fault with its line, and both lines of a two-line fault', () => {
		const path = join(dir, 'two.md');
		writeFileSync(
			path,
			[
				'---',
				'kind: report',
				'---',
				'',
				'# A title',
				'',
				'The first paragraph.',
				'',
				':::question Same',
				'- **Only**',
				':::',
				'',
				':::question Same',
				'- **One**',
				'- **Two**',
				':::',
				''
			].join('\n')
		);
		const { code, out } = run('check', path);
		const lines = out.trim().split('\n');
		expect(code).toBe(1);
		expect(lines).toHaveLength(2);
		expect(lines.some((l) => l.startsWith(`${path}:9: `) && l.includes('"Same"') && l.includes('1'))).toBe(true);
		expect(lines.some((l) => l.startsWith(`${path}:9 and 13: `) && l.includes('"Same"'))).toBe(true);
	});

	it('prints a no-title fault at its line for a document with its title removed', () => {
		const path = join(dir, 'report.md');
		const source = readFileSync(join(MOCKUP, 'content/30-round-report.md'), 'utf8');
		writeFileSync(path, source.replace(/^# .*\n/m, ''));
		const { code, out } = run('check', path);
		expect(code).toBe(1);
		expect(out).toMatch(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+: no title`, 'm'));
	});
});

describe('check usage', () => {
	it('refuses a file that does not exist', () => {
		const path = join(dir, 'absent.md');
		const { code, out } = run('check', path);
		expect(code).toBe(1);
		expect(out).toBe(`${path}: cannot read the file: no such file\n`);
	});

	it('prints the usage for no argument', () => {
		const { code, err } = run();
		expect(code).toBe(2);
		expect(err).toContain('usage: approval-queue check|send <doc.md>');
	});

	it('prints the usage for another subcommand', () => {
		const path = join(dir, 'x.md');
		copyFileSync(join(MOCKUP, 'content/30-round-report.md'), path);
		const { code, err } = run('frobnicate', path);
		expect(code).toBe(2);
		expect(err).toContain('usage: approval-queue check|send <doc.md>');
	});
});
