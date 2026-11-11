import type { Call, Facts } from '#lib/facts.ts';
import type { CallPick, Decision, Note } from './items.ts';

/** The form fields of a post; `FormData` and `URLSearchParams` both fit. */
export interface Fields {
	get(name: string): unknown;
	keys(): Iterable<string>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parses a posted `notes` array; null when it is not a list of `{id, text, anchor}`. */
export function parseNotes(raw: unknown): Note[] | null {
	if (typeof raw !== 'string') return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	const ok = (n: unknown) => isObject(n) && typeof n.id === 'string' && typeof n.text === 'string' && (n.anchor === null || isObject(n.anchor));
	return Array.isArray(value) && value.every(ok) ? (value as Note[]) : null;
}

/** Parses a posted list of picks against the calls they answer: each `call` counts from 1 and `choice` is one of that call's labels. */
function parsePicks(raw: unknown, calls: readonly Call[], exact: boolean): CallPick[] | null {
	if (typeof raw !== 'string') return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!Array.isArray(value) || (exact && value.length !== calls.length)) return null;
	const ok = (p: unknown, i: number) =>
		isObject(p) &&
		typeof p.changed === 'boolean' &&
		Number.isInteger(p.call) &&
		(!exact || p.call === i + 1) &&
		typeof p.choice === 'string' &&
		calls[(p.call as number) - 1]?.options.some((o) => o.label === p.choice) === true;
	return value.every(ok) ? (value as CallPick[]) : null;
}

const refusePacket = (message: string): PacketDecision => ({ ok: false, message });

export type PacketDecision = { ok: true; decision: Extract<Decision, { notes: Note[] }> } | { ok: false; message: string };

/**
 * Builds a packet's decision from the fact file and the post's `calls`, `decidedForYou`, and `notes`
 * fields (each JSON). An approve answers every call and every decided-for-you entry; a send-back
 * needs a note, since the session has nothing to act on without one.
 */
export function buildPacketDecision(decision: 'approve' | 'reject', facts: Facts, form: Fields): PacketDecision {
	const notes = parseNotes(form.get('notes') ?? '[]');
	if (!notes) return refusePacket('The notes are not a list of notes');
	const exact = decision === 'approve';
	const calls = parsePicks(form.get('calls') ?? '[]', facts.calls, exact);
	if (!calls) return refusePacket('The calls do not match the packet; reload the page');
	const decidedForYou = parsePicks(form.get('decidedForYou') ?? '[]', facts.decidedForYou, exact);
	if (!decidedForYou) return refusePacket('The decided-for-you entries do not match the packet; reload the page');
	if (decision === 'reject' && !notes.some((n) => n.text.trim() !== '')) return refusePacket('Add a note before you send it back');
	return { ok: true, decision: { decision, calls, decidedForYou, notes } };
}
