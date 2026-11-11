// CT step 10: approve, then close the page inside the 5-second hold, and find decision.json written.
// The hold's timer dies with the tab, so only the keepalive request `pagehide` sends can have written it.
// Usage: node close-in-hold.mjs <base url> <item id> <state dir holding items/>
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { args, check, launch } from './notes-common.mjs';

const HOLD_MS = 5000;
const { base, id, state } = args();
const file = join(state, 'items', id, 'decision.json');
const written = () => access(file).then(() => true, () => false);
const { browser, page } = await launch();
try {
	await page.goto(`${base}/item/${id}`);
	await page.waitForSelector('#margin');
	await page.waitForLoadState('networkidle');
	check(!(await written()), 'no decision before the approve');
	const pressed = Date.now();
	await page.keyboard.press('Control+Enter');
	await page.waitForSelector('[aria-label="Decision held"]');
	await new Promise((r) => setTimeout(r, 1000));
	await page.close();
	let found = false;
	while (Date.now() - pressed < HOLD_MS - 500 && !found) {
		found = await written();
		if (!found) await new Promise((r) => setTimeout(r, 100));
	}
	check(found, 'the approve was stored although the page closed inside the hold');
	await new Promise((r) => setTimeout(r, HOLD_MS));
	check(await written(), 'the decision is still there after the hold would have ended');
} finally {
	await browser.close();
}
