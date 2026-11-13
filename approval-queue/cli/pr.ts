import { spawnSync } from 'node:child_process';
import type { PrView, ViewResult } from '#lib/doc/pr.ts';

const TIMEOUT_MS = 30_000;

/**
 * Runs `gh` with `args`, giving up after 30 seconds, and returns its stdout. A failure is the
 * first line of gh's error, without a final period.
 */
export function gh(args: string[]): { ok: true; stdout: string } | { ok: false; error: string } {
	const run = spawnSync('gh', args, { encoding: 'utf8', timeout: TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
	if (run.error) {
		const timedOut = (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
		return { ok: false, error: timedOut ? 'gh gave no answer in 30 seconds' : run.error.message };
	}
	if (run.status !== 0) {
		const first = (run.stderr || run.stdout || '').trim().split('\n')[0] || `gh exited ${run.status}`;
		return { ok: false, error: first.replace(/\.$/, '') };
	}
	return { ok: true, stdout: run.stdout };
}

/** Runs `gh` and parses its stdout as JSON. */
export function ghJson<T>(args: string[]): { ok: true; value: T } | { ok: false; error: string } {
	const run = gh(args);
	if (!run.ok) return run;
	try {
		return { ok: true, value: JSON.parse(run.stdout) as T };
	} catch {
		return { ok: false, error: 'gh printed something other than JSON' };
	}
}

/**
 * Reads a pull request with `gh pr view`, giving up after 30 seconds. The view also carries
 * `headRefOid`, the head commit `send` records.
 */
export function ghView(repo: string, number: number): ViewResult {
	const read = ghJson<PrView>(['pr', 'view', String(number), '--repo', repo, '--json', 'state,isDraft,headRefOid,statusCheckRollup']);
	return read.ok ? { ok: true, view: read.value } : read;
}
