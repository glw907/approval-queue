/**
 * Records Geoff's decisions from the document page: an answer picked before a decision, the
 * decision itself, an Undo, and his note operations. Each write goes to the store before the answer, and the answer is
 * the state the records fold to after the write, so a 2xx means the record is on disk.
 *
 * @remarks Only the command writes `handed` and `withdraw`. The server refuses both, runs no
 * timer, and reads nothing from GitHub: a merge approve copies the heads `send` stored.
 */
import { createHash } from 'node:crypto';
import { fold, type State } from '../../../cli/state.ts';
import { parse } from '#lib/doc/parse.ts';
import type { Doc, Question } from '#lib/doc/types.ts';
import {
	readDecisions,
	readDocument,
	readNamed,
	StoreError,
	writeDecision,
	writeNamed,
	type Decision
} from '#lib/store/store.ts';
import { DOC, NOTES } from '#lib/strings.ts';
import { NOTE_LIMIT, noteLength, readThreads, writeNote } from '#lib/components/notes.server.ts';
import type { DecideAnswer, DecisionView, DocStanding, RecordedAnswer } from '#lib/components/types.ts';

/** The ids of the specimen pages, which load as documents but take no decision. */
export const SPECIMEN_IDS = new Set(['markdown', 'long']);

/** What the route hands over from the request. */
export interface PostRequest {
	/** The request's `Origin` header. */
	origin: string | null;
	/** The server's own origin. */
	self: string;
	contentType: string | null;
	/** The request body as text. */
	body: string;
}

export interface Reply {
	status: number;
	body: DecideAnswer;
}

type Picks = Record<string, number>;

type NoteBody =
	| { op: 'note'; quote: string; start?: number; version: number; text: string }
	| { op: 'reply'; thread: number; text: string }
	| { op: 'resolve'; thread: number; resolved: boolean }
	| { op: 'delete'; thread: number };

type Body =
	| { op: 'answer'; question: string; pick: number }
	| { op: 'decide'; action: 'approve' | 'sendback' | 'read'; answers: Picks }
	| { op: 'undo' }
	| NoteBody;

/** Thrown inside a handler to answer with `status` and the page's sentence. */
class Refusal {
	constructor(
		readonly status: number,
		readonly message: string,
		readonly standing: DocStanding | null = null
	) {}
}

const DECISIONS = new Set(['approve', 'sendback', 'read']);

/** A folded state with the number of records it was folded from. */
type Folded = State & { seq: number };

/** Reads document `id`'s records and folds them. */
function read(root: string, id: string): Folded {
	const records = readDecisions(root, id);
	return { ...fold(records), seq: records.length };
}

function toStanding(state: Folded): DocStanding {
	if (state.state === 'waiting' || state.state === 'withdrawn') return { state: state.state, n: null, seq: state.seq, decision: null };
	return { state: state.state, n: state.n, seq: state.seq, decision: view(state.decision) };
}

/** The part of a decision record the page draws. */
function view(record: Decision): DecisionView {
	const out: DecisionView = { action: record.action as DecisionView['action'], at: record.at };
	if (record.answers && typeof record.answers === 'object') out.answers = record.answers as Record<string, RecordedAnswer>;
	return out;
}

/** Where document `id` stands, folded from its records. */
export function standingOf(root: string, id: string): DocStanding {
	return toStanding(read(root, id));
}

/** The picks stored before a decision, `{}` when none are. */
export function answersOf(root: string, id: string): Picks {
	const stored = readNamed(root, id, 'answers.json');
	if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
	return Object.fromEntries(Object.entries(stored).filter(([, v]) => Number.isInteger(v))) as Picks;
}

const isPicks = (v: unknown): v is Picks =>
	!!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((p) => Number.isInteger(p));

/** The body as one of the three shapes, or null. */
function shape(text: string): Body | null {
	let v: unknown;
	try {
		v = JSON.parse(text);
	} catch {
		return null;
	}
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	const b = v as Record<string, unknown>;
	if (b.op === 'undo') return { op: 'undo' };
	if (b.op === 'answer' && typeof b.question === 'string' && Number.isInteger(b.pick)) {
		return { op: 'answer', question: b.question, pick: b.pick as number };
	}
	if (b.op === 'decide' && typeof b.action === 'string' && isPicks(b.answers)) {
		if (!DECISIONS.has(b.action)) throw new Refusal(400, DOC.badAction);
		return { op: 'decide', action: b.action as 'approve' | 'sendback' | 'read', answers: b.answers };
	}
	return noteShape(b);
}

const isCount = (v: unknown, least: number): v is number => Number.isInteger(v) && (v as number) >= least;

/** A note operation's body, or null when it lacks a field its operation needs. */
function noteShape(b: Record<string, unknown>): NoteBody | null {
	const text = typeof b.text === 'string' ? b.text.trim() : null;
	if (b.op === 'note' && text && typeof b.quote === 'string' && b.quote.trim() && isCount(b.version, 1)) {
		if (b.start !== undefined && !isCount(b.start, 0)) return null;
		const start = b.start as number | undefined;
		return { op: 'note', quote: b.quote.trim(), version: b.version, text, ...(start === undefined ? {} : { start }) };
	}
	if (!isCount(b.thread, 1)) return null;
	if (b.op === 'reply' && text) return { op: 'reply', thread: b.thread, text };
	if (b.op === 'resolve' && typeof b.resolved === 'boolean') return { op: 'resolve', thread: b.thread, resolved: b.resolved };
	if (b.op === 'delete') return { op: 'delete', thread: b.thread };
	return null;
}

/** The media type of a `content-type` header: the part before any `;`, trimmed and lowercased. */
const mediaType = (header: string | null) => (header ?? '').split(';')[0].trim().toLowerCase();

function questionsOf(doc: Doc): Question[] {
	return doc.segments.filter((s): s is Question => s.type === 'question');
}

/** Refuses a pick for a question `doc` doesn't ask, or an option it doesn't have. */
function checkPick(questions: Question[], qid: string, pick: number): Question {
	const q = questions.find((q) => q.id === qid);
	if (!q || pick < 0 || pick >= q.options.length) throw new Refusal(400, DOC.badAnswer);
	return q;
}

/** Answers with the standing of a document a refusal didn't stop. */
const ok = (state: Folded): Reply => ({ status: 200, body: { standing: toStanding(state) } });

function answer(root: string, id: string, doc: Doc, body: Extract<Body, { op: 'answer' }>): Reply {
	checkPick(questionsOf(doc), body.question, body.pick);
	const state = read(root, id);
	if (state.state === 'withdrawn') throw new Refusal(409, DOC.withdrawn, toStanding(state));
	if (state.state !== 'waiting') throw new Refusal(409, DOC.alreadyDecided, toStanding(state));
	writeNamed(root, id, 'answers.json', { ...answersOf(root, id), [body.question]: body.pick });
	return ok(read(root, id));
}

function decide(root: string, id: string, doc: Doc, source: string, body: Extract<Body, { op: 'decide' }>): Reply {
	const report = doc.kind === 'report';
	if (report !== (body.action === 'read')) throw new Refusal(400, DOC.badAction);
	const questions = questionsOf(doc);
	const answers: Record<string, RecordedAnswer> = {};
	for (const [qid, pick] of Object.entries(body.answers)) {
		const q = checkPick(questions, qid, pick);
		answers[qid] = { pick, label: q.options[pick].label };
	}

	const before = read(root, id);
	if (before.state === 'withdrawn') throw new Refusal(409, DOC.withdrawn, toStanding(before));
	if (before.state !== 'waiting') {
		if (before.decision.action === body.action) return ok(before);
		const why = before.state === 'handed' ? DOC.handoffAfter : DOC.alreadyDecided;
		throw new Refusal(409, why, toStanding(before));
	}

	if (body.action === 'sendback' && !notesWaiting(root, id) && !questions.some((q) => moved(q, body.answers[q.id]))) {
		throw new Refusal(400, DOC.nothingToSendBack, toStanding(before));
	}
	if (body.action === 'approve') {
		const missing = questions.filter((q) => !(q.id in answers));
		if (missing.length) throw new Refusal(400, DOC.unanswered(missing.map((q) => q.label)));
	}
	const record: Decision = { action: body.action, at: new Date().toISOString() };
	if (questions.length) record.answers = answers;
	if (body.action === 'approve' && doc.kind === 'merge') {
		const heads = readNamed(root, id, 'heads.json');
		if (!Array.isArray(heads) || !heads.length) throw new Refusal(409, DOC.headsMissing, toStanding(before));
		record.heads = heads;
	}
	if (body.action === 'approve' && doc.kind === 'design') {
		record.hash = createHash('sha256').update(source).digest('hex');
	}
	writeDecision(root, id, record);

	const after = read(root, id);
	if (after.state === 'withdrawn') throw new Refusal(409, DOC.withdrawn, toStanding(after));
	if (after.state === 'waiting' || after.decision.action !== body.action) {
		throw new Refusal(409, DOC.alreadyDecided, toStanding(after));
	}
	return ok(after);
}

/**
 * The open threads whose last entry is Geoff's, the count the page shows as notes waiting. A
 * send-back with none, and no answer moved, gives the session nothing to act on.
 */
export function notesWaiting(root: string, id: string): number {
	return readThreads(root, id).threads.filter((t) => !t.resolved && t.entries.at(-1)?.who === 'geoff').length;
}

/**
 * True when `pick` differs from the question's recommended option. A missing pick counts as the
 * recommended one; on a question with none, any pick is a change and a missing one isn't.
 */
function moved(q: Question, pick: number | undefined): boolean {
	const recommended = q.options.findIndex((o) => o.recommended);
	return pick !== undefined && pick !== recommended;
}

/**
 * Writes one note operation of Geoff's and answers the folded threads.
 *
 * @remarks Notes are taken while the document is waiting or decided, since a decided send-back is
 * what the notes explain, and refused once it is handed or withdrawn.
 */
function noteOp(root: string, id: string, versions: number, body: NoteBody): Reply {
	const state = read(root, id);
	if (state.state === 'handed' || state.state === 'withdrawn') throw new Refusal(409, NOTES.closed, toStanding(state));
	if ('text' in body && noteLength(body.text) > NOTE_LIMIT) throw new Refusal(400, NOTES.tooLong(noteLength(body.text)));
	const at = new Date().toISOString();
	if (body.op === 'note') {
		if (body.version > versions) throw new Refusal(400, DOC.badRequest);
		writeNote(root, id, { op: 'open', who: 'geoff', quote: body.quote, start: body.start, version: body.version, text: body.text, at });
	} else {
		const thread = readThreads(root, id).threads.find((t) => t.id === body.thread);
		if (!thread) throw new Refusal(400, DOC.badRequest);
		if (body.op === 'reply') writeNote(root, id, { op: 'reply', thread: body.thread, who: 'geoff', text: body.text, at });
		else if (body.op === 'resolve') writeNote(root, id, { op: 'resolve', thread: body.thread, resolved: body.resolved, who: 'geoff', at });
		else {
			if (thread.entries.some((e) => e.who !== 'geoff')) throw new Refusal(400, DOC.badRequest);
			writeNote(root, id, { op: 'delete', thread: body.thread, at });
		}
	}
	return { status: 200, body: { standing: toStanding(read(root, id)), threads: readThreads(root, id).threads } };
}

function undo(root: string, id: string): Reply {
	const records = readDecisions(root, id);
	const before: Folded = { ...fold(records), seq: records.length };
	if (before.state === 'withdrawn') throw new Refusal(409, DOC.withdrawn, toStanding(before));
	if (before.state === 'handed') throw new Refusal(409, DOC.undoLate, toStanding(before));
	if (before.state === 'waiting') {
		if (records.at(-1)?.action === 'undo') return ok(before);
		throw new Refusal(409, DOC.nothingToUndo, toStanding(before));
	}
	writeDecision(root, id, { action: 'undo', at: new Date().toISOString(), of: before.n });
	const after = read(root, id);
	if (after.state === 'handed') throw new Refusal(409, DOC.undoLate, toStanding(after));
	if (after.state === 'withdrawn') throw new Refusal(409, DOC.withdrawn, toStanding(after));
	return ok(after);
}

/**
 * Takes one post from the document page for document `id` and returns the status and body to
 * answer with. Every refusal carries the sentence the page shows as its reason.
 */
export function post(root: string, id: string, req: PostRequest): Reply {
	if (req.origin !== req.self) return { status: 403, body: { standing: null, message: DOC.badOrigin } };
	if (mediaType(req.contentType) !== 'application/json') {
		return { status: 415, body: { standing: null, message: DOC.badRequest } };
	}
	if (SPECIMEN_IDS.has(id)) return { status: 404, body: { standing: null, message: DOC.specimen } };
	try {
		const { meta, source } = readDocument(root, id);
		const body = shape(req.body);
		if (!body) throw new Refusal(400, DOC.badRequest);
		const { doc } = parse(source);
		if (body.op === 'answer') return answer(root, id, doc, body);
		if (body.op === 'decide') return decide(root, id, doc, source, body);
		if (body.op === 'undo') return undo(root, id);
		return noteOp(root, id, meta.versions, body);
	} catch (e) {
		return refused(e);
	}
}

/** Answers `GET /api/<id>` with where the document stands, for the page's poll. */
export function get(root: string, id: string): Reply {
	if (SPECIMEN_IDS.has(id)) return { status: 404, body: { standing: null, message: DOC.specimen } };
	try {
		readDocument(root, id);
		return { status: 200, body: { standing: standingOf(root, id) } };
	} catch (e) {
		return refused(e);
	}
}

function refused(e: unknown): Reply {
	if (e instanceof Refusal) return { status: e.status, body: { standing: e.standing, message: e.message } };
	if (e instanceof StoreError && (e.code === 'bad-id' || e.code === 'missing')) {
		return { status: 404, body: { standing: null, message: DOC.missing } };
	}
	const detail = e instanceof Error ? e.message : String(e);
	return { status: 500, body: { standing: null, message: DOC.notSaved(detail) } };
}
