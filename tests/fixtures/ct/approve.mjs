// CT step 4: approve an item with Ctrl+Enter and wait for the decision file. The app holds an approve for
// 5 seconds before it posts. Usage: node approve.mjs <base url> <item id> <state dir holding items/>
// Pass `reject` as a fourth argument to send back instead, by focusing "Send back" and pressing Enter.
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { args, check, launch, until } from './notes-common.mjs';

const { base, id, state } = args();
const reject = process.argv[5] === 'reject';
const { browser, page } = await launch();
try {
	await page.goto(`${base}/item/${id}`);
	await page.waitForSelector('#margin');
	await page.waitForLoadState('networkidle');
	if (reject) {
		await page.getByRole('button', { name: /^Send back/ }).focus();
		await page.keyboard.press('Enter');
	}
	else await page.keyboard.press('Control+Enter');
	await until(() => access(join(state, 'items', id, 'decision.json')).then(() => true), 'decision.json');
	check(true, reject ? 'the send-back was stored' : 'the approve was stored after its hold');
} finally {
	await browser.close();
}
