import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SAMPLE_DOC = readFileSync(new URL('./sample.blueprint.md', import.meta.url), 'utf8');
export const SAMPLE_NOTES = readFileSync(new URL('./sample-notes.json', import.meta.url), 'utf8');
export const SAMPLE_FILE = 'blueprints/slow-build.blueprint.md';

/** Runs git in `dir` with a fixed identity, so a test repo commits without the machine's config. */
export function git(dir: string, ...args: string[]): string {
	return execFileSync('git', ['-C', dir, ...args], {
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Test',
			GIT_AUTHOR_EMAIL: 'test@example.com',
			GIT_COMMITTER_NAME: 'Test',
			GIT_COMMITTER_EMAIL: 'test@example.com',
			GIT_CONFIG_GLOBAL: '/dev/null'
		}
	}).trim();
}

/** A git repo at `dir` with the sample blueprint committed at `SAMPLE_FILE`; returns its blob. */
export async function seedRepo(dir: string, doc = SAMPLE_DOC): Promise<string> {
	await mkdir(join(dir, 'blueprints'), { recursive: true });
	git(dir, 'init', '-q', '-b', 'main');
	git(dir, 'config', 'user.name', 'Test');
	git(dir, 'config', 'user.email', 'test@example.com');
	await writeFile(join(dir, SAMPLE_FILE), doc);
	git(dir, 'add', SAMPLE_FILE);
	git(dir, 'commit', '-q', '-m', 'Add the blueprint');
	return git(dir, 'rev-parse', `HEAD:${SAMPLE_FILE}`);
}

/** A waiting blueprint item under `root` for the repo at `worktree`, as the command queues one. */
export async function seedBlueprintItem(root: string, id: string, worktree: string, blob: string, notes = SAMPLE_NOTES) {
	const dir = join(root, 'items', id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'doc.md'), SAMPLE_DOC);
	await writeFile(join(dir, 'notes.json'), notes);
	await writeFile(
		join(dir, 'item.json'),
		JSON.stringify({
			id,
			kind: 'blueprint',
			repo: 'sample',
			title: 'Approve the plan for Fix a slow build',
			created: '2026-10-20T10:00:00Z',
			worktree,
			file: SAMPLE_FILE,
			blob
		})
	);
}
