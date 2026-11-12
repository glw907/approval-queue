import { spawnSync } from 'node:child_process';
import type { PrView, ViewResult } from '#lib/doc/pr.ts';

const TIMEOUT_MS = 30_000;

/** Reads a pull request with `gh pr view`, giving up after 30 seconds. */
export function ghView(repo: string, number: number): ViewResult {
	const run = spawnSync('gh', ['pr', 'view', String(number), '--repo', repo, '--json', 'state,isDraft,statusCheckRollup'], {
		encoding: 'utf8',
		timeout: TIMEOUT_MS,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	if (run.error) {
		const timedOut = (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
		return { ok: false, error: timedOut ? 'gh gave no answer in 30 seconds' : run.error.message };
	}
	if (run.status !== 0) {
		const first = (run.stderr || run.stdout || '').trim().split('\n')[0] || `gh exited ${run.status}`;
		return { ok: false, error: first.replace(/\.$/, '') };
	}
	try {
		return { ok: true, view: JSON.parse(run.stdout) as PrView };
	} catch {
		return { ok: false, error: 'gh printed something other than JSON' };
	}
}
