/**
 * Entry point for `approval-queue pr|design|triage|packet`: checks the item's brief or packet before it is queued.
 *
 * Run as `node check-brief.ts <pr|design|triage|packet> <file>`. It exits 0 and prints
 * `{"headline": ...}` on a valid brief and the whole parse as JSON on a valid packet. It exits 2
 * with the check's messages on stderr for a defect, and 1 for a tool failure such as an
 * unreadable file. It imports only `brief.ts` and `packet.ts`, so it runs under plain `node` with
 * no `node_modules`.
 */
import { readFileSync } from 'node:fs';
import { parseBrief, validateTriage } from '#lib/brief.ts';
import { parsePacket } from '#lib/packet.ts';

const [kind, file] = process.argv.slice(2);
if ((kind !== 'pr' && kind !== 'design' && kind !== 'triage' && kind !== 'packet') || !file) {
	console.error('usage: check-brief.ts <pr|design|triage|packet> <file>');
	process.exit(1);
}

let text: string;
try {
	text = readFileSync(file, 'utf8');
} catch (error) {
	console.error(`check-brief: cannot read ${file}: ${(error as Error).message}`);
	process.exit(1);
}

if (kind === 'packet') {
	const parsed = parsePacket(text);
	if (!parsed.ok) {
		console.error(parsed.messages.join('\n'));
		process.exit(2);
	}
	console.log(JSON.stringify(parsed.packet));
	process.exit(0);
}

const result = kind === 'triage' ? validateTriage(text) : parseBrief(text);
if (!result.ok) {
	console.error(result.messages.join('\n'));
	process.exit(2);
}
const headline = 'triage' in result ? result.triage.headline : result.brief.headline;
console.log(JSON.stringify({ headline }));
