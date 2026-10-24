/**
 * The item after `id`, else the oldest other one, else null; the queue is oldest first. A deferred item
 * is never next: Geoff put it aside, so a decision does not open it.
 */
export function nextItem<T extends { id: string; deferred?: boolean }>(queue: readonly T[], id: string): T | null {
	const index = queue.findIndex((item) => item.id === id);
	const open = (item: T) => item.id !== id && !item.deferred;
	return queue.slice(index + 1).find(open) ?? queue.find(open) ?? null;
}
