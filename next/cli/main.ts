import { storeRoot } from '#lib/store/store.ts';
import { check } from './check.ts';
import { land } from './land.ts';
import { ghView } from './pr.ts';
import { send } from './send.ts';
import { USAGE, waitForDecision } from './wait.ts';
import { withdraw } from './withdraw.ts';

const [command, arg, ...rest] = process.argv.slice(2);

function usage(): never {
	process.stderr.write(`${USAGE}\n`);
	process.exit(2);
}

async function dispatch(arg: string): Promise<number> {
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
		default:
			return usage();
	}
}

if (!arg || rest.length > (command === 'land' ? 1 : 0)) usage();
process.exit(await dispatch(arg));
