import { check } from './check.ts';
import { ghView } from './pr.ts';

const USAGE = 'usage: approval-queue check <doc.md>';

const [command, path, ...rest] = process.argv.slice(2);

if (command !== 'check' || !path || rest.length) {
	process.stderr.write(`${USAGE}\n`);
	process.exit(2);
}

const { lines, code } = check(path, ghView);
process.stdout.write(lines.map((l) => `${l}\n`).join(''));
process.exit(code);
