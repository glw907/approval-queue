/**
 * One changed passage between two versions of a document.
 *
 * @remarks
 * `removed` and `added` are exact substrings of the sent and returned sources, each starting and
 * ending on a non-space character unless it is empty. `line` counts from 1 at the returned file's
 * first line and names the line where the change starts.
 */
export type Passage = { removed: string; added: string; line: number };

export type Comparison = {
	passages: Passage[];
	/** The returned source with `{--removed--}{++added++}` placed at each passage. */
	marked: string;
	/** True when the versions share no block and no clause; `passages` is then empty. */
	whole: boolean;
};

type Block = { lineStart: number; start: number; end: number; text: string };
type Token = { start: number; end: number; text: string };
type Range = { start: number; end: number };
type Edit = { start: number; end: number; text: string };

const HEADING = /^#{1,6}\s/;
const STARTS_BLOCK = /^(\s*([-*]|\d+\.)\s|:::)/;
const MARKER = /^\s*(#{1,6}|[-*]|\d+\.)\s+/;
const TOKEN = /[,.;:?!]|[^,.;:?!]+/g;

/**
 * Compares the sent and returned versions of one document, block by block and then clause by
 * clause inside a changed block, ignoring both headers.
 */
export function compare(sent: string, returned: string): Comparison {
	const sentBlocks = blocks(sent);
	const returnedBlocks = blocks(returned);
	const matches = lcs(
		sentBlocks.map((b) => b.text),
		returnedBlocks.map((b) => b.text)
	);

	const passages: Passage[] = [];
	const edits: Edit[] = [];
	let shared = matches.length > 0;

	let i = 0;
	let j = 0;
	for (const [mi, mj] of [...matches, [sentBlocks.length, returnedBlocks.length]]) {
		const removedBlocks = sentBlocks.slice(i, mi);
		const addedBlocks = returnedBlocks.slice(j, mj);
		const paired = Math.min(removedBlocks.length, addedBlocks.length);
		for (let k = 0; k < paired; k++) {
			const s = removedBlocks[k];
			const r = addedBlocks[k];
			const changes = clauseChanges(sent, s, returned, r);
			if (changes.shared) shared = true;
			for (const [sr, rr] of changes.ranges) {
				const removed = trim(sent, sr);
				const added = trim(returned, rr);
				passages.push(passage(sent, removed, returned, added));
				edits.push({ start: added.start, end: added.end, text: marks(sent, removed, returned, added) });
			}
		}
		for (const s of removedBlocks.slice(paired)) {
			const at = mj < returnedBlocks.length ? returnedBlocks[mj].lineStart : returned.length;
			const empty = { start: at, end: at };
			passages.push(passage(sent, s, returned, empty));
			const text = `{--${s.text}--}`;
			edits.push({
				start: at,
				end: at,
				text: at < returned.length ? `${text}\n\n` : returned.endsWith('\n') ? `\n${text}\n` : `\n\n${text}`
			});
		}
		for (const r of addedBlocks.slice(paired)) {
			passages.push(passage(sent, { start: 0, end: 0 }, returned, r));
			edits.push({ start: r.start, end: r.end, text: `{++${r.text}++}` });
		}
		i = mi + 1;
		j = mj + 1;
	}

	if (!shared && sentBlocks.length + returnedBlocks.length > 0) {
		return { passages: [], marked: returned, whole: true };
	}
	return { passages, marked: apply(returned, edits), whole: false };
}

function blocks(source: string): Block[] {
	const out: Block[] = [];
	let current: Block | undefined;
	const close = () => {
		if (current) out.push({ ...current, text: source.slice(current.start, current.end) });
		current = undefined;
	};
	const open = (lineStart: number, line: string, end: number) => {
		const marker = MARKER.exec(line);
		current = { lineStart, start: lineStart + (marker ? marker[0].length : 0), end, text: '' };
	};

	let offset = bodyStart(source);
	while (offset < source.length) {
		const newline = source.indexOf('\n', offset);
		const end = newline === -1 ? source.length : newline;
		const line = source.slice(offset, end).replace(/\r$/, '');
		const lineEnd = offset + line.length;
		if (line.trim() === '') {
			close();
		} else if (HEADING.test(line)) {
			close();
			open(offset, line, lineEnd);
			close();
		} else if (!current || STARTS_BLOCK.test(line)) {
			close();
			open(offset, line, lineEnd);
		} else {
			current.end = lineEnd;
		}
		offset = end + 1;
	}
	close();
	return out;
}

// The offset just past the header's closing --- line, or 0 when the source has no header.
function bodyStart(source: string): number {
	if (!/^---\r?\n/.test(source)) return 0;
	const close = /^---\r?$/m;
	const rest = source.slice(source.indexOf('\n') + 1);
	const found = close.exec(rest);
	if (!found) return 0;
	const after = source.indexOf('\n') + 1 + found.index + found[0].length;
	return source[after] === '\n' ? after + 1 : after;
}

function tokens(source: string, block: Block): Token[] {
	const out: Token[] = [];
	for (const m of block.text.matchAll(TOKEN)) {
		const start = block.start + (m.index ?? 0);
		out.push({ start, end: start + m[0].length, text: m[0] });
	}
	return out;
}

// A token that carries words; punctuation and bare spaces don't count as a shared clause.
function content(token: Token): boolean {
	return !/^[\s,.;:?!]*$/.test(token.text);
}

function clauseChanges(
	sent: string,
	s: Block,
	returned: string,
	r: Block
): { shared: boolean; ranges: [Range, Range][] } {
	const a = tokens(sent, s);
	const b = tokens(returned, r);
	const matches = lcs(
		a.map((t) => t.text),
		b.map((t) => t.text)
	);
	if (!matches.some(([mi]) => content(a[mi]))) {
		return { shared: false, ranges: [[s, r]] };
	}

	// Each run is the token ranges [ai, aj) and [bi, bj) left unmatched between two matches.
	const runs: { ai: number; aj: number; bi: number; bj: number }[] = [];
	let i = 0;
	let j = 0;
	for (const [mi, mj] of [...matches, [a.length, b.length]]) {
		if (mi > i || mj > j) {
			const last = runs[runs.length - 1];
			const between = last ? a.slice(last.aj, i) : [];
			if (last && !between.some(content)) {
				last.aj = mi;
				last.bj = mj;
			} else {
				runs.push({ ai: i, aj: mi, bi: j, bj: mj });
			}
		}
		i = mi + 1;
		j = mj + 1;
	}

	const span = (list: Token[], from: number, to: number, block: Block): Range => {
		const start = from < list.length ? list[from].start : block.end;
		const end = to > from ? list[to - 1].end : start;
		return { start, end };
	};
	return {
		shared: true,
		ranges: runs.map((run) => [span(a, run.ai, run.aj, s), span(b, run.bi, run.bj, r)])
	};
}

// Spaces at either end of a changed run count as shared, so the marks keep them outside.
function trim(source: string, range: Range): Range {
	let { start, end } = range;
	while (start < end && /\s/.test(source[start])) start++;
	while (end > start && /\s/.test(source[end - 1])) end--;
	return { start, end };
}

function passage(sent: string, removed: Range, returned: string, added: Range): Passage {
	return {
		removed: sent.slice(removed.start, removed.end),
		added: returned.slice(added.start, added.end),
		line: lineOf(returned, added.start)
	};
}

function marks(sent: string, removed: Range, returned: string, added: Range): string {
	const del = removed.end > removed.start ? `{--${sent.slice(removed.start, removed.end)}--}` : '';
	const ins = added.end > added.start ? `{++${returned.slice(added.start, added.end)}++}` : '';
	return del + ins;
}

function lineOf(source: string, offset: number): number {
	let line = 1;
	for (let k = source.indexOf('\n'); k !== -1 && k < offset; k = source.indexOf('\n', k + 1)) line++;
	return line;
}

function apply(source: string, edits: Edit[]): string {
	let out = '';
	let at = 0;
	for (const edit of [...edits].sort((x, y) => x.start - y.start)) {
		out += source.slice(at, edit.start) + edit.text;
		at = edit.end;
	}
	return out + source.slice(at);
}

// Matched index pairs of a longest common subsequence, in order.
function lcs(a: string[], b: string[]): [number, number][] {
	const width = b.length + 1;
	const table = new Uint32Array((a.length + 1) * width);
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i * width + j] =
				a[i] === b[j]
					? table[(i + 1) * width + j + 1] + 1
					: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
		}
	}
	const out: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			out.push([i, j]);
			i++;
			j++;
		} else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
			i++;
		} else {
			j++;
		}
	}
	return out;
}
