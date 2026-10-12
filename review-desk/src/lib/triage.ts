export type Disposition = 'now' | 'defer' | 'drop';

export interface Row {
	/** The item's text; its number is its position in the list. */
	item: string;
	disposition: Disposition;
	/** What the review proposed; a row counts as changed when it differs. */
	proposed: Disposition;
	reason: string;
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
