import { USAGE } from './wait.ts';

/** Subcommands of the old queue's command that the new one lacks. */
const RETIRED = ['design', 'triage', 'snapshot', 'packet', 'report', 'pending', 'digest'];

const [command, arg = '', ...rest] = process.argv.slice(2);

function usage(): never {
	process.stderr.write(`${USAGE}\n`);
	process.exit(2);
}

// Each command loads on its own, so `restart`, the retired names, and the usage line run in a
// checkout that has no `node_modules` yet.
async function dispatch(): Promise<number> {
	switch (command) {
		case 'check': {
			const { check } = await import('./check.ts');
			const { ghView } = await import('./pr.ts');
			const { lines, code } = check(arg, ghView);
			process.stdout.write(lines.map((l) => `${l}\n`).join(''));
			return code;
		}
		case 'send': {
			const { send, sendReturn } = await import('./send.ts');
			return returns ? sendReturn(rest[0], rest[1]) : send(arg);
		}
		case 'collect': {
			const { storeRoot } = await import('#lib/store/store.ts');
			const { waitForDecision } = await import('./wait.ts');
			return waitForDecision(storeRoot(), arg);
		}
		case 'withdraw':
			return (await import('./withdraw.ts')).withdraw(arg);
		case 'land':
			return (await import('./land.ts')).land(arg, rest[0] ?? '');
		case 'merge':
			return (await import('./merge.ts')).merge(arg);
		case 'notes':
			return (await import('./notes.ts')).notes(arg);
		case 'reply': {
			const { reply } = await import('./reply.ts');
			return rest[1] === undefined ? reply(arg, undefined, rest[0] ?? '') : reply(arg, rest[0], rest[1]);
		}
		case 'restart':
			return (await import('./restart.ts')).restart();
		default:
			return usage();
	}
}

if (command && RETIRED.includes(command)) {
	process.stderr.write(
		`approval-queue: ${command} is gone from the new queue; the approval-packet skill says what to run now\n`
	);
	process.exit(1);
}

const returns = command === 'send' && arg === '--returns';
const wanted = command === 'restart' ? 0 : command === 'land' ? 2 : command === 'reply' || returns ? 3 : 1;
if ((command === 'reply' && !rest[0]) || (returns && !rest[1])) usage();
if (!command || [arg, ...rest].filter((a, i) => i < wanted || a !== '').length > wanted || (wanted && !arg)) usage();
process.exit(await dispatch());
