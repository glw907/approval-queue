import { storeRoot } from '#lib/store/store.ts';
import { check } from './check.ts';
import { land } from './land.ts';
import { merge } from './merge.ts';
import { ghView } from './pr.ts';
import { restart } from './restart.ts';
import { send } from './send.ts';
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
			return send(arg);
		case 'collect':
			return waitForDecision(storeRoot(), arg);
		case 'withdraw':
			return withdraw(arg);
		case 'land':
			return land(arg, rest[0] ?? '');
		case 'merge':
			return merge(arg);
		case 'restart':
			return restart();
		default:
			return usage();
	}
}

const wanted = command === 'restart' ? 0 : command === 'land' ? 2 : 1;
if (!command || [arg, ...rest].filter((a, i) => i < wanted || a !== '').length > wanted || (wanted && !arg)) usage();
process.exit(await dispatch());
