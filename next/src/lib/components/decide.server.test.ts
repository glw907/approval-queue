import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '#lib/doc/parse.ts';
import type { Question } from '#lib/doc/types.ts';
import { createDocument, readDecisions, readNamed, writeDecision, writeNamed } from '#lib/store/store.ts';
import { DOC } from '#lib/strings.ts';
import { answersOf, post, standingOf } from './decide.server.ts';

// The race case: a `handed` record lands just before the Undo's own write.
const race = vi.hoisted(() => ({ handBefore: null as null | { root: string; id: string; n: number } }));

vi.mock('#lib/store/store.ts', async (original) => {
	const store = await original<typeof import('#lib/store/store.ts')>();
	return {
		...store,
		writeDecision(root: string, id: string, record: { action: string; at: string }) {
			const hand = race.handBefore;
			if (hand && record.action === 'undo') {
				race.handBefore = null;
				store.writeDecision(hand.root, hand.id, { action: 'handed', at: new Date().toISOString(), decision: hand.n });
			}
			return store.writeDecision(root, id, record);
		}
	};
});

const CONTENT = fileURLToPath(new URL('../../../../docs/mockup/content/', import.meta.url));
const SELF = 'http://127.0.0.1:7955';
const HEADS = [
	{ repo: 'glw907/workstation', number: 233, head: 'aaa233' },
	{ repo: 'glw907/workstation', number: 234, head: 'bbb234' }
];

let root: string;

function store(name: string): { id: string; source: string; questions: Question[] } {
	const source = readFileSync(join(CONTENT, name), 'utf8');
	const { doc } = parse(source);
	const id = createDocument(root, source, { kind: doc.kind as string, title: doc.title }).id;
	const questions = doc.segments.filter((s): s is Question => s.type === 'question');
	return { id, source, questions };
}

/** A merge document with two questions and its heads stored, as `send` leaves it. */
function mergeDoc() {
	const d = store('20-survey-edit.md');
	writeNamed(root, d.id, 'heads.json', HEADS);
	return d;
}

const recommended = (qs: Question[]) =>
	Object.fromEntries(qs.map((q) => [q.id, q.options.findIndex((o) => o.recommended)]));

function send(id: string, body: unknown, over: { origin?: string | null; type?: string | null; raw?: string } = {}) {
	return post(root, id, {
		origin: over.origin === undefined ? SELF : over.origin,
		self: SELF,
		contentType: over.type === undefined ? 'application/json' : over.type,
		body: over.raw ?? JSON.stringify(body)
	});
}

const records = (id: string) => readDecisions(root, id);

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'aq-decide-'));
	race.handBefore = null;
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the request checks', () => {
	it('refuses another origin with 403 and writes nothing', () => {
		const { id, questions } = mergeDoc();
		const res = send(id, { op: 'decide', action: 'approve', answers: recommended(questions) }, { origin: 'http://evil.test' });
		expect(res.status).toBe(403);
		expect(res.body.message).toBe(DOC.badOrigin);
		expect(records(id)).toEqual([]);
	});

	it('refuses a missing origin with 403', () => {
		const { id } = store('30-round-report.md');
		expect(send(id, { op: 'decide', action: 'read', answers: {} }, { origin: null }).status).toBe(403);
	});

	it('refuses a body that is not JSON by its media type with 415', () => {
		const { id } = store('30-round-report.md');
		expect(send(id, { op: 'decide', action: 'read', answers: {} }, { type: 'text/plain' }).status).toBe(415);
		expect(send(id, { op: 'decide', action: 'read', answers: {} }, { type: null }).status).toBe(415);
		expect(records(id)).toEqual([]);
	});

	it('takes application/json with parameters, in any case', () => {
		const { id } = store('30-round-report.md');
		expect(send(id, { op: 'decide', action: 'read', answers: {} }, { type: 'Application/JSON; charset=utf-8' }).status).toBe(200);
	});

	it('answers 404 for an unknown id and for a malformed one', () => {
		expect(send('20991231-000000-abcdef', { op: 'undo' }).status).toBe(404);
		const bad = send('../etc', { op: 'undo' });
		expect(bad.status).toBe(404);
		expect(bad.body.message).toBe(DOC.missing);
	});

	it.each(['markdown', 'long'])('answers 404 with the specimen sentence on /d/%s', (id) => {
		const res = send(id, { op: 'undo' });
		expect(res.status).toBe(404);
		expect(res.body.message).toBe(DOC.specimen);
	});

	it.each([
		['not JSON', undefined, '{op:'],
		['an array', [], undefined],
		['an unknown op', { op: 'approve' }, undefined],
		['a decide with no action', { op: 'decide', answers: {} }, undefined],
		['a decide with answers that are not an object', { op: 'decide', action: 'read', answers: [1] }, undefined],
		['an answer with a string pick', { op: 'answer', question: 'q1', pick: '1' }, undefined]
	])('refuses %s with 400', (_name, body, raw) => {
		const { id } = store('30-round-report.md');
		const res = send(id, body, { raw });
		expect(res.status).toBe(400);
		expect(res.body.message).toBe(DOC.badRequest);
	});

	it.each(['handed', 'withdraw', 'undo'])('refuses a decide with action %s with 400', (action) => {
		const { id } = mergeDoc();
		expect(send(id, { op: 'decide', action, answers: {} }).status).toBe(400);
		expect(records(id)).toEqual([]);
	});

	it('refuses read on a document that is not a report, and approve or sendback on a report', () => {
		const merge = mergeDoc();
		const report = store('30-round-report.md');
		const read = send(merge.id, { op: 'decide', action: 'read', answers: recommended(merge.questions) });
		expect(read.status).toBe(400);
		expect(read.body.message).toBe(DOC.badAction);
		expect(send(report.id, { op: 'decide', action: 'approve', answers: {} }).status).toBe(400);
		expect(send(report.id, { op: 'decide', action: 'sendback', answers: {} }).status).toBe(400);
		expect(records(merge.id)).toEqual([]);
		expect(records(report.id)).toEqual([]);
	});

	it('refuses an unknown question or an out-of-range pick with 400', () => {
		const { id, questions } = mergeDoc();
		const extra = send(id, { op: 'decide', action: 'approve', answers: { ...recommended(questions), q9: 0 } });
		expect(extra.status).toBe(400);
		expect(extra.body.message).toBe(DOC.badAnswer);
		const far = send(id, { op: 'decide', action: 'approve', answers: { ...recommended(questions), q1: 99 } });
		expect(far.status).toBe(400);
		expect(send(id, { op: 'answer', question: 'q9', pick: 0 }).status).toBe(400);
		expect(send(id, { op: 'answer', question: 'q1', pick: -1 }).status).toBe(400);
		expect(records(id)).toEqual([]);
	});

	it('refuses an approve that leaves a question unanswered, naming it', () => {
		const { id, questions } = mergeDoc();
		const res = send(id, { op: 'decide', action: 'approve', answers: { q1: 0 } });
		expect(res.status).toBe(400);
		expect(res.body.message).toBe(DOC.unanswered([questions[1].label]));
		expect(records(id)).toEqual([]);
	});

	it('takes a send-back with questions unanswered', () => {
		const { id } = mergeDoc();
		expect(send(id, { op: 'decide', action: 'sendback', answers: {} }).status).toBe(200);
	});

	it('refuses an approve of a merge document with no heads.json with 409', () => {
		const { id, questions } = store('20-survey-edit.md');
		const res = send(id, { op: 'decide', action: 'approve', answers: recommended(questions) });
		expect(res.status).toBe(409);
		expect(res.body.message).toBe(DOC.headsMissing);
		expect(records(id)).toEqual([]);
	});

	it('answers 500 with the store error when a decision file is unreadable', async () => {
		const { id } = store('30-round-report.md');
		const { writeFileSync } = await import('node:fs');
		writeFileSync(join(root, id, 'decision-1.json'), '{');
		const res = send(id, { op: 'decide', action: 'read', answers: {} });
		expect(res.status).toBe(500);
		expect(res.body.message).toMatch(/^The queue couldn't save it: /);
	});
});

describe('the records', () => {
	it('records an approve with its answers and heads, and answers decided', () => {
		const { id, questions } = mergeDoc();
		const picks = { q1: 1, q2: 0 };
		const res = send(id, { op: 'decide', action: 'approve', answers: picks });
		expect(res.status).toBe(200);
		expect(res.body.standing).toMatchObject({ state: 'decided', n: 1, decision: { action: 'approve' } });
		const [record] = records(id);
		expect(record.action).toBe('approve');
		expect(Date.parse(record.at)).not.toBeNaN();
		expect(record.answers).toEqual({
			q1: { pick: 1, label: questions[0].options[1].label },
			q2: { pick: 0, label: questions[1].options[0].label }
		});
		expect(record.heads).toEqual(HEADS);
		expect(record.hash).toBeUndefined();
	});

	it("records the body's answers when they differ from answers.json", () => {
		const { id } = mergeDoc();
		expect(send(id, { op: 'answer', question: 'q1', pick: 0 }).status).toBe(200);
		expect(readNamed(root, id, 'answers.json')).toEqual({ q1: 0 });
		send(id, { op: 'decide', action: 'approve', answers: { q1: 1, q2: 1 } });
		expect((records(id)[0].answers as Record<string, { pick: number }>).q1.pick).toBe(1);
	});

	it('records a design approve with the hash of its stored source', () => {
		const { id, source, questions } = store('40-queue-design.md');
		send(id, { op: 'decide', action: 'approve', answers: recommended(questions) });
		expect(records(id)[0].hash).toBe(createHash('sha256').update(source).digest('hex'));
		expect(records(id)[0].heads).toBeUndefined();
	});

	it('records a report read with no answers', () => {
		const { id } = store('30-round-report.md');
		const res = send(id, { op: 'decide', action: 'read', answers: {} });
		expect(res.body.standing?.state).toBe('decided');
		expect(records(id)).toEqual([{ action: 'read', at: expect.any(String) }]);
	});

	it('keeps answers picked before a decision, merged one at a time', () => {
		const { id } = store('50-backlog.md');
		send(id, { op: 'answer', question: 'q1', pick: 1 });
		send(id, { op: 'answer', question: 'q3', pick: 0 });
		send(id, { op: 'answer', question: 'q1', pick: 0 });
		expect(answersOf(root, id)).toEqual({ q1: 0, q3: 0 });
		expect(records(id)).toEqual([]);
	});

	it('refuses an answer once the document is decided', () => {
		const { id } = mergeDoc();
		send(id, { op: 'decide', action: 'sendback', answers: {} });
		const res = send(id, { op: 'answer', question: 'q1', pick: 0 });
		expect(res.status).toBe(409);
		expect(res.body.standing?.state).toBe('decided');
		expect(readNamed(root, id, 'answers.json')).toBeUndefined();
	});

	it('writes an Undo naming the decision it undoes, and the document waits again', () => {
		const { id } = store('30-round-report.md');
		send(id, { op: 'decide', action: 'read', answers: {} });
		const res = send(id, { op: 'undo' });
		expect(res.status).toBe(200);
		expect(res.body.standing).toEqual({ state: 'waiting', n: null, decision: null });
		expect(records(id)[1]).toEqual({ action: 'undo', at: expect.any(String), of: 1 });
		send(id, { op: 'decide', action: 'read', answers: {} });
		send(id, { op: 'undo' });
		expect(records(id)[3]).toMatchObject({ action: 'undo', of: 3 });
	});

	it('refuses an Undo with nothing to undo', () => {
		const { id } = store('30-round-report.md');
		const res = send(id, { op: 'undo' });
		expect(res.status).toBe(409);
		expect(res.body.message).toBe(DOC.nothingToUndo);
		expect(records(id)).toEqual([]);
	});
});

describe('repeats and late arrivals', () => {
	it('answers a repeated decide with 200 and writes it once', () => {
		const { id } = store('30-round-report.md');
		send(id, { op: 'decide', action: 'read', answers: {} });
		const again = send(id, { op: 'decide', action: 'read', answers: {} });
		expect(again.status).toBe(200);
		expect(again.body.standing?.state).toBe('decided');
		expect(records(id)).toHaveLength(1);
	});

	it('refuses a different decision while decided', () => {
		const { id, questions } = mergeDoc();
		send(id, { op: 'decide', action: 'sendback', answers: {} });
		const res = send(id, { op: 'decide', action: 'approve', answers: recommended(questions) });
		expect(res.status).toBe(409);
		expect(res.body.message).toBe(DOC.alreadyDecided);
		expect(records(id)).toHaveLength(1);
	});

	it('answers a repeated Undo with 200 and writes it once', () => {
		const { id } = store('30-round-report.md');
		send(id, { op: 'decide', action: 'read', answers: {} });
		send(id, { op: 'undo' });
		const again = send(id, { op: 'undo' });
		expect(again.status).toBe(200);
		expect(again.body.standing?.state).toBe('waiting');
		expect(records(id)).toHaveLength(2);
	});

	it('answers a same-action decide once handed with 200 and the handed state', () => {
		const { id, questions } = mergeDoc();
		send(id, { op: 'decide', action: 'approve', answers: recommended(questions) });
		writeDecision(root, id, { action: 'handed', at: new Date().toISOString(), decision: 1 });
		const res = send(id, { op: 'decide', action: 'approve', answers: recommended(questions) });
		expect(res.status).toBe(200);
		expect(res.body.standing).toMatchObject({ state: 'handed', n: 1 });
		expect(records(id)).toHaveLength(2);
	});

	it('refuses a different decide once handed with 409', () => {
		const { id, questions } = mergeDoc();
		send(id, { op: 'decide', action: 'approve', answers: recommended(questions) });
		writeDecision(root, id, { action: 'handed', at: new Date().toISOString(), decision: 1 });
		const res = send(id, { op: 'decide', action: 'sendback', answers: {} });
		expect(res.status).toBe(409);
		expect(res.body.message).toBe(DOC.handoffAfter);
		expect(records(id)).toHaveLength(2);
	});

	it('refuses a decide and an Undo once withdrawn', () => {
		const { id, questions } = mergeDoc();
		writeDecision(root, id, { action: 'withdraw', at: new Date().toISOString() });
		const decide = send(id, { op: 'decide', action: 'approve', answers: recommended(questions) });
		expect(decide.status).toBe(409);
		expect(decide.body.message).toBe(DOC.withdrawn);
		expect(send(id, { op: 'undo' }).body.message).toBe(DOC.withdrawn);
		expect(send(id, { op: 'answer', question: 'q1', pick: 0 }).status).toBe(409);
		expect(records(id)).toHaveLength(1);
	});

	it('refuses an Undo that arrives once handed, writing nothing', () => {
		const { id, questions } = mergeDoc();
		send(id, { op: 'decide', action: 'approve', answers: recommended(questions) });
		writeDecision(root, id, { action: 'handed', at: new Date().toISOString(), decision: 1 });
		const res = send(id, { op: 'undo' });
		expect(res.status).toBe(409);
		expect(res.body.message).toBe(DOC.undoLate);
		expect(res.body.standing).toMatchObject({ state: 'handed' });
		expect(records(id)).toHaveLength(2);
	});

	it('refuses an Undo that loses the race to the hand-off, and the decision stands', () => {
		const { id, questions } = mergeDoc();
		send(id, { op: 'decide', action: 'approve', answers: recommended(questions) });
		race.handBefore = { root, id, n: 1 };
		const res = send(id, { op: 'undo' });
		expect(records(id).map((r) => r.action)).toEqual(['approve', 'handed', 'undo']);
		expect(res.status).toBe(409);
		expect(res.body.message).toBe(DOC.undoLate);
		expect(res.body.standing).toMatchObject({ state: 'handed', n: 1, decision: { action: 'approve' } });
		expect(standingOf(root, id).state).toBe('handed');
	});
});

describe('the standing a page reads', () => {
	it('folds the records into state, number, and decision', () => {
		const { id, questions } = mergeDoc();
		expect(standingOf(root, id)).toEqual({ state: 'waiting', n: null, decision: null });
		send(id, { op: 'decide', action: 'approve', answers: recommended(questions) });
		const standing = standingOf(root, id);
		expect(standing).toMatchObject({ state: 'decided', n: 1, decision: { action: 'approve' } });
		expect(Object.keys(standing.decision?.answers ?? {})).toEqual(['q1', 'q2']);
		expect(standing.decision).not.toHaveProperty('heads');
	});
});
