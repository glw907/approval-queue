// The page checks of pass A3, and the seed the pages' tests share.
//
// Run as `node next/scripts/page-checks.mjs` after `npm run build --prefix next`. A vitest import
// takes `seed` and launches nothing.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from '../src/lib/doc/parse.ts';
import { addVersion, createDocument } from '../src/lib/store/store.ts';

const MOCKUP = fileURLToPath(new URL('../../docs/mockup/', import.meta.url));
const CLI = fileURLToPath(new URL('../cli/index.js', import.meta.url));

// Serves `repo view` (a default branch of main), `pr view <n>` from pr-<n>.json, and `pr merge`,
// as the stub in `next/cli/land.test.ts` does.
const STUB = `#!/usr/bin/env bash
dir=$(dirname "$0")
case "$1 $2" in
  "repo view") echo '{"defaultBranchRef":{"name":"main"}}' ;;
  "pr view") cat "$dir/pr-$3.json" ;;
  "pr merge") ;;
  *) echo "unexpected gh call" >&2; exit 1 ;;
esac
`;

/** @param {number} ms */
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Stores the mockup's five documents and its merged lines under the state directory `state`, the
 * directory `APPROVAL_QUEUE_STATE` names.
 *
 * Each document is created at least 2 ms after the one before, so the store lists them in name
 * order. `20-survey-edit` is stored as the version the session sent, then given its returned
 * version. The merged lines go through `land`, oldest first, against a stub `gh`.
 *
 * @param {string} state
 * @returns {Promise<{ root: string, ids: Record<string, string> }>} the store's root and each
 *   document's id by its file name without `.md`
 */
export async function seed(state) {
	const root = join(state, 'store');
	const content = join(MOCKUP, 'content');
	/** @type {Record<string, string>} */
	const ids = {};
	const names = readdirSync(content).filter((n) => n.endsWith('.md')).sort();
	for (const file of names) {
		const name = file.slice(0, -3);
		const source = readFileSync(join(content, file), 'utf8');
		const sentPath = join(MOCKUP, 'versions', `${name}.sent.md`);
		const first = name === '20-survey-edit' ? readFileSync(sentPath, 'utf8') : source;
		const { doc } = parse(first);
		const started = Date.now();
		const meta = createDocument(root, first, { kind: doc.kind ?? 'design', title: doc.title });
		if (first !== source) addVersion(root, meta.id, source);
		ids[name] = meta.id;
		while (Date.now() - started < 2) await pause(1);
	}

	const stub = join(state, 'gh-stub');
	mkdirSync(stub, { recursive: true });
	writeFileSync(join(stub, 'gh'), STUB);
	chmodSync(join(stub, 'gh'), 0o755);
	/** @type {{ repo: string, lines: { pr: number, time: string, text: string }[] }[]} */
	const groups = JSON.parse(readFileSync(join(content, 'merged.json'), 'utf8'));
	const lines = groups
		.flatMap((g) => g.lines.map((l) => ({ ...l, repo: g.repo })))
		.sort((x, y) => x.time.localeCompare(y.time));
	for (const line of lines) {
		const view = {
			state: 'OPEN',
			isDraft: false,
			headRefOid: 'abc123def456',
			body: 'A merged line for the page checks.',
			baseRefName: 'main',
			statusCheckRollup: [{ name: 'gate', status: 'COMPLETED', conclusion: 'SUCCESS' }]
		};
		writeFileSync(join(stub, `pr-${line.pr}.json`), JSON.stringify(view));
		const run = spawnSync(process.execPath, [CLI, 'land', `${line.repo}#${line.pr}`, line.text], {
			encoding: 'utf8',
			env: { ...process.env, APPROVAL_QUEUE_STATE: state, PATH: `${stub}:${process.env.PATH}` }
		});
		if (run.status !== 0) throw new Error(`land ${line.repo}#${line.pr} exited ${run.status}: ${run.stderr}`);
		await pause(2);
	}
	return { root, ids };
}

async function main() {}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
