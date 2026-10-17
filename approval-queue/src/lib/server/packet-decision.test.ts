import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedPacket } from '#lib/fixtures/seed-packet.ts';
import { readItem } from './items.ts';
import { buildApprove, packetFingerprint } from './packet-decision.ts';

const BASE = readFileSync(new URL('../fixtures/packet-baseline.md', import.meta.url), 'utf8').replace(
	'glw907/drafter:docs/specs/notes-design.md',
	'glw907/drafter#43'
);
const REVERSIBLE = BASE.replace('[irreversible]', '[session]');

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'approval-queue-decision-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function content(markdown = BASE) {
	await seedPacket(root, 'p', markdown);
	const item = await readItem(root, 'p');
	if (item?.content.kind !== 'packet') throw new Error('not a packet');
	return item.content;
}

const answers = (fp: string, over: Record<string, string | null> = {}) =>
	new URLSearchParams(
		Object.entries({
			fingerprint: fp,
			'part:glw907/drafter#42': 'hold',
			'part:glw907/drafter#43': 'approve',
			'part:step:1': 'session',
			'ask:1': 'Merge anyway',
			'ask:2': 'Beta',
			irreversible: 'yes',
			...over
		}).filter((e): e is [string, string] => e[1] !== null)
	);

async function build(over: Record<string, string | null> = {}, markdown = BASE) {
	const c = await content(markdown);
	return buildApprove(c, answers(packetFingerprint(c.parts, c.packet.asks), over));
}

describe('packetFingerprint', () => {
	it('is stable for the same packet and changes with a head, a verdict, or a choice tag', async () => {
		const c = await content();
		const fp = packetFingerprint(c.parts, c.packet.asks);
		expect(fp).toMatch(/^[0-9a-f]{64}$/);
		expect(packetFingerprint(c.parts, c.packet.asks)).toBe(fp);
		const moved = c.parts.map((p) => (p.ref === 'glw907/drafter#43' ? { ...p, head: 'zzz999' } : p));
		expect(packetFingerprint(moved, c.packet.asks)).not.toBe(fp);
		const rerouted = c.parts.map((p) => (p.ref === 'glw907/drafter#42' ? { ...p, verdict: 'hold' } : p));
		expect(packetFingerprint(rerouted, c.packet.asks)).not.toBe(fp);
		const retagged = structuredClone(c.packet.asks);
		retagged[0].choices[0].verdict = 'hold';
		expect(packetFingerprint(c.parts, retagged)).not.toBe(fp);
	});
});

describe('buildApprove', () => {
	it('lists every part once in packet order, with the verdicts read by ref and the tag of each picked choice', async () => {
		expect(await build()).toEqual({
			ok: true,
			decision: {
				decision: 'approve',
				parts: [
					{ ref: 'glw907/drafter#41', verdict: 'approve' },
					{ ref: 'glw907/drafter#42', verdict: 'hold' },
					{ ref: 'glw907/drafter#43', verdict: 'approve' },
					{ ref: 'step:1', verdict: 'session' }
				],
				asks: [
					{ index: 1, choice: 'Merge anyway' },
					{ index: 2, choice: 'Beta' }
				]
			}
		});
	});

	it.each([
		['Hold', 'hold'],
		['Send back', 'send-back']
	])('gives an ask-bound part the %s choice’s tag, never approve', async (label, verdict) => {
		const r = await build({ 'ask:1': label });
		expect(r).toMatchObject({ ok: true });
		if (!r.ok) return;
		const parts = (r.decision as { parts: Array<{ ref: string; verdict: string }> }).parts;
		expect(parts.find((p) => p.ref === 'glw907/drafter#41')?.verdict).toBe(verdict);
	});

	it.each([
		['an unanswered ask', { 'ask:2': null }],
		['a label the ask does not hold', { 'ask:2': 'Merge anyway' }],
		['a missing part', { 'part:glw907/drafter#43': null }],
		['an unknown ref', { 'part:glw907/drafter#99': 'approve' }],
		['an ask-bound ref posted as a routine row', { 'part:glw907/drafter#41': 'approve' }],
		['a verdict outside the part’s kind', { 'part:step:1': 'approve' }],
		['a PR verdict on a step', { 'part:glw907/drafter#42': 'session' }],
		['a stale fingerprint', { fingerprint: 'stale' }],
		['a missing irreversible confirmation', { irreversible: null }]
	])('refuses %s', async (_name, over) => {
		expect(await build(over)).toMatchObject({ ok: false });
	});

	it('names the reload on a stale fingerprint', async () => {
		expect(await build({ fingerprint: 'stale' })).toEqual({ ok: false, message: 'The packet changed; reload the page' });
	});

	it('asks no confirmation of a packet with no irreversible step or rule', async () => {
		expect(await build({ irreversible: null }, REVERSIBLE)).toMatchObject({ ok: true });
	});

	it('requires the confirmation for an irreversible ask rule alone', async () => {
		const ruled = REVERSIBLE.replace('Rule: owner-call', 'Rule: irreversible');
		expect(await build({ irreversible: null }, ruled)).toMatchObject({ ok: false });
		expect(await build({}, ruled)).toMatchObject({ ok: true });
	});
});
