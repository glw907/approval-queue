// Shared by the CT note scripts (notes-mouse.mjs, notes-keyboard.mjs, notes-resend.mjs): launches
// Chromium through Playwright and holds the page helpers. Environment: PLAYWRIGHT_CORE (the
// playwright-core directory) and CHROMIUM (the browser executable) override the workstation's paths.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const home = process.env.HOME ?? '';
const core = process.env.PLAYWRIGHT_CORE ?? `${home}/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`;
const executablePath = process.env.CHROMIUM ?? `${home}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`;
const { chromium } = createRequire(import.meta.url)(core);

/** Reads `<base> <item id> <state dir>` from argv; the state dir is the one that holds `items/`. */
export function args() {
	const [base, id, state] = process.argv.slice(2);
	if (!base || !id || !state) {
		console.error('usage: <script> <base url> <item id> <state dir holding items/>');
		process.exit(2);
	}
	return { base: base.replace(/\/$/, ''), id, state };
}

export async function launch(extra = []) {
	const browser = await chromium.launch({ executablePath, args: extra });
	const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
	page.on('pageerror', (e) => fail(`page error: ${e.message}`));
	return { browser, page };
}

export function fail(message) {
	console.error(`FAIL: ${message}`);
	process.exitCode = 1;
	throw new Error(message);
}

export function check(ok, message) {
	if (!ok) fail(message);
	console.log(`ok: ${message}`);
}

/** The notes the app saved for an item. */
export async function savedNotes(state, id) {
	return JSON.parse(await readFile(join(state, 'items', id, 'notes.json'), 'utf8'));
}

/** Polls `fn` for up to 15 seconds. */
export async function until(fn, what) {
	for (let i = 0; i < 75; i++) {
		const value = await fn().catch(() => undefined);
		if (value) return value;
		await new Promise((r) => setTimeout(r, 200));
	}
	return fail(`timed out waiting for ${what}`);
}

/**
 * Page-side: the client rects of the first occurrence of `text` inside `selector`, as
 * `{ start: {x, y}, end: {x, y}, top }` (the start and end points of its first and last line).
 */
export function passage(page, selector, text) {
	return page.evaluate(
		({ selector, text }) => {
			const root = document.querySelector(selector);
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			const nodes = [];
			let all = '';
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				nodes.push({ n, at: all.length });
				all += n.nodeValue;
			}
			const from = all.indexOf(text);
			if (from < 0) return null;
			const at = (offset) => {
				const hit = [...nodes].reverse().find((e) => e.at <= offset);
				return [hit.n, offset - hit.at];
			};
			const range = document.createRange();
			range.setStart(...at(from));
			range.setEnd(...at(from + text.length));
			const rects = [...range.getClientRects()].filter((r) => r.width > 0);
			const first = rects[0];
			const last = rects[rects.length - 1];
			return { start: { x: first.left + 1, y: first.top + first.height / 2 }, end: { x: last.right - 1, y: last.top + last.height / 2 }, top: first.top };
		},
		{ selector, text }
	);
}

/** The first sentence of the opening, as the page renders it. */
export function firstSentence(page) {
	return page.evaluate(() => /^[^.]*\./.exec(document.querySelector('#opening p').textContent)[0]);
}

/** The cards of the margin: `{ key, top, quote, value, lost }`. */
export function cards(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('#margin .notelist > li')].map((li) => ({
			key: li.dataset.key,
			top: li.getBoundingClientRect().top,
			quote: li.querySelector('q')?.textContent ?? '',
			value: li.querySelector('textarea')?.value ?? li.querySelector('.said')?.textContent ?? '',
			lost: li.textContent.includes('This passage changed'),
			reply: li.querySelector('.reply')?.textContent ?? ''
		}))
	);
}

/** How many ranges the page's note highlight holds. */
export const highlighted = (page) => page.evaluate(() => CSS.highlights.get('note')?.size ?? 0);

/** Opens the first claim and returns the page-side text of its first added line. */
export async function openClaim(page, viaKeyboard = false) {
	const summary = page.locator('#claim-0 > summary');
	if (viaKeyboard) {
		await tabTo(page, () => document.activeElement === document.querySelector('#claim-0 > summary'), 'the first claim');
		await page.keyboard.press('Enter');
	} else await summary.click();
	await page.waitForSelector('#claim-0 tr.add .cd');
	return page.locator('#claim-0 tr.add .cd').first().textContent();
}

/** Presses Tab until `test` (run in the page) holds for the focused element, at most `max` times. */
export async function tabTo(page, test, what, max = 400) {
	for (let i = 0; i < max; i++) {
		await page.keyboard.press('Tab');
		if (await page.evaluate(test)) return i + 1;
	}
	return fail(`Tab never reached ${what}`);
}
