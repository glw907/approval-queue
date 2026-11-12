import { error, json } from '@sveltejs/kit';
import { docState, read, write } from '#lib/server/store';
import type { Thread } from '#lib/types';
import type { RequestHandler } from './$types';

interface Body {
	op: 'answer' | 'decide' | 'undo' | 'note' | 'reply' | 'resolve' | 'delete';
	question?: string;
	option?: number;
	type?: 'approve' | 'sendback' | 'read';
	answers?: Record<string, number>;
	thread?: string;
	quote?: string;
	start?: number;
	text?: string;
	resolved?: boolean;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const state = read();
	if (state.down) error(503, 'The queue is not running.');
	const body = (await request.json()) as Body;
	const doc = docState(state, params.id);
	const now = new Date().toISOString();
	const find = (): Thread => {
		const t = doc.threads.find((x) => x.id === body.thread);
		if (!t) error(404, 'No such note.');
		return t;
	};
	switch (body.op) {
		case 'answer':
			doc.answers[body.question!] = body.option!;
			break;
		case 'decide':
			doc.decision = { type: body.type!, at: now, answers: body.answers ?? {} };
			break;
		case 'undo':
			delete doc.decision;
			break;
		case 'note':
			doc.threads.push({
				id: `n${Date.now()}`,
				quote: body.quote!,
				start: body.start,
				entries: [{ who: 'geoff', text: body.text!, time: now }]
			});
			break;
		case 'reply':
			find().entries.push({ who: 'geoff', text: body.text!, time: now });
			break;
		case 'resolve':
			find().resolved = body.resolved;
			break;
		case 'delete':
			doc.threads = doc.threads.filter((x) => x.id !== body.thread);
			break;
	}
	write(state);
	return json(doc);
};
