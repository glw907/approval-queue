/** The item after `id`, else the oldest other one, else null; the queue is oldest first. */
export function nextItem<T extends { id: string }>(queue: readonly T[], id: string): T | null {
	const index = queue.findIndex((item) => item.id === id);
	return queue.slice(index + 1)[0] ?? queue.find((item) => item.id !== id) ?? null;
}
