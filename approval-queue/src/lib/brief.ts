/*
 * The brief contract: parses the `## Brief` of a PR body or design doc and validates a triage file.
 * `approval-queue` runs this under plain `node` with no `node_modules`, so this file imports no
 * package and uses only erasable TypeScript syntax.
 */

/** Where the register that teaches the brief lives; every refusal names it. */
export const REGISTER_PATH = '~/.claude/docs/voice/approval-brief.md';

export type Proposed = 'now' | 'defer' | 'drop';

export interface TriageRow {
	action: string;
	why: string;
	/** The technical text behind the row; absent when the session had none. */
	detail?: string;
	proposed: Proposed;
}

export interface Triage {
	headline: string;
	lede: string;
	rows: TriageRow[];
}

export interface Choice {
	label: string;
	recommended: boolean;
}

export interface DecideBlock {
	title: string;
	text: string;
	source?: string;
	choices: Choice[];
}

export interface DetailSection {
	label: string;
	/** The first sentence of the section, shown while the row is closed. */
	summary: string;
	/** The section's whole text as markdown, summary included; the blocks after its first paragraph keep their line breaks. */
	body: string;
}

export interface Brief {
	headline: string;
	lede: string;
	whatChanges: string[];
	ifYouApprove: string[];
	decides: DecideBlock[];
	worthKnowing?: string;
	details: DetailSection[];
}

/** `messages` are ready to print: each names the defect and the register path. */
export type Result<T> = ({ ok: true } & T) | { ok: false; messages: string[] };

const PROPOSED: readonly string[] = ['now', 'defer', 'drop'];
const CONTRACT_HEADINGS = ['What changes', 'If you approve', 'Worth knowing'];

const refusal = (message: string) => `${message} (see ${REGISTER_PATH})`;
const refuse = (...messages: string[]): { ok: false; messages: string[] } => ({
	ok: false,
	messages: messages.map(refusal)
});

interface Line {
	text: string;
	/** True for a code fence's lines, fences included, so a heading inside one never counts. */
	fenced: boolean;
}

type BlockKind = 'paragraph' | 'bullets' | 'numbers' | 'table' | 'other';

interface Block {
	kind: BlockKind;
	lines: string[];
}

const FENCE = /^\s{0,3}(```|~~~)/;
const BULLET = /^\s{0,3}[-*+]\s+/;
const NUMBER = /^\s{0,3}\d+[.)]\s+/;
const TABLE = /^\s{0,3}\|/;

function scan(text: string): Line[] {
	let open: string | null = null;
	return text.split('\n').map((raw) => {
		const fence = FENCE.exec(raw)?.[1];
		if (open === null) {
			if (fence) open = fence;
			return { text: raw, fenced: fence !== undefined };
		}
		if (fence === open) open = null;
		return { text: raw, fenced: true };
	});
}

const isHeading = (line: Line, level: '## ' | '### ') => !line.fenced && line.text.startsWith(level);

function classify(line: string): BlockKind {
	if (BULLET.test(line)) return 'bullets';
	if (NUMBER.test(line)) return 'numbers';
	if (TABLE.test(line)) return 'table';
	return 'paragraph';
}

/** Splits lines into blank-separated blocks; a list marker starts a new block, and a split list rejoins. */
function blocks(lines: Line[]): Block[] {
	const out: Block[] = [];
	let cur: Line[] = [];
	const flush = () => {
		if (cur.length > 0) {
			const kind = cur[0].fenced ? 'other' : classify(cur[0].text);
			const text = cur.map((l) => l.text);
			const last = out.at(-1);
			if (last && kind === last.kind && (kind === 'bullets' || kind === 'numbers')) last.lines.push(...text);
			else out.push({ kind, lines: text });
		}
		cur = [];
	};
	for (const line of lines) {
		if (!line.fenced && line.text.trim() === '') flush();
		else if (cur.length > 0 && cur[0].fenced !== line.fenced) {
			flush();
			cur.push(line);
		} else if (!line.fenced && cur.length > 0 && cur[0].fenced === false && classify(cur[0].text) === 'paragraph' && classify(line.text) !== 'paragraph') {
			flush();
			cur.push(line);
		} else cur.push(line);
	}
	flush();
	return out;
}

const paragraphText = (block: Block) => block.lines.map((l) => l.trim()).join(' ');

function listItems(block: Block): string[] {
	const items: string[] = [];
	for (const line of block.lines) {
		if (classify(line) === block.kind) items.push(line.replace(BULLET, '').replace(NUMBER, '').trim());
		else items[items.length - 1] += ` ${line.trim()}`;
	}
	return items;
}

/** Sentences by `Intl.Segmenter`, which keeps "e.g.", "U.S.", and "PR #40." whole. */
function sentences(text: string): string[] {
	const parts = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)];
	return parts.map((p) => p.segment.trim()).filter((s) => s !== '');
}

interface Section {
	heading: string;
	blocks: Block[];
}

function sections(lines: Line[]): Section[] {
	const out: Section[] = [];
	let cur: { heading: string; lines: Line[] } | undefined;
	for (const line of lines) {
		if (isHeading(line, '### ')) {
			if (cur) out.push({ heading: cur.heading, blocks: blocks(cur.lines) });
			cur = { heading: line.text.slice(4).trim(), lines: [] };
		} else cur?.lines.push(line);
	}
	if (cur) out.push({ heading: cur.heading, blocks: blocks(cur.lines) });
	return out;
}

function decide(title: string, found: Block[], errors: string[]): DecideBlock | undefined {
	const name = `\`### Decide: ${title}\``;
	const [first, ...rest] = found;
	if (!first || first.kind !== 'paragraph' || first.lines[0].trim().startsWith('Source:')) {
		errors.push(`${name} must open with a paragraph`);
		return undefined;
	}
	if (first.lines.some((l, i) => i > 0 && l.trim().startsWith('Source:'))) {
		errors.push(`${name}: \`Source:\` must stand as its own paragraph`);
		return undefined;
	}
	let source: string | undefined;
	if (rest[0]?.kind === 'paragraph' && rest[0].lines[0].trim().startsWith('Source:')) {
		source = paragraphText(rest[0]).slice('Source:'.length).trim();
		rest.shift();
	}
	const list = rest[0];
	const items = list && (list.kind === 'bullets' || list.kind === 'numbers') ? listItems(list) : [];
	if (items.length < 2) {
		errors.push(`${name} needs a list of at least two choices`);
		return undefined;
	}
	const choices = items.map((item) => {
		const recommended = item.endsWith('(recommended)');
		return { label: recommended ? item.slice(0, -'(recommended)'.length).trim() : item, recommended };
	});
	if (choices.filter((c) => c.recommended).length > 1) {
		errors.push(`${name} marks more than one choice \`(recommended)\``);
		return undefined;
	}
	return { title, text: paragraphText(first), ...(source !== undefined && { source }), choices };
}

/**
 * Parses the brief from a PR body or a design doc; the markdown carries no kind, because the
 * contract is the same for both. A defect in a section is collected with the others, so one
 * refusal lists everything to fix.
 */
export function parseBrief(markdown: string): Result<{ brief: Brief }> {
	const lines = scan(markdown.replace(/\r\n?/g, '\n'));
	const start = lines.findIndex((l) => isHeading(l, '## '));
	if (start < 0 || lines[start].text.trimEnd() !== '## Brief') {
		return refuse('no `## Brief`; it must be the first `##` heading');
	}
	let end = lines.findIndex((l, i) => i > start && isHeading(l, '## '));
	if (end < 0) end = lines.length;
	const region = lines.slice(start + 1, end);
	const firstSection = region.findIndex((l) => isHeading(l, '### '));
	const lead = blocks(firstSection < 0 ? region : region.slice(0, firstSection));

	if (lead[0]?.kind !== 'paragraph') return refuse('missing headline: the first thing under `## Brief` is a paragraph');
	const [headline, ...more] = sentences(paragraphText(lead[0]));
	let lede = more.join(' ');
	if (lede === '') {
		if (lead[1]?.kind !== 'paragraph') return refuse('missing lede: add a paragraph after the headline sentence');
		lede = paragraphText(lead[1]);
	}

	const errors: string[] = [];
	const seen = new Set<string>();
	const brief: Brief = { headline, lede, whatChanges: [], ifYouApprove: [], decides: [], details: [] };
	let haveChanges = false;
	let haveApprove = false;

	for (const { heading, blocks: found } of firstSection < 0 ? [] : sections(region.slice(firstSection))) {
		const exact = CONTRACT_HEADINGS.find((h) => h === heading);
		const loose = CONTRACT_HEADINGS.find((h) => h.toLowerCase() === heading.toLowerCase());
		if (!exact && loose) {
			errors.push(`write it as \`### ${loose}\``);
			continue;
		}
		if (exact) {
			if (seen.has(exact)) {
				errors.push(`\`### ${exact}\` appears twice; keep one`);
				continue;
			}
			seen.add(exact);
		}
		const first = found[0];
		if (found.length > 1 && (heading === 'What changes' || heading === 'If you approve' || heading === 'Worth knowing')) {
			// Anything after the one block would be dropped from the page, so it is refused instead.
			errors.push(`\`### ${heading}\` holds only its ${heading === 'Worth knowing' ? 'paragraph' : 'list'}; move the rest to a detail section`);
		} else if (heading === 'What changes') {
			if (first?.kind !== 'bullets') errors.push('`### What changes` must open with a bulleted list');
			else {
				brief.whatChanges = listItems(first);
				haveChanges = true;
			}
		} else if (heading === 'If you approve') {
			if (first?.kind !== 'numbers') errors.push('`### If you approve` must open with a numbered list');
			else {
				brief.ifYouApprove = listItems(first);
				haveApprove = true;
			}
		} else if (heading === 'Worth knowing') {
			if (first?.kind !== 'paragraph') errors.push('`### Worth knowing` must hold a paragraph');
			else brief.worthKnowing = paragraphText(first);
		} else if (heading === 'Decide' || heading === 'Decide:') {
			errors.push('`### Decide:` needs a title, as in `### Decide: <title>`');
		} else if (heading.startsWith('Decide:')) {
			const block = decide(heading.slice('Decide:'.length).trim(), found, errors);
			if (block) brief.decides.push(block);
		} else if (/^decide\s*:/i.test(heading)) {
			errors.push('write it as `### Decide: <title>`');
		} else if (first?.kind === 'table') {
			// A table has no first sentence to show on the closed row, so the row shows its name alone.
			brief.details.push({ label: heading, summary: '', body: found.map((b) => b.lines.join('\n')).join('\n\n') });
		} else if (first?.kind !== 'paragraph') {
			errors.push(`\`### ${heading}\` must open with a paragraph, whose first sentence is its summary, or a table`);
		} else {
			const lead = paragraphText(first);
			// The first paragraph is joined to one line so its first sentence matches the summary; the
			// blocks after it (lists, code fences, more paragraphs) keep their own lines for the page.
			const body = [lead, ...found.slice(1).map((b) => b.lines.join('\n'))].join('\n\n');
			brief.details.push({ label: heading, summary: sentences(lead)[0], body });
		}
	}
	if (!haveChanges && !seen.has('What changes')) errors.unshift('`### What changes` is missing; it needs a bulleted list');
	if (!haveApprove && !seen.has('If you approve')) errors.unshift('`### If you approve` is missing; it needs a numbered list');

	return errors.length > 0 ? refuse(...errors) : { ok: true, brief };
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** Validates the text of a triage file against `{headline, lede, rows}`. */
export function validateTriage(text: string): Result<{ triage: Triage }> {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return refuse('triage file: not valid JSON');
	}
	if (Array.isArray(data)) return refuse('triage file: old triage shape; write `{headline, lede, rows}`');
	if (typeof data !== 'object' || data === null) return refuse('triage file: write `{headline, lede, rows}`');
	const { headline, lede, rows } = data as Record<string, unknown>;
	const errors: string[] = [];
	if (!isText(headline)) errors.push('triage file: missing or empty `headline`');
	if (!isText(lede)) errors.push('triage file: missing or empty `lede`');
	if (!Array.isArray(rows) || rows.length === 0) errors.push('triage file: missing or empty `rows`');
	else {
		rows.forEach((row: unknown, i) => {
			const r = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>;
			const at = `triage row ${i + 1}`;
			if (!isText(r.action)) errors.push(`${at}: missing \`action\``);
			if (!isText(r.why)) errors.push(`${at}: missing \`why\``);
			if (typeof r.proposed !== 'string' || !PROPOSED.includes(r.proposed)) {
				errors.push(`${at}: \`proposed\` must be now, defer, or drop`);
			}
			if (r.detail !== undefined && typeof r.detail !== 'string') errors.push(`${at}: \`detail\` must be text`);
		});
	}
	return errors.length > 0 ? refuse(...errors) : { ok: true, triage: data as Triage };
}
