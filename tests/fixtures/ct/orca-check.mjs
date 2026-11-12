// CT step 8: drives a headed Chromium with accessibility on, so Orca (run muted with a debug log) announces
// what takes focus: the "Add note" button, a call's options as radio buttons, and the decision bar's two
// buttons with their note counts. Usage: node orca-check.mjs <item url>
// Environment: PLAYWRIGHT_CORE and CHROMIUM override the workstation's paths, as in notes-common.mjs.
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passage } from './notes-common.mjs';

const home = process.env.HOME ?? '';
const core = process.env.PLAYWRIGHT_CORE ?? `${home}/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`;
const executablePath = process.env.CHROMIUM ?? `${home}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`;
const { chromium } = createRequire(import.meta.url)(core);
const url = process.argv[2];
if (!url) {
	console.error('usage: orca-check.mjs <item url>');
	process.exit(2);
}

const profile = await mkdtemp(join(tmpdir(), 'aq-orca-'));
const context = await chromium.launchPersistentContext(profile, {
	executablePath,
	headless: false,
	viewport: { width: 1280, height: 900 },
	args: ['--force-renderer-accessibility']
});
const page = context.pages()[0] ?? (await context.newPage());
const wait = (ms = 1500) => page.waitForTimeout(ms);
try {
	await page.goto(url);
	await page.waitForSelector('#margin');
	await page.waitForLoadState('networkidle');
	await page.bringToFront();
	await wait(2000);

	// A selection makes the draft card; focus its button.
	const sentence = await page.evaluate(() => /^[^.]*\./.exec(document.querySelector('#opening p').textContent)[0]);
	const at = await passage(page, '#opening', sentence);
	await page.mouse.move(at.start.x, at.start.y);
	await page.mouse.down();
	await page.mouse.move(at.end.x, at.end.y, { steps: 8 });
	await page.mouse.up();
	await page.locator('#margin .note.pending').waitFor();
	await page.getByRole('button', { name: /Add note/ }).focus();
	await wait();
	await page.keyboard.press('Escape');

	// A call's options, as radio buttons.
	const radios = page.locator('.call input[type=radio]');
	await radios.nth(0).focus();
	await wait();
	await page.keyboard.press('ArrowDown');
	await wait();

	// The decision bar's two buttons.
	await page.getByRole('button', { name: /^Send back/ }).focus();
	await wait();
	await page.getByRole('button', { name: /^(Approve|Answer and resume)/ }).focus();
	await wait();
	console.log('orca-check: done');
} finally {
	await context.close();
}
