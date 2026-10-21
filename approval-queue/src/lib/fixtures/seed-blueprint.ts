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

export const PAGE_DOC = readFileSync(new URL('./sample.page.md', import.meta.url), 'utf8');
export const PAGE_NOTES = readFileSync(new URL('./sample-page-notes.json', import.meta.url), 'utf8');
export const PAGE_FILE = 'docs/extend/slow-build.md';
export const PAGE_PR = 'glw907/sample#7';
export const PAGE_HEAD = 'a'.repeat(40);

/** A repo at `dir` with the sample page committed at `PAGE_FILE`; returns its blob. */
export async function seedPageRepo(dir: string): Promise<string> {
	await mkdir(join(dir, 'docs/extend'), { recursive: true });
	git(dir, 'init', '-q', '-b', 'main');
	git(dir, 'config', 'user.name', 'Test');
	git(dir, 'config', 'user.email', 'test@example.com');
	await writeFile(join(dir, PAGE_FILE), PAGE_DOC);
	git(dir, 'add', PAGE_FILE);
	git(dir, 'commit', '-q', '-m', 'Add the page');
	return git(dir, 'rev-parse', `HEAD:${PAGE_FILE}`);
}

const CHANGE = (name: string) => new URL(`./change/${name}`, import.meta.url);
export const CHANGE_NOTES = readFileSync(CHANGE('notes.json'), 'utf8');
export const CHANGE_DOCS = [
	{ path: 'blueprints/docs/extend/restrict-admin-access.blueprint.yaml', kind: 'blueprint' },
	{ path: 'docs/extend/run-cairn-audit-on-your-site.md', kind: 'page' },
	{ path: 'docs/extend/share-a-draft-preview.md', kind: 'page' }
] as const;

/** A waiting change item under `root`, built from the fixture of a cairn change that edited blueprints and pages. */
export async function seedChangeItem(root: string, id: string, notes = CHANGE_NOTES) {
	const dir = join(root, 'items', id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'item.json'), JSON.stringify({
		id,
		kind: 'change',
		repo: 'glw907/cairn-cms',
		number: 77,
		title: 'Retarget two links and give the draft seat room',
		created: '2026-10-20T10:00:00Z',
		head: PAGE_HEAD
	}));
	await writeFile(join(dir, 'body.md'), 'Retargets two links to renamed headings.\n');
	await writeFile(join(dir, 'diff.patch'), readFileSync(CHANGE('diff.patch')));
	await writeFile(join(dir, 'pr.json'), JSON.stringify({
		ref: 'glw907/cairn-cms#77',
		head: PAGE_HEAD,
		number: 77,
		url: 'https://github.com/glw907/cairn-cms/pull/77',
		headRefName: 'retarget-links',
		baseRefName: 'main',
		statusCheckRollup: [{ name: 'gate', workflowName: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }]
	}));
	await writeFile(join(dir, 'docs.json'), JSON.stringify(CHANGE_DOCS));
	for (const [k, { path }] of CHANGE_DOCS.entries()) {
		await mkdir(join(dir, 'docs', String(k)), { recursive: true });
		await writeFile(join(dir, 'docs', String(k), 'new.md'), readFileSync(CHANGE(`head/${path}`)));
		await writeFile(join(dir, 'docs', String(k), 'old.md'), readFileSync(CHANGE(`base/${path}`)));
	}
	await writeFile(join(dir, 'notes.json'), notes);
}

/** A waiting page item under `root` for the repo at `worktree`, as the command queues one. */
export async function seedPageItem(root: string, id: string, worktree: string, blob: string, notes = PAGE_NOTES) {
	const dir = join(root, 'items', id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'doc.md'), PAGE_DOC);
	await writeFile(join(dir, 'notes.json'), notes);
	await writeFile(
		join(dir, 'item.json'),
		JSON.stringify({
			id,
			kind: 'page',
			repo: 'sample',
			title: 'Approve the page Fix a slow build',
			created: '2026-10-20T10:00:00Z',
			worktree,
			file: PAGE_FILE,
			blob,
			pr: PAGE_PR,
			prHead: PAGE_HEAD
		})
	);
}
