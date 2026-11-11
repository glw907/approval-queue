// CT steps 3 and 4 (the note part): select a sentence in the opening and a line of a claim's diff
// with the mouse, write a note on each, reload, and find both notes in the margin beside their
// passages. Usage: node notes-mouse.mjs <base url> <item id> <state dir holding items/>
import { args, cards, check, firstSentence, highlighted, launch, openClaim, passage, savedNotes, until } from './notes-common.mjs';

const { base, id, state } = args();
const { browser, page } = await launch();
try {
	await page.goto(`${base}/item/${id}`);
	await page.waitForSelector('#margin');
	check((await page.locator('#margin .hint').textContent()).startsWith('Select any text, including a line of a diff.'), 'the margin hint shows');
	check(await page.getByRole('button', { name: 'Note on the whole packet' }).isVisible(), 'the whole-packet button shows');

	// A sentence of the opening, dragged out with the mouse.
	const sentence = await firstSentence(page);
	const at = await passage(page, '#opening', sentence);
	await page.mouse.move(at.start.x, at.start.y);
	await page.mouse.down();
	await page.mouse.move(at.end.x, at.end.y, { steps: 8 });
	await page.mouse.up();
	const draft = page.locator('#margin .note.pending');
	await draft.waitFor();
	check((await draft.locator('q').textContent()).startsWith(sentence.slice(0, 40)), 'a draft card quotes the selected sentence');
	const draftTop = await draft.evaluate((el) => el.getBoundingClientRect().top);
	check(Math.abs(draftTop - at.top) < 40, `the draft sits level with the selection (${Math.round(draftTop)} against ${Math.round(at.top)})`);
	await draft.getByRole('button', { name: /Add note/ }).click();
	await page.keyboard.type('Say what the queue does next.');
	check(await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'), 'the new note takes focus');

	// A line of a claim's diff, picked with a triple click.
	const line = await openClaim(page);
	await page.locator('#claim-0 tr.add .cd').first().click({ clickCount: 3 });
	await draft.waitFor();
	check((await draft.locator('q').textContent()).trim() === line.trim().replace(/\s+/g, ' '), 'a draft card quotes the selected diff line');
	await draft.getByRole('button', { name: /Add note/ }).click();
	await page.keyboard.type('Why this line?');

	await until(async () => (await savedNotes(state, id)).filter((n) => n.text).length === 2, 'both notes saved');
	const saved = await savedNotes(state, id);
	check(saved.some((n) => n.anchor?.section === 'opening' && n.anchor.quote === sentence), 'the prose note is anchored to the sentence');
	check(saved.some((n) => n.anchor?.file && n.anchor.line > 0 && n.anchor.pr.includes('#')), 'the diff note is anchored to the line');

	// Reload: both notes come back beside their passages.
	await page.reload();
	await page.waitForSelector('#margin .notelist li');
	const list = await cards(page);
	check(list.length === 2 && list.every((c) => c.value), 'both notes are in the margin after a reload');
	const prose = list.find((c) => c.value.startsWith('Say what'));
	const diff = list.find((c) => c.value.startsWith('Why this'));
	const proseAt = await passage(page, '#opening', sentence);
	check(Math.abs(prose.top - proseAt.top) < 40, `the prose note sits beside its sentence (${Math.round(prose.top)} against ${Math.round(proseAt.top)})`);
	const rowTop = await page.locator('#claim-0 tr.add').first().evaluate((el) => el.getBoundingClientRect().top);
	check(Math.abs(diff.top - rowTop) < 40, `the diff note sits beside its line (${Math.round(diff.top)} against ${Math.round(rowTop)})`);
	check((await highlighted(page)) === 2, 'both passages are highlighted');
	if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
	console.log('notes-mouse: ok');
} finally {
	await browser.close();
}
