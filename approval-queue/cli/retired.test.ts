import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const APP = fileURLToPath(new URL('..', import.meta.url));
const LAUNCHER = fileURLToPath(new URL('../../bin/.local/bin/approval-queue', import.meta.url));

// The old argument shape of each subcommand the new command lacks.
const RETIRED: [string, string[]][] = [
	['design', ['r', 't', 's']],
	['triage', ['r', 't', 's']],
	['snapshot', ['facts.json']],
	['packet', ['--check', 'i', 'f', 't']],
	['report', ['i', 'r', 'r.md']],
	['pending', []],
	['digest', ['o/r#1', 'claim']],
];

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'aq-retired-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(cwd: string, args: string[]) {
	return spawnSync('node', [join(cwd, 'cli/index.js'), ...args], { encoding: 'utf8' });
}

describe('a retired subcommand', () => {
	it.each(RETIRED)('%s prints one line naming approval-packet and exits 1', (name, args) => {
		const r = run(APP, [name, ...args]);
		expect(r.status).toBe(1);
		expect(r.stdout).toBe('');
		expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
		expect(r.stderr).toContain('approval-packet');
		expect(r.stderr).toContain(name);
	});
});

describe('the command in a copy with no node_modules', () => {
	let copy: string;
	beforeEach(() => {
		copy = join(dir, 'app');
		cpSync(join(APP, 'package.json'), join(copy, 'package.json'));
		cpSync(join(APP, 'cli'), join(copy, 'cli'), { recursive: true });
		cpSync(join(APP, 'src/lib'), join(copy, 'src/lib'), { recursive: true });
	});

	it('prints the usage line and exits 2 with no arguments', () => {
		const r = run(copy, []);
		expect(r.status).toBe(2);
		expect(r.stderr).toContain('usage:');
	});

	it('answers a retired name', () => {
		const r = run(copy, ['packet']);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('approval-packet');
	});

	it('loads and dispatches restart, which takes no argument', () => {
		const r = run(copy, ['restart', 'x']);
		expect(r.status).toBe(2);
		expect(r.stderr).toContain('usage:');
	});

	it('imports restart.ts on its own', () => {
		const r = spawnSync(
			'node',
			['--input-type=module', '-e', `await import(${JSON.stringify(join(copy, 'cli/restart.ts'))})`],
			{ encoding: 'utf8' }
		);
		expect(r.status).toBe(0);
	});
});

describe('the launcher', () => {
	it('runs the command through a symlink', () => {
		const link = join(dir, 'approval-queue');
		symlinkSync(LAUNCHER, link);
		const r = spawnSync(link, [], { encoding: 'utf8' });
		expect(r.status).toBe(2);
		expect(r.stderr).toContain('usage:');
	});
});
