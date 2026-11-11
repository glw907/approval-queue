import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Appends `{time, item, fold}` to `folds.jsonl` in the state directory: one line each time a fold opens. */
export async function appendFold(root: string, item: string, fold: string): Promise<void> {
	await appendFile(join(root, 'folds.jsonl'), `${JSON.stringify({ time: new Date().toISOString(), item, fold })}\n`);
}
