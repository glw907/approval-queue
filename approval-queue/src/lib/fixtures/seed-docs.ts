import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { anchorAt } from '#lib/editor/comments.ts';

const FIXTURE = (path: string) => new URL(`./docs/${path}`, import.meta.url);
const read = (path: string) => readFileSync(FIXTURE(path), 'utf8');

export const DOCS_NOTES = read('notes.json');
export const DOCS_REPO = 'glw907/sample';
export const DOCS_NUMBER = 7;
/** The two changed pages in the order `pages.json` lists them: one edited, one new. */
export const WATER = 'docs/guide/water-a-houseplant.md';
export const REPOT = 'docs/guide/repot-a-houseplant.md';
export const WATER_HEAD = read(`head/${WATER}`);
export const REPOT_HEAD = read(`head/${REPOT}`);

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

/**
 * A git repo at `dir` whose first commit is the fixture's base tree and whose second is its head
 * tree: the PR's merge base and head. Returns the head's blob of each page.
 */
export function seedDocsRepo(dir: string): { water: string; repot: string } {
	git(dir, 'init', '-q', '-b', 'main');
	git(dir, 'config', 'user.name', 'Test');
	git(dir, 'config', 'user.email', 'test@example.com');
	for (const tree of ['base', 'head']) {
		cpSync(FIXTURE(`${tree}/`), dir, { recursive: true });
		git(dir, 'add', '-A');
		git(dir, 'commit', '-q', '-m', `Add the ${tree} tree`);
	}
	return { water: git(dir, 'rev-parse', `HEAD:${WATER}`), repot: git(dir, 'rev-parse', `HEAD:${REPOT}`) };
}

/**
 * A waiting `docs` item under `root` for the repo at `worktree`, laid out as the command queues
 * one: the repo's first commit is the merge base and its HEAD is the PR head. The item holds a
 * reply to an earlier comment on the new page and one saved comment on the edited page.
 */
export async function seedDocsItem(root: string, id: string, worktree: string, meta: object = {}, notes = DOCS_NOTES) {
	const dir = join(root, 'items', id);
	const head = git(worktree, 'rev-parse', 'HEAD');
	const base = git(worktree, 'rev-parse', 'HEAD~1');
	await mkdir(join(dir, 'pages/0'), { recursive: true });
	await mkdir(join(dir, 'pages/1'), { recursive: true });
	await writeFile(
		join(dir, 'item.json'),
		JSON.stringify({
			id,
			kind: 'docs',
			repo: DOCS_REPO,
			number: DOCS_NUMBER,
			title: 'Water and repot a houseplant',
			headline: 'Water and repot a houseplant',
			created: '2026-10-20T10:00:00Z',
			worktree,
			head,
			base,
			...meta
		})
	);
	await writeFile(join(dir, 'description.md'), 'The guide had no repotting page.\n\nThis adds one and tightens the watering step.\n');
	await writeFile(join(dir, 'body.md'), 'Adds a repotting page.\n');
	await writeFile(join(dir, 'diff.patch'), git(worktree, 'diff', base, head) + '\n');
	await writeFile(
		join(dir, 'pr.json'),
		JSON.stringify({
			number: DOCS_NUMBER,
			url: `https://github.com/${DOCS_REPO}/pull/${DOCS_NUMBER}`,
			headRefName: 'repot-page',
			baseRefName: 'main',
			statusCheckRollup: [{ name: 'gate', workflowName: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }],
			head
		})
	);
	await writeFile(join(dir, 'pages.json'), JSON.stringify([{ path: WATER }, { path: REPOT }]));
	await writeFile(join(dir, 'pages/0/base.md'), read(`base/${WATER}`));
	await writeFile(join(dir, 'pages/0/queued.md'), WATER_HEAD);
	await writeFile(join(dir, 'pages/1/base.md'), '');
	await writeFile(join(dir, 'pages/1/queued.md'), REPOT_HEAD);
	await writeFile(join(dir, 'notes.json'), notes);
	const reply = REPOT_HEAD.indexOf('Choose a pot');
	await writeFile(
		join(dir, 'replies.json'),
		JSON.stringify([
			{
				id: 'C1',
				status: 'done',
				text: 'Added the drainage holes.',
				quote: 'Choose a pot',
				anchor: anchorAt(REPOT_HEAD, reply, reply + 'Choose a pot'.length, head, REPOT)
			}
		])
	);
	const saved = WATER_HEAD.indexOf('top inch');
	await writeFile(
		join(dir, 'comments.json'),
		JSON.stringify({
			comments: [{ id: 'C2', text: 'Say which inch.', anchor: anchorAt(WATER_HEAD, saved, saved + 'top inch'.length, head, WATER) }],
			threads: [],
			next: 3
		})
	);
}
