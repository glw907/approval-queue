import type { PrView, ViewResult } from '#lib/doc/pr.ts';
import { addVersion, createDocument, readDocument, storeRoot, writeDecision, writeNamed } from '#lib/store/store.ts';
import { check } from './check.ts';
import { ghView } from './pr.ts';
import { showDocument } from './show.ts';
import type { State } from './state.ts';
import { readState, storeFailure, waitForDecision } from './wait.ts';

/** `ghView`'s view, which carries the head commit the pull request had when it was checked. */
type HeadView = PrView & { headRefOid?: string };

/** A pull request's head as `send` read it, one entry of `heads.json`. */
export type Head = { repo: string; number: number; head: string };

/**
 * Wraps `ghView` so each pull request's head is kept from the same read that was checked, in the
 * order `check` reads them, which is the document's.
 */
function headKeeper() {
	const heads: Head[] = [];
	const headless: string[] = [];
	const view = (repo: string, number: number): ViewResult => {
		const read = ghView(repo, number);
		if (read.ok) {
			const head = (read.view as HeadView).headRefOid;
			if (typeof head === 'string' && head) heads.push({ repo, number, head });
			else headless.push(`${repo}#${number}`);
		}
		return read;
	};
	return { view, heads, headless };
}

type Checked = { doc: NonNullable<ReturnType<typeof check>['doc']>; source: string; heads: Head[] };

/**
 * Runs `send`'s check on the document at `path`, keeping each pull request's head. Returns what
 * to store, or the exit code after printing why nothing can be stored: a fault, a check still
 * running, or a merge pull request GitHub gives no head for.
 */
function checkToSend(path: string): Checked | number {
	const kept = headKeeper();
	const checked = check(path, kept.view);
	if (checked.code !== 0 || !checked.doc || checked.source === null) {
		process.stderr.write(checked.lines.map((l) => `${l}\n`).join(''));
		return checked.code || 1;
	}
	if (checked.pending.length) {
		process.stderr.write(checked.pending.map((l) => `${l}\n`).join(''));
		process.stderr.write('approval-queue: a check is still running; send it when the checks finish\n');
		return 1;
	}
	if (checked.doc.kind === 'merge' && kept.headless.length) {
		const names = kept.headless.join(', ');
		process.stderr.write(`approval-queue: GitHub gave no head commit for ${names}, so nothing was stored\n`);
		return 1;
	}
	return { doc: checked.doc, source: checked.source, heads: kept.heads };
}

/**
 * Checks a document as `check` does, stores it, opens its page, and waits for the queue's decision. A fault, or a
 * check still running, stores nothing and exits 1. A report prints its id and exits at once.
 *
 * @remarks A merge document also stores `heads.json`, each pull request's head commit as it was
 * checked, which an approve copies so `merge` merges only what Geoff read. A pull request GitHub
 * gives no head for stores nothing and exits 1.
 */
export async function send(path: string): Promise<number> {
	const checked = checkToSend(path);
	if (typeof checked === 'number') return checked;
	const merge = checked.doc.kind === 'merge';
	const root = storeRoot();
	let id: string;
	try {
		id = createDocument(root, checked.source, { kind: checked.doc.kind as string, title: checked.doc.title }).id;
	} catch (err) {
		return storeFailure(err);
	}
	if (merge) {
		try {
			writeNamed(root, id, 'heads.json', checked.heads);
		} catch (err) {
			// The document is stored, so name it: with no heads it can't be approved.
			process.stderr.write(`approval-queue: stored ${id}, but not its head commits, so it can't be approved\n`);
			return storeFailure(err);
		}
	}
	process.stderr.write(`approval-queue: stored ${id}\n`);
	await showDocument(id);
	if (checked.doc.kind === 'report') {
		process.stdout.write(`${id}\n`);
		return 0;
	}
	process.stderr.write(`approval-queue: waiting for a decision on ${id}\n`);
	return waitForDecision(root, id);
}

/** How a refusal of `send --returns` names the state a document is in. */
function stateName(state: State): string {
	if (state.state === 'waiting') return 'waiting for a decision';
	if (state.state === 'withdrawn') return 'withdrawn';
	if (state.state === 'decided') return `decided (${state.decision.action}) and not handed over yet`;
	return `handed over as ${state.decision.action}`;
}

/** A refusal of `send --returns`: its sentence goes on stderr and the command exits 1. */
const refuse = (sentence: string) => {
	process.stderr.write(`approval-queue: ${sentence}\n`);
	return 1;
};

/**
 * Returns a revised document for the send-back of document `id`, then waits for the new decision
 * as `send` does.
 *
 * @remarks
 * Refuses with exit 1, storing nothing, unless the document's send-back has been handed over, and
 * when the revision changes the document's kind or fails `send`'s check. Then it adds the version,
 * rewrites a merge document's `heads.json` with the heads just checked, and empties
 * `answers.json`, because question ids can move between versions. Last it writes a `returned`
 * record, which folds the document back to waiting. A write that fails after the version is added
 * exits 1 and names the version.
 */
export async function sendReturn(id: string, path: string): Promise<number> {
	const root = storeRoot();
	let kind: string;
	try {
		const state = readState(root, id);
		if (state.state !== 'handed' || state.decision.action !== 'sendback') {
			return refuse(`only a send-back that was handed over can be returned, and ${id} is ${stateName(state)}`);
		}
		kind = readDocument(root, id).meta.kind;
	} catch (err) {
		return storeFailure(err);
	}
	const checked = checkToSend(path);
	if (typeof checked === 'number') return checked;
	if (checked.doc.kind !== kind) {
		return refuse(`${id} is a ${kind} document and ${path} is a ${checked.doc.kind} document; a return keeps the kind`);
	}
	let version: number;
	try {
		version = addVersion(root, id, checked.source).versions;
	} catch (err) {
		return storeFailure(err);
	}
	try {
		if (kind === 'merge') writeNamed(root, id, 'heads.json', checked.heads);
		writeNamed(root, id, 'answers.json', {});
		writeDecision(root, id, { action: 'returned', at: new Date().toISOString(), version });
	} catch (err) {
		process.stderr.write(`approval-queue: stored version ${version} of ${id}, but the return isn't complete\n`);
		return storeFailure(err);
	}
	process.stderr.write(`approval-queue: returned ${id} as version ${version}\n`);
	await showDocument(id);
	process.stderr.write(`approval-queue: waiting for a decision on ${id}\n`);
	return waitForDecision(root, id);
}
