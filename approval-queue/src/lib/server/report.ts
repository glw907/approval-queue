import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reportHeadline } from '#lib/report.ts';
import { readDigest } from './digest.ts';
import { listWaiting, type ItemMeta } from './items.ts';

/** The board and rail headline of a stored report, empty when its `report.md` is missing or has no pass table. */
export async function storedHeadline(root: string, id: string): Promise<string> {
	const text = await readFile(join(root, 'items', id, 'report.md'), 'utf8').catch(() => '');
	return reportHeadline(text);
}

/** A waiting packet of the report's round, as the report page links it. */
export interface WaitingLink {
	id: string;
	title: string;
}

/** A pull request landed in the report's round, as the report page links it. */
export interface LandedLink {
	ref: string;
	claim: string;
	url: string;
}

/** The waiting packets of one initiative and round, oldest first. */
export async function waitingInRound(root: string, meta: ItemMeta): Promise<WaitingLink[]> {
	return (await listWaiting(root))
		.filter((m) => m.kind === 'packet' && m.initiative === meta.initiative && m.round === meta.round)
		.map((m) => ({ id: m.id, title: m.headline ?? m.title }));
}

/** The digest lines that name the report's round, newest first, each with its GitHub pull request address. */
export async function landedInRound(root: string, meta: ItemMeta): Promise<LandedLink[]> {
	if (!meta.round) return [];
	const lines = (await readDigest(root)).flatMap((group) => group.lines).filter((line) => line.round === meta.round);
	return lines
		.sort((a, b) => b.line - a.line)
		.flatMap((line) => {
			const match = /^([^#\s]+\/[^#\s]+)#(\d+)$/.exec(line.ref);
			return match ? [{ ref: line.ref, claim: line.claim, url: `https://github.com/${match[1]}/pull/${match[2]}` }] : [];
		});
}
