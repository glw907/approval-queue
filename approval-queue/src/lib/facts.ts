/*
 * The fact-file and text grammar: parses `facts.json` (written by the working session) and `text.md`
 * (written by a fresh writer) and refuses each broken rule with one line. Like `brief.ts`, it runs
 * under plain `node` with no `node_modules`, so it imports no package and uses only erasable
 * TypeScript syntax. It checks what the two files show; `checkClaimRanges` adds the check that
 * needs the snapshot's patches.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PacketKind = 'design' | 'close' | 'stop';

export interface Source {
	text: string;
	source: string;
}

export interface CallOption {
	label: string;
	consequence: string;
}

export interface Call {
	question: string;
	rule: string;
	forced: boolean;
	options: CallOption[];
	/** The recommended option's number, counting from 1. */
	recommended: number;
	evidence: Source[];
}

export interface DecidedCall extends Call {
	/** The label of the option the session took. */
	applied: string;
}

export interface Step {
	text: string;
	who: 'session' | 'you';
}

export interface DocRef {
	repo: string;
	path: string;
}

export interface Facts {
	kind: PacketKind;
	title: string;
	/** Stop packets only: why the pass paused. */
	reason?: Source;
	/** `owner/repo#n` in merge order; empty on a design packet. */
	prs: string[];
	design?: DocRef;
	plan?: DocRef;
	/** Globs of paths the plan holds for Geoff. */
	held: string[];
	calls: Call[];
	decidedForYou: DecidedCall[];
	steps: Step[];
	notChecked: Source[];
	reviews: Source[];
}

export interface Claim {
	/** The bullet's sentence, without its citation. */
	text: string;
	pr: string;
	path: string;
	from: number;
	to: number;
}

export interface CallText {
	heading: string;
	context: string;
	risk?: string;
	recommendation?: string;
	why?: string;
}

export interface Text {
	headline: string;
	opening: string[];
	deepDive: string;
	callsLead: string;
	calls: CallText[];
	decided: CallText[];
	notChecked: string;
	changedLead: string;
	claims: Claim[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; messages: string[] };

/** The skill that holds the rules a refusal points at. */
export const PACKET_SKILL = 'the approval-packet skill';

/** The seven ask rules: what makes a call a call. */
export const RULES: readonly string[] = [
	'irreversible',
	'public-surface',
	'cross-repo',
	'owner-call',
	'low-confidence',
	'gate-failed',
	'contradicts-ruling'
];

/** The most unforced calls a packet carries; forced calls may exceed it. */
export const UNFORCED_CAP = 3;

/** The longest headline the board and the page header show on one or two lines. */
const TITLE_MAX = 80;

const PR_REF = /^[\w.-]+\/[\w.-]+#[1-9]\d*$/;
const PATH_LINE = /^[^\s:#]+:[1-9]\d*(?:-[1-9]\d*)?$/;
const URL_SOURCE = /^https?:\/\/\S+$/;

const refuse = (messages: string[]): { ok: false; messages: string[] } => ({
	ok: false,
	messages: messages.map((m) => `${m} (see ${PACKET_SKILL})`)
});

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Whether a source is a path with a line, a URL, or `owner/repo#n`. */
export function validSource(source: unknown): boolean {
	return typeof source === 'string' && (PATH_LINE.test(source) || URL_SOURCE.test(source) || PR_REF.test(source));
}

function titleDefects(title: string): string[] {
	const out: string[] = [];
	if (/[.!?]$/.test(title)) out.push('the title is a heading: drop its closing punctuation');
	if (title.length > TITLE_MAX) out.push(`the title runs ${title.length} characters; keep it to ${TITLE_MAX}`);
	return out;
}

/** Reads `[{text, source}]` into sources, adding a defect for each broken entry. */
function sourceList(value: unknown, where: string, errors: string[]): Source[] {
	if (!Array.isArray(value)) {
		errors.push(`${where} must be an array of {text, source}`);
		return [];
	}
	const out: Source[] = [];
	value.forEach((entry, i) => {
		const at = `${where} ${i + 1}`;
		if (!isObject(entry) || !isText(entry.text)) errors.push(`${at} needs a text string`);
		else if (!validSource(entry.source)) {
			errors.push(`${at} needs a source that is a path with a line, a URL, or owner/repo#n, not ${JSON.stringify(entry.source)}`);
		} else out.push({ text: entry.text, source: entry.source as string });
	});
	return out;
}

function readCall(entry: unknown, at: string, errors: string[], decided: boolean): DecidedCall | undefined {
	if (!isObject(entry)) {
		errors.push(`${at} is not an object`);
		return undefined;
	}
	const before = errors.length;
	if (!isText(entry.question)) errors.push(`${at} needs a question string`);
	if (typeof entry.rule !== 'string' || !RULES.includes(entry.rule)) {
		errors.push(`${at}: rule ${JSON.stringify(entry.rule)} is not one of the seven rules: ${RULES.join(', ')}`);
	}
	if (typeof entry.forced !== 'boolean') errors.push(`${at} needs forced to be true or false`);
	const options: CallOption[] = [];
	if (!Array.isArray(entry.options) || entry.options.length < 2) errors.push(`${at} needs at least two options`);
	else {
		const labels = new Set<string>();
		entry.options.forEach((o: unknown, i: number) => {
			if (!isObject(o) || !isText(o.label) || !isText(o.consequence)) errors.push(`${at}: option ${i + 1} needs a label and a consequence`);
			else if (labels.has(o.label)) errors.push(`${at}: two options share the label ${JSON.stringify(o.label)}`);
			else {
				labels.add(o.label);
				options.push({ label: o.label, consequence: o.consequence });
			}
		});
	}
	const recommended = entry.recommended;
	if (!Number.isInteger(recommended) || (recommended as number) < 1 || (recommended as number) > options.length) {
		errors.push(`${at}: recommended must be the number of one of its ${options.length} options, counting from 1`);
	}
	const evidence = sourceList(entry.evidence, `${at} evidence`, errors);
	if (Array.isArray(entry.evidence) && entry.evidence.length === 0) errors.push(`${at} needs at least one piece of evidence`);
	let applied = '';
	if (decided) {
		if (typeof entry.applied !== 'string' || !options.some((o) => o.label === entry.applied)) {
			errors.push(`${at}: applied must be the label of one of its options`);
		} else applied = entry.applied;
	}
	if (errors.length > before) return undefined;
	return {
		question: entry.question as string,
		rule: entry.rule as string,
		forced: entry.forced as boolean,
		options,
		recommended: recommended as number,
		evidence,
		applied
	};
}

function docRef(value: unknown, where: string, errors: string[]): DocRef | undefined {
	if (!isObject(value) || !isText(value.repo) || !isText(value.path)) {
		errors.push(`${where} must be {repo, path}`);
		return undefined;
	}
	return { repo: value.repo, path: value.path };
}

/** Parses a fact file's JSON text. Defects are collected, so one refusal lists everything to fix. */
export function parseFacts(json: string): Parsed<Facts> {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return refuse(['the fact file is not JSON']);
	}
	if (!isObject(raw)) return refuse(['the fact file must be a JSON object']);
	const errors: string[] = [];
	const kind = raw.kind;
	if (kind !== 'design' && kind !== 'close' && kind !== 'stop') errors.push('kind is design, close, or stop');
	if (!isText(raw.title)) errors.push('the fact file needs a title string');
	else errors.push(...titleDefects(raw.title));

	let reason: Source | undefined;
	if (kind === 'stop') {
		const list = sourceList(isObject(raw.reason) ? [raw.reason] : undefined, 'reason', errors);
		reason = list[0];
	} else if (raw.reason !== undefined) errors.push('only a stop packet takes a reason');

	const prs: string[] = [];
	if (!Array.isArray(raw.prs) || !raw.prs.every((p) => typeof p === 'string' && PR_REF.test(p))) {
		errors.push('prs is an array of owner/repo#n');
	} else {
		for (const p of raw.prs as string[]) {
			if (prs.includes(p)) errors.push(`${p} is listed twice in prs`);
			else prs.push(p);
		}
	}
	let design: DocRef | undefined;
	let plan: DocRef | undefined;
	if (kind === 'design') {
		design = docRef(raw.design, 'design', errors);
		if (raw.plan !== undefined) plan = docRef(raw.plan, 'plan', errors);
		if (prs.length > 0) errors.push('a design packet names no pull requests');
	} else if (kind === 'close' || kind === 'stop') {
		if (raw.design !== undefined || raw.plan !== undefined) errors.push('only a design packet takes design and plan');
		if (prs.length === 0) errors.push('a close or stop packet names at least one pull request in prs');
	}

	const held: string[] = [];
	if (raw.held !== undefined) {
		if (!Array.isArray(raw.held) || !raw.held.every((g) => isText(g))) errors.push('held is an array of path globs');
		else held.push(...(raw.held as string[]));
	}

	const calls: Call[] = [];
	if (!Array.isArray(raw.calls)) errors.push('calls must be an array');
	else {
		raw.calls.forEach((c: unknown, i: number) => {
			const call = readCall(c, `call ${i + 1}`, errors, false);
			if (call) calls.push(call);
		});
		const unforced = raw.calls.filter((c: unknown) => isObject(c) && c.forced === false).length;
		if (unforced > UNFORCED_CAP) {
			errors.push(`${unforced} unforced calls; at most ${UNFORCED_CAP}, so split the packet or settle one (forced calls may exceed the cap)`);
		}
	}
	const decidedForYou: DecidedCall[] = [];
	if (!Array.isArray(raw.decidedForYou)) errors.push('decidedForYou must be an array');
	else {
		raw.decidedForYou.forEach((c: unknown, i: number) => {
			const call = readCall(c, `decidedForYou ${i + 1}`, errors, true);
			if (call) decidedForYou.push(call);
		});
	}

	const steps: Step[] = [];
	if (!Array.isArray(raw.steps)) errors.push('steps must be an array of {text, who}');
	else {
		raw.steps.forEach((s: unknown, i: number) => {
			if (!isObject(s) || !isText(s.text) || (s.who !== 'session' && s.who !== 'you')) {
				errors.push(`step ${i + 1} needs a text string and who set to session or you`);
			} else steps.push({ text: s.text, who: s.who });
		});
	}
	if (kind === 'stop' && Array.isArray(raw.steps) && raw.steps.length === 0) errors.push('a stop packet lists the steps that approving it runs');

	const notChecked = sourceList(raw.notChecked, 'notChecked', errors);
	const reviews = sourceList(raw.reviews, 'reviews', errors);
	if (errors.length > 0) return refuse(errors);
	return {
		ok: true,
		value: {
			kind: kind as PacketKind,
			title: raw.title as string,
			...(reason && { reason }),
			prs,
			...(design && { design }),
			...(plan && { plan }),
			held,
			calls,
			decidedForYou,
			steps,
			notChecked,
			reviews
		}
	};
}

interface Line {
	text: string;
	fenced: boolean;
}

const FENCE = /^\s{0,3}(```+|~~~+)/;

function scan(text: string): Line[] {
	let open: string | null = null;
	return text.split('\n').map((raw) => {
		const fence = FENCE.exec(raw)?.[1];
		if (open === null) {
			if (fence) open = fence;
			return { text: raw, fenced: fence !== undefined };
		}
		if (fence !== undefined && fence[0] === open[0] && fence.length >= open.length) open = null;
		return { text: raw, fenced: true };
	});
}

/** Splits lines into paragraphs at blank lines, each joined into one line of prose. */
function paragraphsOf(lines: Line[]): string[] {
	const out: string[] = [];
	let open = false;
	for (const line of lines) {
		const text = line.fenced ? '' : line.text.trim();
		if (text === '') open = false;
		else if (open) out[out.length - 1] += ` ${text}`;
		else {
			out.push(text);
			open = true;
		}
	}
	return out;
}

interface Section {
	heading: string;
	body: Line[];
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const CITATION = /\s*\[([\w.-]+\/[\w.-]+#[1-9]\d*) ([^\s\]]+):([1-9]\d*)-([1-9]\d*)\]\s*$/;
const LABELS = /^(Context|Risk|Recommendation|Why):\s*(.*)$/;

/** Splits `### ` blocks out of a section body: the lead lines, then each block's heading and lines. */
function blocks(body: Line[]): { lead: Line[]; blocks: Section[] } {
	const lead: Line[] = [];
	const out: Section[] = [];
	let cur: Section | undefined;
	for (const line of body) {
		if (!line.fenced && line.text.startsWith('### ')) {
			cur = { heading: line.text.slice(4).trim(), body: [] };
			out.push(cur);
		} else if (cur) cur.body.push(line);
		else lead.push(line);
	}
	return { lead, blocks: out };
}

/** Reads a block's labeled paragraphs (`Context:` and the rest); a label's text runs to the next label. */
function labeled(block: Section): Map<string, string> {
	const out = new Map<string, string>();
	let name = '';
	for (const line of block.body) {
		if (line.fenced) continue;
		const m = LABELS.exec(line.text.trim());
		if (m) {
			name = m[1];
			out.set(name, m[2].trim());
		} else if (name && line.text.trim() !== '') out.set(name, `${out.get(name)} ${line.text.trim()}`.trim());
	}
	return out;
}

const SECTIONS = ['Deep dive', 'Your calls', 'Decided for you', 'Not checked', 'What changed'];

/**
 * Parses the writer's text against the fact file. The status line, options, steps, files, and checks
 * come from the fact file, never from the text, so the text holds only the headline, the prose, and
 * the claims.
 */
export function parseText(markdown: string, facts: Facts): Parsed<Text> {
	const lines = scan(markdown.replace(/\r\n?/g, '\n'));
	const first = lines.findIndex((l) => l.text.trim() !== '');
	const head = lines[first];
	if (!head || head.fenced || !head.text.startsWith('# ')) return refuse(['missing headline: start the text with `# <headline>`']);
	const headline = head.text.slice(2).trim();
	const errors = titleDefects(headline);

	const opening: Line[] = [];
	const sections: Section[] = [];
	let cur: Section | undefined;
	for (const line of lines.slice(first + 1)) {
		if (!line.fenced && line.text.startsWith('## ')) {
			cur = { heading: line.text.slice(3).trim(), body: [] };
			sections.push(cur);
		} else if (cur) cur.body.push(line);
		else opening.push(line);
	}
	const openingParagraphs = paragraphsOf(opening);
	if (openingParagraphs.length === 0) errors.push('the headline is followed by the opening: one or more paragraphs before the first `## ` section');

	const byName = new Map<string, Section>();
	let lastRank = -1;
	for (const section of sections) {
		const rank = SECTIONS.indexOf(section.heading);
		if (rank < 0) {
			errors.push(`\`## ${section.heading}\` is not a text section; the sections are ${SECTIONS.join(', ')}`);
			continue;
		}
		if (byName.has(section.heading)) errors.push(`\`## ${section.heading}\` appears twice; keep one`);
		else byName.set(section.heading, section);
		if (rank < lastRank) errors.push(`\`## ${section.heading}\` is out of order; the order is ${SECTIONS.join(', ')}`);
		lastRank = Math.max(lastRank, rank);
	}

	const need = (name: string, wanted: boolean, why: string) => {
		const has = byName.has(name);
		if (wanted && !has) errors.push(`\`## ${name}\` is missing; ${why}`);
		if (!wanted && has) errors.push(`\`## ${name}\` does not belong here; ${why}`);
	};
	need('Deep dive', true, 'every packet has one');
	need('Your calls', facts.calls.length > 0, facts.calls.length > 0 ? 'the fact file has calls' : 'the fact file has no calls');
	need('Decided for you', facts.decidedForYou.length > 0, facts.decidedForYou.length > 0 ? 'the fact file has decidedForYou entries' : 'the fact file has no decidedForYou entries');
	need('Not checked', true, 'every packet has one');
	need('What changed', facts.kind !== 'design', facts.kind === 'design' ? 'a design packet shows the design in its place' : 'a close or stop packet has one');

	let deepDive = '';
	const dd = byName.get('Deep dive');
	if (dd) {
		const paras = paragraphsOf(dd.body.filter((l) => l.fenced || !l.text.startsWith('### ')));
		deepDive = paras[0] ?? '';
		if (deepDive === '') errors.push('`## Deep dive` is empty; its first line is the sentence the closed fold shows');
	}

	const calls: CallText[] = [];
	let callsLead = '';
	const yc = byName.get('Your calls');
	if (yc) {
		const split = blocks(yc.body);
		callsLead = paragraphsOf(split.lead).join('\n\n');
		if (split.blocks.length !== facts.calls.length) {
			errors.push(`\`## Your calls\` has ${split.blocks.length} \`### \` blocks and the fact file has ${facts.calls.length} calls; one block per call, in the fact file's order`);
		}
		split.blocks.forEach((b, i) => {
			const l = labeled(b);
			for (const name of ['Context', 'Risk', 'Recommendation']) {
				if (!l.get(name)) errors.push(`call ${i + 1} (${b.heading}) is missing \`${name}:\``);
			}
			calls.push({ heading: b.heading, context: l.get('Context') ?? '', risk: l.get('Risk'), recommendation: l.get('Recommendation') });
		});
	}

	const decided: CallText[] = [];
	const dy = byName.get('Decided for you');
	if (dy) {
		const split = blocks(dy.body);
		if (split.blocks.length !== facts.decidedForYou.length) {
			errors.push(`\`## Decided for you\` has ${split.blocks.length} \`### \` blocks and the fact file has ${facts.decidedForYou.length} entries; one block each`);
		}
		split.blocks.forEach((b, i) => {
			const l = labeled(b);
			for (const name of ['Context', 'Why']) {
				if (!l.get(name)) errors.push(`decided-for-you ${i + 1} (${b.heading}) is missing \`${name}:\``);
			}
			decided.push({ heading: b.heading, context: l.get('Context') ?? '', why: l.get('Why') });
		});
	}

	let notChecked = '';
	const nc = byName.get('Not checked');
	if (nc) {
		notChecked = paragraphsOf(nc.body).join('\n\n');
		if (notChecked === '' && facts.notChecked.length > 0) errors.push('`## Not checked` is empty and the fact file lists items the session did not check');
	}

	const claims: Claim[] = [];
	let changedLead = '';
	const wc = byName.get('What changed');
	if (wc) {
		const leadLines: Line[] = [];
		const bullets: string[] = [];
		for (const line of wc.body) {
			const bullet = line.fenced ? null : BULLET.exec(line.text);
			if (bullet) bullets.push(bullet[1].trim());
			else if (!line.fenced && bullets.length > 0 && /^\s+\S/.test(line.text)) bullets[bullets.length - 1] += ` ${line.text.trim()}`;
			else if (bullets.length === 0) leadLines.push(line);
			else if (!line.fenced && line.text.trim() !== '') errors.push('`## What changed` is a lead paragraph, then bullets and nothing else');
		}
		for (const b of bullets) claims.push(readClaim(b, facts, errors));
		changedLead = paragraphsOf(leadLines).join('\n\n');
		if (changedLead === '') errors.push('`## What changed` opens with a lead paragraph that gives the size of the change');
		if (claims.length === 0) errors.push('`## What changed` lists at least one claim bullet');
	}

	if (errors.length > 0) return refuse(errors);
	return {
		ok: true,
		value: { headline, opening: openingParagraphs, deepDive, callsLead, calls, decided, notChecked, changedLead, claims }
	};
}

/** Reads a claim bullet, adding a defect when it has no citation or cites a pull request the fact file lacks. */
function readClaim(bullet: string, facts: Facts, errors: string[]): Claim {
	const m = CITATION.exec(bullet);
	const shown = bullet.length > 60 ? `${bullet.slice(0, 60)}...` : bullet;
	if (!m) {
		errors.push(`claim "${shown}" ends with no citation; end each claim with [owner/repo#n path:a-b]`);
		return { text: bullet, pr: '', path: '', from: 0, to: 0 };
	}
	const claim: Claim = { text: bullet.slice(0, m.index).trim(), pr: m[1], path: m[2], from: Number(m[3]), to: Number(m[4]) };
	if (claim.from > claim.to) errors.push(`claim "${shown}" cites lines ${claim.from}-${claim.to}; the range runs low to high`);
	if (!facts.prs.includes(claim.pr)) errors.push(`claim "${shown}" cites ${claim.pr}, which is not in the fact file's prs`);
	return claim;
}

/** The new-side lines of each file in a unified diff, as `[from, to]` runs; a deleted file reads on the old side. */
export function hunkLines(patch: string): Map<string, [number, number][]> {
	const files = new Map<string, [number, number][]>();
	let file = '';
	let deleted = false;
	for (const line of patch.split('\n')) {
		const diff = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
		if (diff) {
			file = diff[2];
			deleted = false;
			files.set(file, []);
			continue;
		}
		if (line.startsWith('deleted file mode')) deleted = true;
		const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk && file) {
			const [start, count] = deleted ? [Number(hunk[1]), Number(hunk[2] ?? 1)] : [Number(hunk[3]), Number(hunk[4] ?? 1)];
			if (count > 0) files.get(file)!.push([start, start + count - 1]);
		}
	}
	return files;
}

/** The patch file name for a pull request: `owner-repo-n.patch`. */
export const patchName = (pr: string): string => `${pr.replace('#', '-').replace('/', '-')}.patch`;

/** Refuses each claim whose file or line range is not in the snapshot's patch for its pull request. */
export function checkClaimRanges(claims: Claim[], snapshotDir: string): string[] {
	const errors: string[] = [];
	const cache = new Map<string, Map<string, [number, number][]>>();
	for (const c of claims) {
		if (!c.pr) continue;
		const where = `claim "${c.text.length > 60 ? `${c.text.slice(0, 60)}...` : c.text}"`;
		const file = join(snapshotDir, patchName(c.pr));
		if (!existsSync(file)) {
			errors.push(`${where} cites ${c.pr}, and the snapshot holds no patch for it`);
			continue;
		}
		if (!cache.has(c.pr)) cache.set(c.pr, hunkLines(readFileSync(file, 'utf8')));
		const runs = cache.get(c.pr)!.get(c.path);
		if (!runs) {
			errors.push(`${where} cites ${c.path}, which ${c.pr}'s snapshot does not change`);
			continue;
		}
		let covered = true;
		for (let n = c.from; n <= c.to && covered; n++) covered = runs.some(([a, b]) => n >= a && n <= b);
		if (!covered) errors.push(`${where} cites ${c.path}:${c.from}-${c.to}, and those lines are not in ${c.pr}'s snapshot`);
	}
	return errors.map((m) => `${m} (see ${PACKET_SKILL})`);
}
