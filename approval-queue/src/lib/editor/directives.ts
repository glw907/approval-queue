// Remark-directive detection for the document editor, ported from cairn-cms
// `src/lib/admin/markdown-directives.ts` (the FENCE, INLINE, and CODE_FENCE regexes,
// `fenceScan`, `fenceTokens`, `findInlineDirectives`, and `frontmatterSpan`). Only what the
// review editor reads came across; the fold, figure, and include helpers stayed behind.

// A container fence: three or more colons, then an optional name, an optional [label], and
// optional {attrs}. The name tells an opener (named) from a closer (bare colons).
const FENCE = /^\s{0,3}(:{3,})\s*([\w-]*)\s*(\[[^\]]*\])?\s*(\{[^}]*\})?\s*$/d;
const INLINE = /(?<![:\w]):[\w-]+\[[^\]]*\](\{[^}]*\})?/g;
// A fenced code block's delimiter, tracked so a documented ::: example never opens a container.
const CODE_FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const FRONTMATTER_FENCE = /^---$/;

/** Each line's container depth and fence role, from one pass over the document. */
export interface FenceScan {
	/** The 1-based container depth per line, or null outside any container. */
	depths: (number | null)[];
	roles: ('opener' | 'closer' | null)[];
	/** The line sits strictly inside a fenced code block, so a directive shape there is literal. */
	inCode: boolean[];
}

/**
 * Scans the container structure. A named fence opens a container and a bare fence closes the most
 * recent one, since authors vary colon counts. An unmatched closer reads as depth 1, and the count
 * never goes below zero.
 */
export function fenceScan(lines: string[]): FenceScan {
	const depths: (number | null)[] = [];
	const roles: ('opener' | 'closer' | null)[] = [];
	const inCode: boolean[] = [];
	let open = 0;
	let codeMarker: string | null = null;
	for (const line of lines) {
		const code = CODE_FENCE.exec(line);
		if (code) {
			const realDelimiter = codeMarker === null || code[1][0] === codeMarker;
			if (codeMarker === null) codeMarker = code[1][0];
			else if (code[1][0] === codeMarker) codeMarker = null;
			depths.push(open > 0 ? open : null);
			roles.push(null);
			inCode.push(!realDelimiter);
			continue;
		}
		if (codeMarker !== null) {
			depths.push(open > 0 ? open : null);
			roles.push(null);
			inCode.push(true);
			continue;
		}
		const fence = FENCE.exec(line);
		if (!fence) {
			depths.push(open > 0 ? open : null);
			roles.push(null);
		} else if (fence[2]) {
			open += 1;
			depths.push(open);
			roles.push('opener');
		} else {
			depths.push(Math.max(open, 1));
			roles.push('closer');
			if (open > 0) open -= 1;
		}
		inCode.push(false);
	}
	return { depths, roles, inCode };
}

/** One span of a fence line, in line-local offsets: machinery (`mark`) or meaning (`label`). */
export interface FenceToken {
	from: number;
	to: number;
	kind: 'mark' | 'label';
}

/** Splits a fence line into machinery (colons, brackets, the attrs group) and meaning (the name and label text). */
export function fenceTokens(line: string): FenceToken[] {
	const m = FENCE.exec(line);
	if (!m?.indices) return [];
	const indices = m.indices;
	const out: FenceToken[] = [];
	const [colonFrom, colonTo] = indices[1]!;
	out.push({ from: colonFrom, to: colonTo, kind: 'mark' });
	if (m[2]) {
		const [from, to] = indices[2]!;
		out.push({ from, to, kind: 'label' });
	}
	if (m[3]) {
		const [from, to] = indices[3]!;
		out.push({ from, to: from + 1, kind: 'mark' });
		if (to - from > 2) out.push({ from: from + 1, to: to - 1, kind: 'label' });
		out.push({ from: to - 1, to, kind: 'mark' });
	}
	if (m[4]) {
		const [from, to] = indices[4]!;
		out.push({ from, to, kind: 'mark' });
	}
	return out;
}

/** Inline directive spans (`:fact[id]`) within a line. */
export function findInlineDirectives(text: string): { from: number; to: number }[] {
	return [...text.matchAll(INLINE)].map((m) => ({ from: m.index, to: m.index + m[0].length }));
}

/**
 * The YAML front matter at the top of the document as character offsets, both fences included, or
 * null. It must open with an exact `---` on the first line and close with a later exact `---`.
 */
export function frontmatterSpan(text: string): { from: number; to: number } | null {
	const lines = text.split('\n');
	if (lines.length < 2 || !FRONTMATTER_FENCE.test(lines[0]!)) return null;
	let offset = lines[0]!.length + 1;
	for (let i = 1; i < lines.length; i++) {
		if (FRONTMATTER_FENCE.test(lines[i]!)) return { from: 0, to: offset + lines[i]!.length };
		offset += lines[i]!.length + 1;
	}
	return null;
}
