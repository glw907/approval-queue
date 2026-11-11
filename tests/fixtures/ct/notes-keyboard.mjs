// CT step 9 (the notes part): the notes flow from the keyboard alone. Tab reaches each control, `n`
// starts a note from a selection made with Shift and the arrow keys, Escape clears a draft, and a
// note's delete is a button. A selection needs a caret to grow from, which a keyboard user gets from
// caret browsing (F7) or a screen reader's cursor; the script turns caret browsing on (a launch flag) and places one with the Selection API, then
// presses the real keys. Usage: node notes-keyboard.mjs <base url> <item id> <state dir holding items/>
import { args, cards, check, firstSentence, highlighted, launch, openClaim, passage, savedNotes, tabTo, until } from './notes-common.mjs';

const { base, id, state } = args();
const { browser, page } = await launch(['--enable-caret-browsing']);

/** Places the caret at the start of `text` inside `selector`, then Shift+ArrowRight over all of it. */
async function selectWithKeys(selector, text, length = text.length) {
	await page.evaluate(
		({ selector, text }) => {
			const root = document.querySelector(selector);
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				const at = n.nodeValue.indexOf(text);
				if (at >= 0) {
					n.parentElement.scrollIntoView({ block: 'center' });
					document.activeElement?.blur();
					getSelection().collapse(n, at);
					return;
				}
			}
			throw new Error(`no ${text}`);
		},
		{ selector, text }
	);
	await page.keyboard.down('Shift');
	for (let i = 0; i < length; i++) await page.keyboard.press('ArrowRight');
	await page.keyboard.up('Shift');
}

const typed = async (text) => {
	await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
	await page.keyboard.type(text);
};

try {
	await page.goto(`${base}/item/${id}`);
	await page.waitForSelector('#margin');

	// A sentence, selected with Shift+Arrow; Tab reaches the draft's button; Enter starts the note.
	const sentence = await firstSentence(page);
	await selectWithKeys('#opening', sentence);
	const draft = page.locator('#margin .note.pending');
	await draft.waitFor();
	check((await draft.locator('q').textContent()).startsWith(sentence.slice(0, 40)), 'Shift+Arrow makes a draft card that quotes the sentence');
	const tabs = await tabTo(page, () => document.activeElement?.matches('#margin .note.pending button'), 'the "Add note" button');
	check(true, `Tab reaches the "Add note" button (after ${tabs} presses) and the draft is still there`);
	check(await page.evaluate(() => document.activeElement.textContent.includes('Add note')), 'the button is named "Add note"');
	await page.keyboard.press('Enter');
	await typed('Say what the queue does next.');
	check(/^Note on: You are asked/.test(await page.evaluate(() => document.activeElement.getAttribute('aria-label'))), 'the note textarea is labelled with its quote');

	// A diff line, selected the same way and started with n.
	const line = (await openClaim(page, true)).trim();
	await selectWithKeys('#claim-0 tr.add .cd', line.slice(0, 12), line.length);
	await draft.waitFor();
	await page.keyboard.press('n');
	await typed('Why this line?');

	// Escape clears a draft, and the selection with it.
	await selectWithKeys('#opening', sentence, 12);
	await draft.waitFor();
	await page.keyboard.press('Escape');
	await draft.waitFor({ state: 'detached' });
	check(await page.evaluate(() => getSelection().isCollapsed), 'Escape removes the draft and clears the selection');

	// A note on the whole packet, started from its button, then deleted with its button.
	await page.keyboard.press('Shift+Tab');
	await tabTo(page, () => document.activeElement?.textContent.trim() === 'Note on the whole packet', 'the whole-packet button');
	await page.keyboard.press('Enter');
	await typed('A word about all of it.');
	check((await cards(page)).length === 3, 'three notes stand');
	await page.keyboard.press('Shift+Tab');
	check(await page.evaluate(() => document.activeElement?.matches('#margin .notelist .btn')), 'Shift+Tab from a note reaches its delete button');
	await page.keyboard.press('Enter');
	check((await cards(page)).length === 2, 'Enter on the delete button removes the note');

	await until(async () => (await savedNotes(state, id)).filter((n) => n.text).length === 2, 'both notes saved');
	const bar = await page.locator('#decision').textContent();
	check(bar.includes('2 notes') && bar.includes('Send back with 2 notes'), 'the decision bar counts the notes');

	await page.reload();
	await page.waitForSelector('#margin .notelist li');
	const list = await cards(page);
	check(list.length === 2 && list.every((c) => c.value), 'both notes are in the margin after a reload');
	const proseAt = await passage(page, '#opening', sentence);
	const prose = list.find((c) => c.value.startsWith('Say what'));
	check(Math.abs(prose.top - proseAt.top) < 40, 'the prose note sits beside its sentence');
	const rowTop = await page.locator('#claim-0 tr.add').first().evaluate((el) => el.getBoundingClientRect().top);
	const diff = list.find((c) => c.value.startsWith('Why this'));
	check(Math.abs(diff.top - rowTop) < 40, 'the diff note sits beside its line');
	check((await highlighted(page)) === 2, 'both passages are highlighted');
	console.log('notes-keyboard: ok');
} finally {
	await browser.close();
}
