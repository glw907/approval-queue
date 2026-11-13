import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCENARIO = fileURLToPath(new URL('./restart-scenario.sh', import.meta.url));

let scratch = '';

afterEach(() => {
	if (scratch) rmSync(scratch, { recursive: true, force: true });
	scratch = '';
});

/**
 * Runs one scenario in a private network namespace, where port 7907 is the test's own, and
 * returns its key=value lines. Every process the run leaves behind ends with the namespace.
 */
function scenario(mode: string, seconds: number): Record<string, string> {
	scratch = mkdtempSync(join(tmpdir(), 'aq-restart-'));
	const run = spawnSync(
		'unshare',
		['-rnpf', '--mount-proc', '--kill-child', 'bash', SCENARIO, mode, join(scratch, 'tree'), join(scratch, 'state')],
		{ encoding: 'utf8', timeout: seconds * 1000, env: { ...process.env, APPROVAL_QUEUE_STATE: '' } }
	);
	const out: Record<string, string> = {};
	for (const line of (run.stdout ?? '').split('\n')) {
		const at = line.indexOf('=');
		if (at > 0) out[line.slice(0, at)] = line.slice(at + 1);
	}
	if (!out.exit) throw new Error(`the ${mode} scenario printed no result: ${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
	return out;
}

// Each timeout is the scenario's own limit; vitest allows ten seconds more.
describe('restart', () => {
	it('swaps in a build that answered on a spare port, then stops listening there', () => {
		const r = scenario('ok', 60);
		expect(r.exit).toBe('0');
		expect(r.stderr).toContain('the new build answered on spare port');
		expect(r['now.pid_on_7907_is_old']).toBe('no');
		expect(r['now.pid_on_7907_is_ours']).toBe('yes');
		expect(r['now.aq_build_status']).toBe('200');
		expect(r['now.aq_build_body']).toBe('new');
		expect(r.spare_listeners).toBe('0');
		expect(r.build_prev_exists).toBe('no');
		expect(r.node_modules_prev_exists).toBe('no');
		expect(r.stage_exists).toBe('no');
		expect(r.archive).toBe('yes');
		expect(r.old).toBe('0');
		expect(r.store).toBe('no');
		expect(r.archive_list).toContain('items/');
		expect(r.archive_list).toContain('decisions.jsonl');
		expect(r.stderr).toContain('archive-2026-11.tar.gz');
		expect(r.stderr).toContain('left in place');
	}, 70_000);

	it('leaves the old server running when the new build exits at start', () => {
		const r = scenario('exits', 60);
		expect(r.exit).toBe('1');
		expect(r.stderr).toContain('the new build did not answer on port');
		expect(Number(r.seconds)).toBeLessThan(60);
		expect(r['now.pid_on_7907_is_old']).toBe('yes');
		expect(r['now.aq_build_status']).toBe('404');
		expect(r.build_prev_exists).toBe('no');
		expect(r.stage_processes).toBe('0');
		expect(r.archive).toBe('no');
		expect(r.old).toBe('4');
	}, 70_000);

	it('stops a new build that never answers and leaves the old server running', () => {
		const r = scenario('silent', 75);
		expect(r.exit).toBe('1');
		expect(r.stderr).toContain('within 20 seconds; the old server keeps running');
		expect(Number(r.seconds)).toBeGreaterThanOrEqual(20);
		expect(r.spare_listeners).toBe('0');
		expect(r.stage_processes).toBe('0');
		expect(r['now.pid_on_7907_is_old']).toBe('yes');
		expect(r['now.aq_build_status']).toBe('404');
		expect(r.archive).toBe('no');
		expect(r.old).toBe('4');
	}, 85_000);

	it('puts the old build back when the new build answers on the spare port but not on the real one', () => {
		const r = scenario('slow', 120);
		expect(r.exit).toBe('1');
		expect(r.stderr).toContain('restart failed; the old build answers again');
		expect(r['now.aq_build_status']).toBe('404');
		expect(r['now.pid_on_7907_is_ours']).toBe('yes');
		expect(r.build_prev_exists).toBe('no');
		expect(r.node_modules_prev_exists).toBe('no');
		expect(r['later.pid_on_7907_is_ours']).toBe('yes');
		expect(r['later.aq_build_status']).toBe('404');
		expect(r['later.build_processes']).toBe('1');
		expect(r.archive).toBe('no');
		expect(r.old).toBe('4');
	}, 130_000);

	it('refuses to switch while an old item is undecided, naming it', () => {
		const r = scenario('undecided', 45);
		expect(r.exit).toBe('1');
		expect(r.stderr).toContain('waiting-1');
		expect(r.stderr).toContain('Waiting item');
		expect(r['now.pid_on_7907_is_old']).toBe('yes');
		expect(r['now.aq_build_status']).toBe('404');
		expect(r.stage_exists).toBe('no');
		expect(r.archive).toBe('no');
		expect(r.old).toBe('4');
	}, 55_000);

	it('refuses a port held by a server this queue did not start, and stages nothing', () => {
		const r = scenario('foreign', 45);
		expect(r.exit).toBe('1');
		expect(r.stderr).toContain("which is not this queue's server");
		expect(r.stage_exists).toBe('no');
	}, 55_000);

	it('refuses while another restart holds the lock, and leaves the old server running', () => {
		const r = scenario('locked', 45);
		expect(r.exit).toBe('1');
		expect(r.stderr).toContain('another restart is running');
		expect(r['now.pid_on_7907_is_old']).toBe('yes');
		expect(r.stage_exists).toBe('no');
	}, 55_000);
});
