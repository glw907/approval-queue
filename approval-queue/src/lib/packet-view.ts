import type { Claim, Facts } from '#lib/facts.ts';
import { fileGroups, type DiffFile, type DiffRow } from '#lib/diff.ts';

/** A file that changes more lines than this shows a GitHub link instead of its diff. */
export const MAX_CHANGED = 400;

/** `glw907/cairn-cms#214` as `cairn-cms #214`. */
export const prLabel = (ref: string) => ref.slice(ref.indexOf('/') + 1).replace('#', ' #');

/** The repo name of `owner/repo#n`, or of a `{repo}` that is already one. */
const repoOf = (ref: string) => ref.slice(ref.indexOf('/') + 1).split('#')[0];

/** A rule id as the badge words it: `public-surface` is "Public surface". */
export function ruleLabel(rule: string): string {
	const words = rule.replace(/-/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `a, b, and c`. */
function list(items: string[]): string {
	if (items.length < 2) return items.join('');
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

const LEAD = {
	stop: 'Pass parked until you answer.',
	close: 'Pass finished; its pull requests wait for you.',
	design: 'A design for your approval.'
} as const;

/** The label on the primary button: a stop packet is answered, a close or a design is approved. */
export const primaryLabel = (kind: Facts['kind']): string => (kind === 'stop' ? 'Answer and resume' : 'Approve');

/** The sentence a stop packet's page adds under its status line; a close or a design has none. */
export const stopSentence = (kind: Facts['kind']): string | undefined =>
	kind === 'stop' ? 'Answering merges nothing. The session runs the steps below, then relaunches the pass.' : undefined;

/** The repos a packet names: its pull requests' and its design's, in order of first appearance. */
export function packetRepos(facts: Facts): string[] {
	return [...new Set([...facts.prs.map(repoOf), ...(facts.design ? [facts.design.repo] : [])])];
}

/** The status line's two parts: the kind in a sentence, then the round, the initiative, and the repos ("Round ur-queue of Setup tooling in a and b."). */
export function statusLine(facts: Facts, initiative: string, round?: string): { lead: string; rest: string } {
	const repos = packetRepos(facts);
	const where = repos.length ? `in ${list(repos)}` : '';
	const roundPart = round ? `Round ${round}` : '';
	const middle = round && initiative ? [roundPart, 'of', initiative].join(' ') : roundPart || initiative;
	const rest = [middle, where].filter(Boolean).join(' ');
	return { lead: LEAD[facts.kind], rest: rest + (rest ? '.' : '') };
}

/**
 * The text of the deep dive past its closed line: the section's body less its first paragraph, which
 * the closed fold already shows. `## ` inside a fence does not end it.
 */
export function deepDiveBody(markdown: string): string {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	let fence = false;
	let body: string[] | undefined;
	for (const line of lines) {
		if (/^(```|~~~)/.test(line)) fence = !fence;
		if (!fence && line.startsWith('## ')) {
			if (body) break;
			if (line.slice(3).trim() === 'Deep dive') body = [];
			continue;
		}
		body?.push(line);
	}
	const text = (body ?? []).join('\n').trim();
	const cut = text.search(/\n\s*\n/);
	return cut < 0 ? '' : text.slice(cut).trim();
}

/** The index of the claim an evidence source points at, or -1: a `path:a-b` source finds the claim whose lines it overlaps, a pull request its first claim. */
export function claimFor(source: string, claims: Claim[]): number {
	const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(source);
	if (!m) return claims.findIndex((c) => c.pr === source);
	const [from, to] = [Number(m[2]), Number(m[3] ?? m[2])];
	const same = (c: Claim) => c.path === m[1] || c.path.endsWith(`/${m[1]}`) || m[1].endsWith(`/${c.path}`);
	const exact = claims.findIndex((c) => same(c) && c.from <= to && c.to >= from);
	return exact >= 0 ? exact : claims.findIndex(same);
}

/** The files of a patch by path. */
export function patchFiles(patch: string): Map<string, DiffFile> {
	return new Map(fileGroups(patch).flatMap((g) => g.files).map((f) => [f.path, f]));
}

/** Lines a file adds and removes together. */
export const changedLines = (file: Pick<DiffFile, 'adds' | 'dels'>) => file.adds + file.dels;

/** The hunks of a file that hold new-side lines `from` to `to`; a file the claim does not reach keeps its first hunk. */
export function claimHunks(file: DiffFile, from: number, to: number): DiffFile {
	const hunks: DiffRow[][] = [];
	for (const row of file.rows) {
		if (row.kind === 'hunk') hunks.push([row]);
		else hunks.at(-1)?.push(row);
	}
	const hits = hunks.filter((h) => h.some((r) => r.newLine !== undefined && r.newLine >= from && r.newLine <= to));
	return { ...file, rows: (hits.length ? hits : hunks.slice(0, 1)).flat() };
}

/** The pull request's Files tab, where a file too long to show here opens. */
export function githubFiles(ref: string): string {
	const [repo, n] = ref.split('#');
	return `https://github.com/${repo}/pull/${n}/files`;
}

/** A count and its noun: `1 file`, `2 files`. */
export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
