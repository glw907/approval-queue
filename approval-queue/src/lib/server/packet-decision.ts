import { createHash } from 'node:crypto';
import { VERDICTS, type PacketAsk } from '#lib/packet.ts';
import type { Decision, PacketCall, PacketPart } from './items.ts';

/** The form fields of a post; `FormData` and `URLSearchParams` both fit. */
export interface Fields {
	get(name: string): unknown;
	keys(): Iterable<string>;
}

export type Approve = { ok: true; decision: Decision } | { ok: false; message: string };

/**
 * Names the parts and asks a page showed, so a post made against a different packet is refused. It
 * covers every part's preselected verdict and head or hash, and every ask's choice labels and
 * tags, since those decide what an approve authorizes.
 */
export function packetFingerprint(parts: readonly PacketPart[], asks: readonly PacketAsk[]): string {
	const shown = {
		parts: parts.map((p) => [p.ref, p.kind, p.verdict, p.head ?? p.sha256 ?? '']),
		asks: asks.map((a) => [a.question, a.choices.map((c) => [c.label, c.verdict ?? ''])])
	};
	return createHash('sha256').update(JSON.stringify(shown)).digest('hex');
}

/** Whether approving needs the one confirmation that names the irreversible steps. */
export const isIrreversible = (packet: { steps: ReadonlyArray<{ tag: string }>; asks: ReadonlyArray<{ rule: string }> }) =>
	packet.steps.some((s) => s.tag === 'irreversible') || packet.asks.some((a) => a.rule === 'irreversible');

const refuse = (message: string): Approve => ({ ok: false, message });

/**
 * Builds the approve decision from the packet the server rebuilt and the post. A routine verdict is
 * read by ref and an ask's answer by label; an ask-bound part takes its verdict from the picked
 * choice's tag alone. Nothing is defaulted, and the post never supplies a head or a hash.
 */
export function buildApprove(
	content: { packet: { steps: ReadonlyArray<{ tag: string }>; asks: PacketAsk[] }; parts: PacketPart[] },
	form: Fields
): Approve {
	const { packet, parts } = content;
	if (form.get('fingerprint') !== packetFingerprint(parts, packet.asks)) {
		return refuse('The packet changed; reload the page');
	}
	if (isIrreversible(packet) && form.get('irreversible') !== 'yes') {
		return refuse('Confirm the irreversible steps first');
	}

	const routine = new Set(parts.filter((p) => p.lane === 'routine').map((p) => p.ref));
	for (const key of form.keys()) {
		if (key.startsWith('part:') && !routine.has(key.slice('part:'.length))) return refuse(`Unknown part ${key.slice('part:'.length)}`);
		if (key.startsWith('ask:') && !packet.asks.some((_, i) => key === `ask:${i + 1}`)) return refuse(`Unknown ask ${key.slice('ask:'.length)}`);
	}

	const answers = new Map<string, { verdict?: string }>();
	const asks: Array<{ index: number; choice: string }> = [];
	for (const [i, ask] of packet.asks.entries()) {
		const label = form.get(`ask:${i + 1}`);
		const picked = typeof label === 'string' ? ask.choices.find((c) => c.label === label) : undefined;
		if (!picked) return refuse(`Answer “${ask.question}” first`);
		asks.push({ index: i + 1, choice: picked.label });
		if (ask.part) answers.set(ask.part.ref, picked);
	}

	const out: Array<{ ref: string; verdict: string }> = [];
	for (const part of parts) {
		const verdict = part.lane === 'ask' ? answers.get(part.ref)?.verdict : form.get(`part:${part.ref}`);
		if (typeof verdict !== 'string' || !VERDICTS[part.kind].includes(verdict)) {
			return refuse(`Set a verdict for ${part.ref} first`);
		}
		out.push({ ref: part.ref, verdict });
	}
	return { ok: true, decision: { decision: 'approve', parts: out, asks } };
}

/**
 * Builds a packet send-back's `calls` from the packet the server rebuilt and the post: one verdict
 * per part, then one pick per ask. A field the post lacks, or a value the packet does not hold, is
 * `null`. Nothing is refused, since a send-back authorizes nothing.
 */
export function buildSentBackCalls(
	content: { packet: { asks: PacketAsk[] }; parts: PacketPart[] },
	form: Fields
): PacketCall[] {
	const { asks } = content.packet;
	const picked = asks.map((ask, i) => {
		const label = form.get(`ask:${i + 1}`);
		return ask.choices.find((c) => c.label === label);
	});
	const bound = new Map(asks.flatMap((ask, i) => (ask.part ? [[ask.part.ref, picked[i]?.verdict] as const] : [])));
	const parts = content.parts.map(({ ref, kind, lane }): PacketCall => {
		const verdict = lane === 'ask' ? bound.get(ref) : form.get(`part:${ref}`);
		return { ref, verdict: typeof verdict === 'string' && VERDICTS[kind].includes(verdict) ? verdict : null };
	});
	return [...parts, ...asks.map((ask, i): PacketCall => ({ ask: i + 1, question: ask.question, choice: picked[i]?.label ?? null }))];
}
