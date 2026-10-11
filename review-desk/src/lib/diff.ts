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
