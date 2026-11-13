import { storeRoot } from '#lib/store/store.ts';
import { check } from './check.ts';
import { land } from './land.ts';
import { merge } from './merge.ts';
import { notes } from './notes.ts';
import { ghView } from './pr.ts';
import { reply } from './reply.ts';
import { restart } from './restart.ts';
import { send, sendReturn } from './send.ts';
import { USAGE, waitForDecision } from './wait.ts';
import { withdraw } from './withdraw.ts';

const [command, arg = '', ...rest] = process.argv.slice(2);

function usage(): never {
	process.stderr.write(`${USAGE}\n`);
	process.exit(2);
}

async function dispatch(): Promise<number> {
	switch (command) {
		case 'check': {
			const { lines, code } = check(arg, ghView);
			process.stdout.write(lines.map((l) => `${l}\n`).join(''));
			return code;
		}
		case 'send':
			return returns ? sendReturn(rest[0], rest[1]) : send(arg);
		case 'collect':
			return waitForDecision(storeRoot(), arg);
		case 'withdraw':
			return withdraw(arg);
		case 'land':
			return land(arg, rest[0] ?? '');
		case 'merge':
			return merge(arg);
		case 'notes':
			return notes(arg);
		case 'reply':
			return rest[1] === undefined ? reply(arg, undefined, rest[0] ?? '') : reply(arg, rest[0], rest[1]);
		case 'restart':
			return restart();
		default:
			return usage();
	}
}

const returns = command === 'send' && arg === '--returns';
const wanted = command === 'restart' ? 0 : command === 'land' ? 2 : command === 'reply' || returns ? 3 : 1;
if ((command === 'reply' && !rest[0]) || (returns && !rest[1])) usage();
if (!command || [arg, ...rest].filter((a, i) => i < wanted || a !== '').length > wanted || (wanted && !arg)) usage();
process.exit(await dispatch());
