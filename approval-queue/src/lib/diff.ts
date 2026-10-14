export type DiffKind = 'added' | 'removed' | 'hunk' | 'file' | 'context';

export interface DiffLine {
	kind: DiffKind;
	text: string;
}

/** File headers are tested before added and removed, since `+++` and `---` also start with those marks. */
export function classify(line: string): DiffKind {
	if (line.startsWith('diff --git ') || line.startsWith('+++ ') || line.startsWith('--- ')) return 'file';
	if (line.startsWith('@@')) return 'hunk';
	if (line.startsWith('+')) return 'added';
	if (line.startsWith('-')) return 'removed';
	return 'context';
}

export function classifyDiff(diff: string): DiffLine[] {
	return diff.split('\n').map((text) => ({ kind: classify(text), text }));
}

export interface DiffRow {
	kind: 'hunk' | 'add' | 'del' | 'context';
	text: string;
	oldLine?: number;
	newLine?: number;
}

export interface DiffFile {
	path: string;
	adds: number;
	dels: number;
	status?: 'new' | 'deleted';
	rows: DiffRow[];
}

const ROOT = 'Repository root';

/** Files grouped by first path segment in path order, top-level files first under "Repository root". */
export function fileGroups(diff: string): { name: string; files: DiffFile[] }[] {
	const files: DiffFile[] = [];
	let file: DiffFile | undefined;
	let inHunk = false;
	let oldLine = 0;
	let newLine = 0;
	for (const line of diff.split('\n')) {
		const header = /^diff --git a\/.* b\/(.*)$/.exec(line);
		if (header) {
			file = { path: header[1], adds: 0, dels: 0, rows: [] };
			files.push(file);
			inHunk = false;
			continue;
		}
		if (!file) continue;
		const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (hunk) {
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[2]);
			inHunk = true;
			file.rows.push({ kind: 'hunk', text: line });
		} else if (!inHunk) {
			if (line.startsWith('new file mode')) file.status = 'new';
			else if (line.startsWith('deleted file mode')) file.status = 'deleted';
		} else if (line.startsWith('+')) {
			file.adds++;
			file.rows.push({ kind: 'add', text: line.slice(1), newLine: newLine++ });
		} else if (line.startsWith('-')) {
			file.dels++;
			file.rows.push({ kind: 'del', text: line.slice(1), oldLine: oldLine++ });
		} else if (line.startsWith(' ')) {
			file.rows.push({ kind: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
		}
	}
	const groups = new Map<string, DiffFile[]>();
	for (const f of files) {
		const name = f.path.includes('/') ? f.path.slice(0, f.path.indexOf('/')) : ROOT;
		groups.set(name, [...(groups.get(name) ?? []), f]);
	}
	const byPath = (a: DiffFile, b: DiffFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
	return [...groups]
		.sort(([a], [b]) => (a === ROOT ? -1 : b === ROOT ? 1 : a < b ? -1 : a > b ? 1 : 0))
		.map(([name, list]) => ({ name, files: list.sort(byPath) }));
}
