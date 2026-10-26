/**
 * Entry point for `approval-queue pr|design|triage|packet|docs`: checks the item's brief, packet, or
 * description before it is queued. The kinds it checks are `pr`, `design`, `triage`, `packet`, and
 * `description`.
 *
 * Run as `node check-brief.ts <pr|design|triage|packet> <file>`, or as
 * `node check-brief.ts description <file> <title>` for a docs review's description and title.
 * It exits 0 and prints `{"headline": ...}` on a valid brief, the whole parse as JSON on a valid
 * packet, and the paragraphs as a JSON array on a valid description. It exits 2 with the check's
 * messages on stderr for a defect, and 1 for a tool failure such as an unreadable file. It imports only `brief.ts` and `packet.ts`, so it runs under plain `node` with
 * no `node_modules`.
 */
import { readFileSync } from 'node:fs';
import { parseBrief, validateTriage } from '#lib/brief.ts';
import { REGISTER_PATH } from '#lib/brief.ts';
import { descriptionDefects, descriptionParagraphs, parsePacket, titleDefects } from '#lib/packet.ts';

const [kind, file, title] = process.argv.slice(2);
if (
	(kind !== 'pr' && kind !== 'design' && kind !== 'triage' && kind !== 'packet' && kind !== 'description') ||
	!file ||
	(kind === 'description') !== (title !== undefined)
) {
	console.error('usage: check-brief.ts <pr|design|triage|packet> <file> | check-brief.ts description <file> <title>');
	process.exit(1);
}

let text: string;
try {
	text = readFileSync(file, 'utf8');
} catch (error) {
	console.error(`check-brief: cannot read ${file}: ${(error as Error).message}`);
	process.exit(1);
}

if (kind === 'description') {
	const paragraphs = descriptionParagraphs(text);
	const defects = [...titleDefects(title!), ...descriptionDefects(paragraphs)];
	if (defects.length > 0) {
		console.error(defects.map((d) => `${d} (see ${REGISTER_PATH})`).join('\n'));
		process.exit(2);
	}
	console.log(JSON.stringify(paragraphs));
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
