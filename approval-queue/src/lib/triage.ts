import type { Proposed, TriageRow } from '#lib/brief.ts';

export type Disposition = Proposed;

/** A file row plus the reader's call; the row's number is its position in the list. */
export interface Row extends TriageRow {
	disposition: Disposition;
	/** Geoff's own words; the session's `why` is never overwritten. */
	note: string;
}

/** Returns a copy with only row `index` changed, so the array's order never shifts under the view. */
export function moveRow<T extends Row>(rows: readonly T[], index: number, disposition: Disposition): T[] {
	return rows.map((row, i) => (i === index ? { ...row, disposition } : row));
}

/** The view: each section's rows with their position in the list, which is the item number minus one. */
export function groupRows<T extends Row>(rows: readonly T[]): Record<Disposition, { row: T; index: number }[]> {
	const groups: Record<Disposition, { row: T; index: number }[]> = { now: [], defer: [], drop: [] };
	rows.forEach((row, index) => groups[row.disposition].push({ row, index }));
	return groups;
}

export function changedCount(rows: readonly Row[]): number {
	return rows.filter((row) => row.disposition !== row.proposed).length;
}

/**
 * The rows to show when an item opens: the unsent draft when it still matches the item, else
 * the fresh rows. A draft matches only when it carries the same actions in the same order, so a
 * triage re-queued under the same id never shows calls made against its old rows.
 */
export function seedRows<T extends Row>(fresh: readonly T[], draft: readonly T[] | undefined): T[] {
	const fits = draft?.length === fresh.length && draft.every((row, i) => row.action === fresh[i].action);
	return fits ? [...draft] : [...fresh];
}
