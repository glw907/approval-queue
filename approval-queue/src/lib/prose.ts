export interface ProseSpan {
	kind: 'text' | 'code' | 'date';
	text: string;
}

/** Straight quotes become curly; call it on prose only, never on a code span, URL, or attribute. */
export function curly(text: string): string {
	return text
		.replace(/(^|[\s(\[—])'/g, '$1‘')
		.replace(/'/g, '’')
		.replace(/(^|[\s(\[—])"/g, '$1“')
		.replace(/"/g, '”');
}

/** The first sentence of a paragraph and the rest; the first is a collapse's closed row. */
export function splitLead(text: string): { lead: string; rest: string } {
	const m = /^(.+?[.?!])\s+(?=[A-Z0-9`"“(])/.exec(text);
	return m ? { lead: m[1], rest: text.slice(m[0].length).trim() } : { lead: text, rest: '' };
}

/**
 * Splits a packet's plain text into spans the page renders without `{@html}`: backtick code spans
 * stay literal, quotes curl outside them, and an ISO date is its own span so it never breaks at a hyphen.
 */
export function proseSpans(text: string): ProseSpan[] {
	const spans: ProseSpan[] = [];
	for (const [i, part] of text.split(/(`[^`]+`)/).entries()) {
		if (i % 2) {
			spans.push({ kind: 'code', text: part.slice(1, -1) });
			continue;
		}
		for (const [j, piece] of curly(part).split(/(\d{4}-\d{2}-\d{2})/).entries()) {
			if (piece) spans.push({ kind: j % 2 ? 'date' : 'text', text: piece });
		}
	}
	return spans;
}
