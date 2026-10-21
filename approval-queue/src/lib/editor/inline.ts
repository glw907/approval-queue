// Text pieces a note or the outline renders as elements, so no markup string is ever built.

/** A run of text, set as code when it was a backtick span. */
export interface Span {
	text: string;
	code: boolean;
}

/** Splits text on single-backtick code spans; an unpaired backtick stays literal. */
export function codeSpans(text: string): Span[] {
	const out: Span[] = [];
	let last = 0;
	for (const m of text.matchAll(/`([^`]+)`/g)) {
		if (m.index > last) out.push({ text: text.slice(last, m.index), code: false });
		out.push({ text: m[1], code: true });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ text: text.slice(last), code: false });
	return out;
}

/** One run of a word diff: kept, removed from the old text, or added in the new. */
export interface DiffRun {
	op: 'same' | 'del' | 'ins';
	text: string;
}

/**
 * A word-level diff of two strings by longest common subsequence over words and the whitespace
 * between them. Quadratic in the word count, which a note's one or two sentences keep small.
 */
export function wordDiff(a: string, b: string): DiffRun[] {
	const A = a.split(/(\s+)/);
	const B = b.split(/(\s+)/);
	const n = A.length;
	const m = B.length;
	const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
	}
	const out: DiffRun[] = [];
	const push = (op: DiffRun['op'], text: string) => {
		const prev = out.at(-1);
		if (prev?.op === op) prev.text += text;
		else out.push({ op, text });
	};
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (A[i] === B[j]) {
			push('same', A[i]);
			i++;
			j++;
		} else if (L[i + 1][j] >= L[i][j + 1]) push('del', A[i++]);
		else push('ins', B[j++]);
	}
	while (i < n) push('del', A[i++]);
	while (j < m) push('ins', B[j++]);
	return out.filter((r) => r.text !== '');
}
