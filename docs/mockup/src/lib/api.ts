import type { DocState } from '#lib/types';

/** Sends one change to the queue and returns the document's stored state. Throws when the queue does not answer. */
export async function post(id: string, body: Record<string, unknown>): Promise<DocState> {
	const res = await fetch(`/api/${id}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`The queue answered ${res.status}.`);
	return (await res.json()) as DocState;
}
