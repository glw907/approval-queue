/*
 * The packet contract: parses a packet file and refuses one that breaks the grammar. Like
 * `brief.ts`, it runs under plain `node` with no `node_modules`, so it imports no package and uses
 * only erasable TypeScript syntax. It checks what the file alone shows; the checks that need PR
 * data belong to the command.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { REGISTER_PATH, type Result } from './brief.ts';

export type PartKind = 'pr' | 'design' | 'step';

export interface PartRef {
	ref: string;
	kind: PartKind;
	/** Set for `pr` and `design` refs. */
	owner?: string;
	repo?: string;
	/** The PR number, for `pr`. */
	number?: number;
	/** The path inside the repo, for `design`. */
	path?: string;
	/** The step number, for `step`. */
	step?: number;
}

export type StepTag = 'session' | 'irreversible' | 'you';

export interface PlanStep {
	n: number;
	tag: StepTag;
	/** The label of a `you` step; absent for the other tags. */
	label?: string;
	text: string;
}

export interface PacketChoice {
	label: string;
	consequence: string;
	/** The part verdict this choice sets; absent when the ask binds no part. */
	verdict?: string;
}

export interface PacketFact {
	text: string;
	source: string;
}

export interface PacketAsk {
	question: string;
	rule: string;
	/** The bound part, or `null` for `Part: none`. */
	part: PartRef | null;
	/** The recommended choice's number, counting from 1. */
	recommended: number;
	reason: string;
	summary: string;
	background: string;
	factsLead: string;
	facts: PacketFact[];
	choices: PacketChoice[];
	evidence?: { lead: string; excerpt: string };
}

export interface RoutineRow {
	part: PartRef;
	verdict: string;
	fact: string;
	why: string;
}

export interface Packet {
	/** The title: a Google-style heading with no closing punctuation. */
	headline: string;
	/** The description's first paragraph: where the packet sits and why it is here now. */
	background: string;
	/** The description's other one or two paragraphs: what is proposed, what approving does, and how. */
	summary: string[];
	/** The revision's bullets, from `## What changed`; absent on a first packet. */
	whatChanged?: string[];
	steps: PlanStep[];
	notChecked: string;
	asks: PacketAsk[];
	routine: RoutineRow[];
	/** Every part in document order, asks first, each tagged with where it appears. */
	parts: { part: PartRef; in: 'ask' | 'routine' }[];
}

export interface PacketOptions {
	/** Whether a design file exists; defaults to a lookup under `$APPROVAL_QUEUE_PROJECTS`. */
	designExists?: (repo: string, path: string) => boolean;
}

export const RULES: readonly string[] = [
	'irreversible',
	'public-surface',
	'cross-repo',
	'owner-call',
	'low-confidence',
	'gate-failed',
	'contradicts-ruling'
];

/** The verdicts each kind of part takes. */
export const VERDICTS: Record<PartKind, readonly string[]> = {
	pr: ['approve', 'hold', 'send-back'],
	design: ['approve', 'hold', 'send-back'],
	step: ['session', 'you', 'skip']
};

const refusal = (message: string) => `${message} (see ${REGISTER_PATH})`;
const refuse = (...messages: string[]): { ok: false; messages: string[] } => ({
	ok: false,
	messages: messages.map(refusal)
});

const defaultDesignExists = (repo: string, path: string) =>
	existsSync(join(process.env.APPROVAL_QUEUE_PROJECTS ?? join(homedir(), 'Projects'), repo, path));

const PR_REF = /^([\w.-]+)\/([\w.-]+)#([1-9]\d*)$/;
const DESIGN_REF = /^([\w.-]+)\/([\w.-]+):([^\s:]+)$/;
const STEP_REF = /^step:([1-9]\d*)$/;

/** Reads a ref in its canonical form; anything else is `undefined`, because nothing is normalized. */
export function parseRef(ref: string): PartRef | undefined {
	let m = PR_REF.exec(ref);
	if (m) return { ref, kind: 'pr', owner: m[1], repo: m[2], number: Number(m[3]) };
	m = DESIGN_REF.exec(ref);
	if (m) return { ref, kind: 'design', owner: m[1], repo: m[2], path: m[3] };
	m = STEP_REF.exec(ref);
	if (m) return { ref, kind: 'step', step: Number(m[1]) };
	return undefined;
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

const prose = (lines: Line[]) =>
	lines
		.filter((l) => !l.fenced)
		.map((l) => l.text.trim())
		.filter((t) => t !== '')
		.join(' ');

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

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const FIELD = /^(Rule|Part|Recommended|Reason|Summary|Background|Facts|Evidence):(?: (.*))?$/;
const STEP = /^\[(session|irreversible|you)(?::\s*([^\]]+))?\]\s+/;
const NUMBERED = /^\s{0,3}(\d+)[.)]\s+(.*)$/;

interface Field {
	text: string;
	bullets: string[];
}

/** Splits an ask's body into its labeled fields; text outside a field is dropped. */
function askFields(body: Line[]): { fields: Map<string, Field>; excerpt: string[] } {
	const fields = new Map<string, Field>();
	const excerpt: string[] = [];
	let cur: Field | undefined;
	let curName = '';
	for (const line of body) {
		if (line.fenced) {
			if (curName === 'Evidence' && !FENCE.test(line.text)) excerpt.push(line.text);
			continue;
		}
		const m = FIELD.exec(line.text);
		const choices = /^Choices:\s*$/.test(line.text);
		if (m || choices) {
			curName = choices ? 'Choices' : m![1];
			cur = { text: m?.[2]?.trim() ?? '', bullets: [] };
			fields.set(curName, cur);
			continue;
		}
		const t = line.text.trim();
		if (!cur || t === '') continue;
		const b = BULLET.exec(line.text);
		if (b) cur.bullets.push(b[1].trim());
		else if (cur.bullets.length > 0) cur.bullets[cur.bullets.length - 1] += ` ${t}`;
		else cur.text = cur.text === '' ? t : `${cur.text} ${t}`;
	}
	return { fields, excerpt };
}

/** Splits a table row into cells on unescaped pipes. */
function cells(line: string): string[] {
	const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
	return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

interface RawSection {
	heading: string;
	body: Line[];
}

/** The longest title the board and the header show on one or two lines. */
const TITLE_MAX = 80;

/** Defects of a title: a heading with no closing punctuation, short enough for the board. */
export function titleDefects(title: string): string[] {
	const defects: string[] = [];
	if (/[.!?]$/.test(title)) defects.push('the title is a heading: drop its closing punctuation');
	if (title.length > TITLE_MAX) defects.push(`the title runs ${title.length} characters; keep it to ${TITLE_MAX}`);
	return defects;
}

/** Defects of a description's paragraphs: a background paragraph, then one or two summary paragraphs. */
export function descriptionDefects(paragraphs: readonly string[]): string[] {
	if (paragraphs.length < 2) {
		return ['the description is a background paragraph, then one or two summary paragraphs, under the title'];
	}
	if (paragraphs.length > 3) {
		return [`the description has ${paragraphs.length} paragraphs; keep it to a background paragraph and one or two summary paragraphs`];
	}
	return [];
}

/** Splits a description file into its paragraphs, each joined into one line. */
export function descriptionParagraphs(text: string): string[] {
	return paragraphsOf(scan(text.replace(/\r\n?/g, '\n')));
}

/**
 * Parses a packet file. Defects are collected, so one refusal lists everything to fix, except a
 * missing title, which stops the parse because nothing after it can be placed.
 */
export function parsePacket(markdown: string, options: PacketOptions = {}): Result<{ packet: Packet }> {
	const designExists = options.designExists ?? defaultDesignExists;
	const lines = scan(markdown.replace(/\r\n?/g, '\n'));
	const firstContent = lines.findIndex((l) => l.text.trim() !== '');
	const headingLine = lines[firstContent];
	if (!headingLine || headingLine.fenced || !headingLine.text.startsWith('# ')) {
		return refuse('missing title: start the file with `# <title>`');
	}
	const headline = headingLine.text.slice(2).trim();
	const errors: string[] = titleDefects(headline);

	const sections: RawSection[] = [];
	const description: Line[] = [];
	let cur: RawSection | undefined;
	for (const line of lines.slice(firstContent + 1)) {
		if (!line.fenced && line.text.startsWith('## ')) {
			cur = { heading: line.text.slice(3).trim(), body: [] };
			sections.push(cur);
		} else if (cur) cur.body.push(line);
		else description.push(line);
	}
	const paragraphs = paragraphsOf(description);
	errors.push(...descriptionDefects(paragraphs));

	const required = ['If you approve', 'Not checked'];
	const named = new Map<string, RawSection>();
	const asks: RawSection[] = [];
	let routine: RawSection | undefined;
	let changed: RawSection | undefined;
	let lastRank = -1;
	for (const section of sections) {
		const h = section.heading;
		const rank = h === 'What changed' ? 0 : required.indexOf(h) >= 0 ? required.indexOf(h) + 1 : h.startsWith('Ask:') ? 3 : h === 'Routine' ? 4 : -1;
		if (h === 'Background') {
			errors.push('`## Background` is not a packet section; its text is the first paragraph under the title');
			continue;
		}
		if (rank < 0) {
			errors.push(`\`## ${h}\` is not a packet section`);
			continue;
		}
		if (rank < lastRank) errors.push(`\`## ${h}\` is out of order; the order is What changed (a revision only), ${required.join(', ')}, the asks, then Routine`);
		lastRank = Math.max(lastRank, rank);
		if (rank === 0) {
			if (changed) errors.push('`## What changed` appears twice; keep one');
			else changed = section;
		} else if (rank < 3) {
			if (named.has(h)) errors.push(`\`## ${h}\` appears twice; keep one`);
			else named.set(h, section);
		} else if (rank === 3) asks.push(section);
		else if (routine) errors.push('`## Routine` appears twice; keep one');
		else routine = section;
	}
	for (const name of required) {
		const section = named.get(name);
		if (!section) errors.push(`\`## ${name}\` is missing`);
		else if (prose(section.body) === '') errors.push(`\`## ${name}\` is empty`);
	}
	if (asks.length > 3) errors.push('at most three asks; split the packet or settle one');

	const whatChanged: string[] = [];
	for (const line of changed?.body ?? []) {
		if (!line.fenced && line.text.trim() === '') continue;
		const bullet = line.fenced ? null : BULLET.exec(line.text);
		if (bullet) whatChanged.push(bullet[1].trim());
		else if (!line.fenced && whatChanged.length > 0 && /^\s/.test(line.text)) whatChanged[whatChanged.length - 1] += ` ${line.text.trim()}`;
		else {
			errors.push('`## What changed` is a bulleted list and nothing else');
			break;
		}
	}
	if (changed && whatChanged.length === 0 && !errors.includes('`## What changed` is a bulleted list and nothing else')) {
		errors.push('`## What changed` is empty; list at least one bullet');
	}

	const steps: PlanStep[] = [];
	const planBody = named.get('If you approve')?.body ?? [];
	for (const line of planBody) {
		if (line.fenced || line.text.trim() === '') continue;
		const num = NUMBERED.exec(line.text);
		if (!num) {
			if (steps.length === 0) errors.push('`## If you approve` must be a numbered list');
			else steps[steps.length - 1].text += ` ${line.text.trim()}`;
			continue;
		}
		const n = steps.length + 1;
		const tag = STEP.exec(num[2]);
		if (!tag) {
			errors.push(`step ${n} needs a tag: [session], [irreversible], or [you: <label>]`);
			steps.push({ n, tag: 'session', text: num[2].trim() });
			continue;
		}
		if (tag[1] === 'you' && !tag[2]) errors.push(`step ${n} is \`[you]\` with no label; write \`[you: <what you do>]\``);
		if (tag[1] !== 'you' && tag[2]) errors.push(`step ${n}: only a \`you\` step takes a label`);
		steps.push({
			n,
			tag: tag[1] as StepTag,
			...(tag[2] && { label: tag[2].trim() }),
			text: num[2].slice(tag[0].length).trim()
		});
	}

	const parts: Packet['parts'] = [];
	const claimed = new Set<string>();
	const claim = (ref: string, where: string, in_: 'ask' | 'routine'): PartRef | undefined => {
		const part = parseRef(ref);
		if (!part) {
			errors.push(`${where}: \`${ref}\` is not a canonical ref; write \`<owner>/<repo>#<n>\`, \`<owner>/<repo>:<path>\`, or \`step:<n>\``);
			return undefined;
		}
		if (part.kind === 'step' && part.step! > steps.length) {
			errors.push(`${where}: \`${ref}\` is outside the plan, which has ${steps.length} steps`);
			return undefined;
		}
		if (part.kind === 'design' && !designExists(part.repo!, part.path!)) {
			errors.push(`${where}: the design \`${ref}\` does not exist`);
			return undefined;
		}
		if (claimed.has(ref)) {
			errors.push(`${where}: \`${ref}\` is listed twice; a part appears once, in one ask or one routine row`);
			return undefined;
		}
		claimed.add(ref);
		parts.push({ part, in: in_ });
		return part;
	};

	const parsedAsks: PacketAsk[] = [];
	asks.forEach((section, i) => {
		const question = section.heading.slice('Ask:'.length).trim();
		const at = `ask ${i + 1} (${question})`;
		const { fields, excerpt } = askFields(section.body);
		const text = (name: string) => fields.get(name)?.text ?? '';
		let ok = true;
		for (const name of ['Rule', 'Part', 'Summary', 'Background', 'Facts', 'Choices', 'Recommended', 'Reason']) {
			const f = fields.get(name);
			if (!f || (name !== 'Choices' && f.text === '')) {
				errors.push(`${at} is missing \`${name}:\``);
				ok = false;
			}
		}
		if (!ok) return;

		const rule = text('Rule');
		if (!RULES.includes(rule)) errors.push(`${at}: \`Rule: ${rule}\` is not one of the seven rules: ${RULES.join(', ')}`);

		const partText = text('Part');
		const part = partText === 'none' ? null : claim(partText, at, 'ask') ?? null;
		const bound = partText !== 'none';

		const facts: PacketFact[] = [];
		const factBullets = fields.get('Facts')!.bullets;
		if (factBullets.length === 0) errors.push(`${at}: every fact names its source; \`Facts:\` needs a bullet`);
		for (const bullet of factBullets) {
			const m = /^(.+?)\s+\(`([^`]+)`\)$/.exec(bullet);
			if (m) facts.push({ text: m[1], source: m[2] });
			else errors.push(`${at}: every fact names its source; \`${bullet}\` ends with no \`(\`source\`)\``);
		}

		const choices: PacketChoice[] = [];
		const labels = new Set<string>();
		let choiceDefect = false;
		const items = fields.get('Choices')!.bullets;
		if (items.length < 2) {
			errors.push(`${at} needs at least two choices`);
			choiceDefect = true;
		}
		for (const item of items) {
			const tag = /\s\[([^\]\s]+)\]$/.exec(item);
			const rest = tag ? item.slice(0, tag.index).trim() : item;
			const colon = rest.indexOf(': ');
			if (colon < 0 || rest.slice(colon + 2).trim() === '') {
				errors.push(`${at}: choice \`${item}\` has no \`: <consequence>\``);
				choiceDefect = true;
				continue;
			}
			const label = rest.slice(0, colon).trim();
			if (labels.has(label)) {
				errors.push(`${at}: two choices share the label \`${label}\``);
				choiceDefect = true;
			}
			labels.add(label);
			const verdict = tag?.[1];
			if (bound && part) {
				if (!verdict || !VERDICTS[part.kind].includes(verdict)) {
					errors.push(`${at}: each choice sets the part's verdict; \`${label}\` needs one of [${VERDICTS[part.kind].join('], [')}]`);
				}
			} else if (!bound && verdict) {
				errors.push(`${at}: each choice sets the part's verdict, and \`Part: none\` binds no part; \`${label}\` carries [${verdict}]`);
			}
			choices.push({ label, consequence: rest.slice(colon + 2).trim(), ...(verdict && { verdict }) });
		}

		const recommendedText = text('Recommended');
		const recommended = /^[1-9]\d*$/.test(recommendedText) ? Number(recommendedText) : 0;
		if (!choiceDefect && (recommended < 1 || recommended > choices.length)) {
			errors.push(`${at}: \`Recommended: ${recommendedText}\` is not the number of one of its ${choices.length} choices`);
		}

		const ev = fields.get('Evidence');
		parsedAsks.push({
			question,
			rule,
			part,
			recommended,
			reason: text('Reason'),
			summary: text('Summary'),
			background: text('Background'),
			factsLead: text('Facts'),
			facts,
			choices,
			...(ev && { evidence: { lead: ev.text, excerpt: excerpt.join('\n') } })
		});
	});

	const rows: RoutineRow[] = [];
	if (routine) {
		const table = routine.body.filter((l) => l.fenced || l.text.trim() !== '');
		const header = table[0] && !table[0].fenced ? cells(table[0].text).join(' | ') : '';
		const rule = table[1]?.text.trim() ?? '';
		const oneTable = table.every((l) => !l.fenced && l.text.trim().startsWith('|'));
		if (!oneTable || header !== 'Part | Verdict | Fact | Why' || !/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(rule)) {
			errors.push('`## Routine` must be one table with the header `| Part | Verdict | Fact | Why |`');
		} else {
			table.slice(2).forEach((line, i) => {
				const row = cells(line.text);
				const at = `routine row ${i + 1}`;
				if (row.length !== 4) {
					errors.push(`${at} (${row[0]}) has ${row.length} cells; it needs 4`);
					return;
				}
				const part = claim(row[0], at, 'routine');
				if (!part) return;
				if (!VERDICTS[part.kind].includes(row[1])) {
					errors.push(`${at} (${row[0]}): a ${part.kind} takes ${VERDICTS[part.kind].join(', ')}, not \`${row[1]}\``);
					return;
				}
				rows.push({ part, verdict: row[1], fact: row[2], why: row[3] });
			});
		}
	}

	if (errors.length === 0 && !parts.some((p) => p.part.kind !== 'step')) {
		errors.push('a packet holds at least one PR or design');
	}

	if (errors.length > 0) return refuse(...errors);
	return {
		ok: true,
		packet: {
			headline,
			background: paragraphs[0],
			summary: paragraphs.slice(1),
			steps,
			...(changed && { whatChanged }),
			notChecked: prose(named.get('Not checked')!.body),
			asks: parsedAsks,
			routine: rows,
			parts
		}
	};
}
