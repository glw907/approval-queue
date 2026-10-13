/**
 * Entry point for `approval-queue pr|design|triage`: checks the item's brief before it is queued.
 *
 * Run as `node check-brief.ts <pr|design|triage> <file>`. It exits 0 and prints
 * `{"headline": ...}` on a valid brief, exits 2 with the check's messages on stderr for a brief
 * defect, and exits 1 for a tool failure such as an unreadable file. It imports only `brief.ts`,
 * so it runs under plain `node` with no `node_modules`.
 */
import { readFileSync } from 'node:fs';
import { parseBrief, validateTriage } from '#lib/brief.ts';

const [kind, file] = process.argv.slice(2);
if ((kind !== 'pr' && kind !== 'design' && kind !== 'triage') || !file) {
	console.error('usage: check-brief.ts <pr|design|triage> <file>');
	process.exit(1);
}

let text: string;
try {
	text = readFileSync(file, 'utf8');
} catch (error) {
	console.error(`check-brief: cannot read ${file}: ${(error as Error).message}`);
	process.exit(1);
}

const result = kind === 'triage' ? validateTriage(text) : parseBrief(text);
if (!result.ok) {
	console.error(result.messages.join('\n'));
	process.exit(2);
}
const headline = 'triage' in result ? result.triage.headline : result.brief.headline;
console.log(JSON.stringify({ headline }));
