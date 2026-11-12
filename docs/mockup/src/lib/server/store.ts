import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DocState, Thread } from '#lib/types';

const DIR = join(process.cwd(), '.state');
const FILE = join(DIR, 'state.json');
const SEED = join(process.cwd(), 'content', 'seed-notes.json');

interface State {
	down: boolean;
	docs: Record<string, DocState>;
}

function seed(): State {
	const notes = JSON.parse(readFileSync(SEED, 'utf8')) as Record<string, Omit<Thread, 'id'>[]>;
	const docs: Record<string, DocState> = {};
	for (const [id, threads] of Object.entries(notes)) {
		docs[id] = { answers: {}, threads: threads.map((t, i) => ({ ...t, id: `seed${i}` })) };
	}
	return { down: false, docs };
}

export function read(): State {
	if (!existsSync(FILE)) return seed();
	return JSON.parse(readFileSync(FILE, 'utf8')) as State;
}

export function write(state: State): void {
	mkdirSync(DIR, { recursive: true });
	writeFileSync(FILE + '.tmp', JSON.stringify(state, null, 1));
	renameSync(FILE + '.tmp', FILE);
}

export function reset(): void {
	write(seed());
}

export function docState(state: State, id: string): DocState {
	return (state.docs[id] ??= { answers: {}, threads: [] });
}
