/**
 * Entry point for the packet command's PR data checks.
 *
 * Run as `node check-pr.ts <pr.json> <body.md>`, where `pr.json` is a fetched PR's metadata. It
 * prints `{"state", "failed", "pending", "verdict", "beforeMerge"}` as JSON and exits 0, or exits 1
 * on an unreadable file. It imports only `pr-summary.ts` and `before-merge.ts`, so it runs under
 * plain `node` with no `node_modules`, and it classifies checks and the review verdict exactly as
 * the PR page does.
 */
import { readFileSync } from 'node:fs';
import { beforeMerge } from './lib/before-merge.ts';
import { checksSummary, reviewVerdict } from './lib/pr-summary.ts';

const [prFile, bodyFile] = process.argv.slice(2);
if (!prFile || !bodyFile) {
	console.error('usage: check-pr.ts <pr.json> <body.md>');
	process.exit(1);
}

try {
	const pr = JSON.parse(readFileSync(prFile, 'utf8'));
	const body = readFileSync(bodyFile, 'utf8');
	const checks = checksSummary(pr.statusCheckRollup);
	console.log(
		JSON.stringify({
			state: pr.state,
			failed: checks.rows.filter((r) => r.state === 'fail').map((r) => r.name),
			pending: checks.pending,
			verdict: reviewVerdict(body),
			beforeMerge: beforeMerge(body) !== null
		})
	);
} catch (error) {
	console.error(`check-pr: ${(error as Error).message}`);
	process.exit(1);
}
