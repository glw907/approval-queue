// CT step 8, fallback: when Orca hears no focus events from the browser (a Wayland window that took no
// focus), this reads the roles and names Chromium exposes for the same controls: the "Add note" button, a
// call's options as radio buttons, and the decision bar's two buttons with their note counts.
// Usage: node aria-check.mjs <item url>
import { check, launch, passage } from './notes-common.mjs';

const url = process.argv[2];
if (!url) {
	console.error('usage: aria-check.mjs <item url>');
	process.exit(2);
}
const { browser, page } = await launch();
try {
	await page.goto(url);
	await page.waitForSelector('#margin');
	await page.waitForLoadState('networkidle');
	const sentence = await page.evaluate(() => /^[^.]*\./.exec(document.querySelector('#opening p').textContent)[0]);
	const at = await passage(page, '#opening', sentence);
	await page.mouse.move(at.start.x, at.start.y);
	await page.mouse.down();
	await page.mouse.move(at.end.x, at.end.y, { steps: 8 });
	await page.mouse.up();
	await page.locator('#margin .note.pending').waitFor();
	const add = page.getByRole('button', { name: /Add note/ });
	check((await add.count()) === 1, 'the draft card holds one button with the role button and the name "Add note"');
	const radios = page.locator('.call').first().getByRole('radio');
	const names = await radios.evaluateAll((els) => els.map((e) => e.closest('label')?.textContent.trim().replace(/\s+/g, ' ')));
	check((await radios.count()) >= 2, `a call's options are radio buttons (${names.map((n) => `"${n}"`).join(', ')})`);
	check((await radios.first().isChecked()) === true, 'the session\'s pick is checked');
	const send = await page.getByRole('button', { name: /^Send back/ }).textContent();
	const approve = await page.getByRole('button', { name: /^(Approve|Answer and resume)/ }).textContent();
	check(/Send back/.test(send) && /^(Approve|Answer and resume)/.test(approve.trim()), `the decision bar's buttons are named "${send.trim()}" and "${approve.trim().replace(/\s+/g, ' ')}"`);
	console.log(await page.locator('#margin').ariaSnapshot());
} finally {
	await browser.close();
}
