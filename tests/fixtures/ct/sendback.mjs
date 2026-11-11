// CT step 6 (first half): write two notes with the mouse, one on the second paragraph of the opening
// and one in "Not checked", then send the packet back. Usage:
//   node sendback.mjs <base url> <item id> <state dir holding items/>
// It prints the two quotes as JSON, so the resend can rewrite the second one.
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { args, check, launch, passage, savedNotes, until } from './notes-common.mjs';

const { base, id, state } = args();
const { browser, page } = await launch();
try {
	await page.goto(`${base}/item/${id}`);
	await page.waitForSelector('#margin');
	await page.waitForLoadState('networkidle');
	const quotes = [];
	for (const [selector, text] of [
		['#opening', 'Keep the first one.'],
		['#not-checked', 'Rewrite this one.']
	]) {
		const sentence = await page.evaluate(([s, k]) => (document.querySelector(s).textContent.trim().match(/[^.]*\./g)[k]).trim(), selector === '#opening' ? ['#opening p:nth-of-type(2)', 0] : ['#not-checked', 1]);
		console.error('selecting', selector, JSON.stringify(sentence));
		await page.locator(selector).first().scrollIntoViewIfNeeded();
		const at = await passage(page, selector, sentence);
		await page.mouse.move(at.start.x, at.start.y);
		await page.mouse.down();
		await page.mouse.move(at.end.x, at.end.y, { steps: 8 });
		await page.mouse.up();
		const draft = page.locator('#margin .note.pending');
		await draft.waitFor();
		await draft.getByRole('button', { name: /Add note/ }).click();
		await page.keyboard.type(text);
		quotes.push(sentence);
	}
	await until(async () => (await savedNotes(state, id)).filter((n) => n.text).length === 2, 'both notes saved');
	await page.getByRole('button', { name: /^Send back with 2 notes/ }).click();
	await until(() => access(join(state, 'items', id, 'decision.json')).then(() => true), 'decision.json');
	check(true, 'the send-back with two notes was stored');
	console.log(JSON.stringify(quotes));
} finally {
	await browser.close();
}
