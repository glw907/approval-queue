export type Verdict = 'accept' | 'fix' | 'escalate';
export type CheckState = 'pass' | 'fail' | 'skip' | 'pending';

export interface ChecksSummary {
	passed: number;
	failed: number;
	skipped: number;
	pending: number;
	text: string;
	rows: { name: string; state: CheckState }[];
}

/**
 * The technical notes: what follows the `## Brief`, less the "Before merge" and "Review" sections,
 * which have their own places on the page. A body with no brief keeps its lead text too.
 */
export function technicalNotes(body: string): string {
	const parts: { title: string; lines: string[] }[] = [{ title: '', lines: [] }];
	for (const line of body.split('\n')) {
		const heading = /^##\s+(.*?)\s*#*\s*$/.exec(line);
		if (heading) parts.push({ title: heading[1], lines: [] });
		else parts[parts.length - 1].lines.push(line);
	}
	const hasBrief = parts.some((p) => p.title === 'Brief');
	return parts
		.filter((p) => !/^(brief|before merge|review)$/i.test(p.title) && (p.title !== '' || !hasBrief))
		.map((p) => (p.title ? `## ${p.title}\n\n${p.lines.join('\n').trim()}` : p.lines.join('\n').trim()))
		.filter(Boolean)
		.join('\n\n');
}

/** A design doc with its `## Brief` section removed; the page shows the brief above the document. */
export function withoutBrief(doc: string): string {
	const out: string[] = [];
	let skipping = false;
	for (const line of doc.split('\n')) {
		if (/^##\s/.test(line)) skipping = /^##\s+Brief\s*#*\s*$/.test(line);
		if (!skipping) out.push(line);
	}
	return out.join('\n');
}

/** The markdown under "## Review" up to the next heading of level 1 or 2, or null. */
export function reviewSection(body: string): string | null {
	const lines = body.split('\n');
	const start = lines.findIndex((line) => /^##\s+review\s*#*\s*$/i.test(line));
	if (start === -1) return null;
	const section: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^#{1,2}\s/.test(line)) break;
		section.push(line);
	}
	return section.join('\n').trim() || null;
}

/** The last backticked verdict in the "## Review" section; bare words are prose. */
export function reviewVerdict(body: string): Verdict | null {
	const tokens = [...(reviewSection(body) ?? '').matchAll(/`(accept|fix|escalate)`/g)];
	return tokens.length ? (tokens[tokens.length - 1][1] as Verdict) : null;
}

interface RollupEntry {
	__typename?: string;
	name?: string;
	workflowName?: string;
	status?: string;
	conclusion?: string;
	context?: string;
	state?: string;
}

function checkRow(entry: RollupEntry): { name: string; state: CheckState } {
	if (entry.__typename === 'StatusContext') {
		const state = entry.state ?? '';
		return {
			name: entry.context ?? '',
			state: state === 'SUCCESS' ? 'pass' : state === 'PENDING' || state === 'EXPECTED' ? 'pending' : 'fail'
		};
	}
	const name = entry.workflowName ? `${entry.workflowName} / ${entry.name}` : (entry.name ?? '');
	if (entry.status !== 'COMPLETED') return { name, state: 'pending' };
	const c = entry.conclusion;
	return { name, state: c === 'SUCCESS' || c === 'NEUTRAL' ? 'pass' : c === 'SKIPPED' ? 'skip' : 'fail' };
}

export function checksSummary(rollup: readonly RollupEntry[] | null | undefined): ChecksSummary {
	const rows = (rollup ?? []).map(checkRow);
	const count = (state: CheckState) => rows.filter((r) => r.state === state).length;
	const passed = count('pass');
	const failed = count('fail');
	const skipped = count('skip');
	const pending = count('pending');
	const parts = [
		[passed, 'passed'],
		[failed, 'failed'],
		[skipped, 'skipped'],
		[pending, 'pending']
	]
		.filter(([n]) => n)
		.map(([n, label]) => `${n} ${label}`);
	return { passed, failed, skipped, pending, text: parts.length ? parts.join(', ') : 'No checks', rows };
}
