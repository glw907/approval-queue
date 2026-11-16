import { parse } from '#lib/doc/parse.ts';
import type { Question } from '#lib/doc/types.ts';
import { Refusal, record } from '#lib/components/decide.server.ts';
import { NOTE_LIMIT, documentText, noteLength, normalize, writeNote } from '#lib/components/notes.server.ts';
import { createDocument, readDecisions, readDocument, storeRoot } from '#lib/store/store.ts';
import { DOC, NOTES } from '#lib/strings.ts';
import { check } from './check.ts';
import { fold } from './state.ts';
import { USAGE, storeFailure } from './wait.ts';
import { findWords } from './words.ts';

/** The flags `answer` reads, after the command's positional words. */
interface Args {
	/** A document id, or null with `--new`. */
	id: string | null;
	/** The file `--new` stores. */
	file: string | null;
	action: 'approve' | 'sendback';
	words: string;
	picks: { label: string; n: string }[];
	note: string | null;
	passage: string | null;
}

/** Prints a refusal on stderr, adding the command's prefix unless the sentence has it. */
const refuse = (sentence: string): number => {
	process.stderr.write(sentence.startsWith('approval-queue: ') ? `${sentence}\n` : `approval-queue: ${sentence}\n`);
	return 1;
};

/** Reads the arguments after `answer`, or null when they don't fit one of the three forms. */
function parseArgs(argv: string[]): Args | null {
	const [first, ...rest] = argv;
	const isNew = first === '--new';
	const target = isNew ? rest.shift() : first;
	const action = rest.shift();
	if (!target || (action !== 'approve' && action !== 'sendback') || (isNew && action !== 'approve')) return null;
	const args: Args = {
		id: isNew ? null : target,
		file: isNew ? target : null,
		action,
		words: '',
		picks: [],
		note: null,
		passage: null
	};
	let words: string | null = null;
	while (rest.length) {
		const flag = rest.shift();
		const value = rest.shift();
		if (value === undefined) return null;
		if (flag === '--words' && words === null) words = value;
		else if (flag === '--pick' && action === 'approve') {
			const at = value.lastIndexOf('=');
			if (at < 1) return null;
			args.picks.push({ label: value.slice(0, at), n: value.slice(at + 1) });
		} else if (flag === '--note' && action === 'sendback' && args.note === null) args.note = value;
		else if (flag === '--passage' && action === 'sendback' && args.passage === null) args.passage = value;
		else return null;
	}
	if (words === null || (action === 'sendback' && args.note === null)) return null;
	args.words = words;
	return args;
}

/**
 * When document `id`'s latest version reached the queue: the latest of its creation, its newest
 * `returned` record, and its newest `undo` record. A message Geoff entered before then can't
 * stand for a decision on what he reads now.
 */
function arrivedAt(root: string, id: string): number {
	let latest = Date.parse(readDocument(root, id).meta.created);
	for (const d of readDecisions(root, id)) {
		if (d.action === 'returned' || d.action === 'undo') latest = Math.max(latest, Date.parse(d.at));
	}
	return latest;
}

/** The question ids for `--pick`s, or the sentence that refuses one. */
function resolvePicks(questions: Question[], picks: Args['picks']): Record<string, number> | string {
	const out: Record<string, number> = {};
	for (const { label, n } of picks) {
		const q = questions.find((q) => q.label === label);
		if (!q || !/^\d+$/.test(n) || Number(n) < 1 || Number(n) > q.options.length) return DOC.badAnswer;
		out[q.id] = Number(n) - 1;
	}
	return out;
}

/** Records the decision and prints the one-line answer, or the page's sentence for a refusal. */
function recordDecision(root: string, id: string, args: Args, picks: Record<string, number>, extra: Record<string, unknown>): number {
	try {
		const { wrote } = record(root, id, args.action, picks, extra);
		if (!wrote) return refuse(DOC.alreadyDecided);
	} catch (err) {
		if (err instanceof Refusal) return refuse(err.message);
		return storeFailure(err);
	}
	process.stdout.write(`recorded ${args.action} on ${id}\n`);
	return 0;
}

/**
 * Records Geoff's decision from his words in the desk session: `answer <id> approve|sendback
 * --words <text>`, or `answer --new <doc.md> approve --words <text>` for a `decide` document
 * stored and answered in one step. Returns the exit code: 0 recorded, 1 refused, 2 usage.
 *
 * @remarks Refuses unless the session is named `desk` and `--words` sits in a message Geoff
 * entered there. For an existing document the message must follow the latest version's arrival.
 * A `--new` document has no earlier version, so that check is skipped. The decision stores the
 * whole message and the session id beside the page's own fields.
 */
export function answer(argv: string[]): number {
	const args = parseArgs(argv);
	if (!args) {
		process.stderr.write(`${USAGE}\n`);
		return 2;
	}
	return args.file === null ? answerExisting(args) : answerNew(args, args.file);
}

function answerExisting(args: Args): number {
	const id = args.id as string;
	try {
		const root = storeRoot();
		const { meta, source } = readDocument(root, id);
		const { doc } = parse(source);
		const arrived = arrivedAt(root, id);
		if (!Number.isFinite(arrived)) return refuse(`${id} has no readable arrival time.`);
		const found = findWords(args.words, arrived);
		if (!found.ok) return refuse(found.reason);
		const picks = resolvePicks(doc.segments.filter((s): s is Question => s.type === 'question'), args.picks);
		if (typeof picks === 'string') return refuse(picks);
		const extra = { via: 'chat', message: found.message, session: found.session };
		if (args.action === 'sendback') {
			if (meta.kind === 'report') return refuse(DOC.badAction);
			const refused = writeChatNote(root, id, args, found.outside, meta.versions, source, doc.title);
			if (refused) return refuse(refused);
		}
		return recordDecision(root, id, args, picks, extra);
	} catch (err) {
		return storeFailure(err);
	}
}

/**
 * Stores a send-back's note as Geoff's, from chat. Returns the sentence that refuses it, or null
 * once the note is written. The note must sit in the message outside any paste.
 */
function writeChatNote(root: string, id: string, args: Args, outside: string, versions: number, source: string, title: string): string | null {
	const text = (args.note ?? '').trim();
	if (!text || !outside.includes(text)) return 'the note is not in the message that holds the words.';
	const state = fold(readDecisions(root, id));
	if (state.state === 'withdrawn') return DOC.withdrawn;
	if (state.state === 'handed') return DOC.handoffAfter;
	if (state.state !== 'waiting') return DOC.alreadyDecided;
	if (noteLength(text) > NOTE_LIMIT) return NOTES.tooLong(noteLength(text));
	const passage = args.passage?.trim();
	if (passage && !normalize(documentText(source)).includes(normalize(passage))) return 'the passage is not in the document.';
	writeNote(root, id, { op: 'open', who: 'geoff', via: 'chat', quote: passage || title, version: versions, text, at: new Date().toISOString() });
	return null;
}

function answerNew(args: Args, file: string): number {
	const checked = check(file, () => ({ ok: false, error: 'no pull request is read for an answer' }));
	if (checked.code !== 0 || !checked.doc || checked.source === null) {
		const [first = 'the document did not pass its check.'] = checked.lines;
		const more = checked.lines.length > 1 ? ` (${checked.lines.length} lines in all)` : '';
		return refuse(`${file} fails check: ${first}${more}`);
	}
	if (checked.doc.kind !== 'decide') return refuse('--new stores a decide document only.');
	const questions = checked.doc.segments.filter((s): s is Question => s.type === 'question');
	const picks = resolvePicks(questions, args.picks);
	if (typeof picks === 'string') return refuse(picks);
	const missing = questions.filter((q) => !(q.id in picks));
	if (missing.length) return refuse(DOC.unanswered(missing.map((q) => q.label)));
	const found = findWords(args.words, null);
	if (!found.ok) return refuse(found.reason);
	try {
		const root = storeRoot();
		const id = createDocument(root, checked.source, { kind: 'decide', title: checked.doc.title }).id;
		return recordDecision(root, id, args, picks, { via: 'chat', message: found.message, session: found.session });
	} catch (err) {
		return storeFailure(err);
	}
}
