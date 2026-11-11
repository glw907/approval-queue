/**
 * Entry point for `approval-queue design|triage|packet`: checks the item's brief, or its fact file and
 * text, before it is queued. The kinds it checks are `design`, `triage`, `packet`, and `facts`.
 *
 * Run as `node check-brief.ts <design|triage|packet> <file>`, or as
 * `node check-brief.ts facts <facts.json> <text.md> [snapshot-dir]` for a fact file and its text. With a
 * snapshot directory, each claim's line range is checked against the patches in it. It exits 0 and
 * prints `{"headline": ...}` on a valid brief, the whole parse as JSON on a valid packet, and
 * `{"facts": ..., "text": ...}` on a valid pair. It exits 2 with the check's messages on stderr for a
 * defect, and 1 for a tool failure such as an unreadable file. It imports only `brief.ts`, `facts.ts`,
 * and `packet.ts`, so it runs under plain `node` with no `node_modules`.
 */
import { readFileSync } from 'node:fs';
import { parseBrief, validateTriage } from '#lib/brief.ts';
import { checkClaimRanges, parseFacts, parseText } from '#lib/facts.ts';
import { parsePacket } from '#lib/packet.ts';

const [kind, file, textFile, snapshot] = process.argv.slice(2);
if (
	(kind !== 'design' && kind !== 'triage' && kind !== 'packet' && kind !== 'facts') ||
	!file ||
	(kind === 'facts') !== (textFile !== undefined) ||
	(snapshot !== undefined && kind !== 'facts')
) {
	console.error('usage: check-brief.ts <design|triage|packet> <file> | check-brief.ts facts <facts.json> <text.md> [snapshot-dir]');
	process.exit(1);
}

function read(path: string): string {
	try {
		return readFileSync(path, 'utf8');
	} catch (error) {
		console.error(`check-brief: cannot read ${path}: ${(error as Error).message}`);
		process.exit(1);
	}
}

const text = read(file);

if (kind === 'facts') {
	const facts = parseFacts(text);
	if (!facts.ok) {
		console.error(facts.messages.join('\n'));
		process.exit(2);
	}
	const parsed = parseText(read(textFile), facts.value);
	if (!parsed.ok) {
		console.error(parsed.messages.join('\n'));
		process.exit(2);
	}
	if (snapshot !== undefined) {
		const defects = checkClaimRanges(parsed.value.claims, snapshot);
		if (defects.length > 0) {
			console.error(defects.join('\n'));
			process.exit(2);
		}
	}
	console.log(JSON.stringify({ facts: facts.value, text: parsed.value }));
	process.exit(0);
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
