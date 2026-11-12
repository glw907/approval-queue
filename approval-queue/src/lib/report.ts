/** Pure readers of a round report's Markdown: the board's headline and the page's body. */

const cells = (line: string): string[] =>
	line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((c) => c.trim());

const isRule = (line: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

/** The states of the first table whose header row has a `State` cell, one per row, in row order; undefined when none has. */
function passStates(text: string): string[] | undefined {
	const lines = text.split('\n');
	for (let i = 0; i + 1 < lines.length; i++) {
		if (!lines[i].includes('|') || !isRule(lines[i + 1])) continue;
		const column = cells(lines[i]).findIndex((c) => c.toLowerCase() === 'state');
		if (column < 0) continue;
		const states: string[] = [];
		for (let j = i + 2; j < lines.length && lines[j].includes('|'); j++) states.push(cells(lines[j])[column] ?? '');
		return states;
	}
	return undefined;
}

/**
 * The board's headline for a report, "3 of 4 passes merged, 1 parked": the merged rows of the pass table,
 * then each other state with its count in the order the table first shows it. Empty when the report has no
 * table with a `State` column.
 */
export function reportHeadline(text: string): string {
	const states = passStates(text);
	if (!states) return '';
	const others = new Map<string, number>();
	for (const s of states) if (s.toLowerCase() !== 'merged') others.set(s, (others.get(s) ?? 0) + 1);
	const merged = states.length - [...others.values()].reduce((a, b) => a + b, 0);
	return [`${merged} of ${states.length} passes merged`, ...[...others].map(([s, n]) => `${n} ${s}`)].join(', ');
}

/** The report without its first line when that line is the `# ` heading the title came from; any other text comes back whole. */
export function reportBody(text: string): string {
	if (!text.startsWith('# ')) return text;
	const end = text.indexOf('\n');
	return end < 0 ? '' : text.slice(end + 1);
}
