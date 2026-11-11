// CT step 6 (the page part): a resend shows the notes of the item it revises beside their passages,
// each answered note with its reply in place, a note whose quote no longer occurs with "This passage
// changed", and the paragraphs of text.md that changed marked. The item must carry `revises` and the
// earlier item must hold notes.json, replies.json, and text.md.
// Usage: node notes-resend.mjs <base url> <resend item id> <state dir holding items/>
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { args, cards, check, launch } from './notes-common.mjs';

const { base, id, state } = args();
const json = async (item, file) => JSON.parse(await readFile(join(state, 'items', item, file), 'utf8'));
const earlierId = (await json(id, 'item.json')).revises.item;
const notes = await json(earlierId, 'notes.json');
const replies = await json(earlierId, 'replies.json');

const { browser, page } = await launch();
try {
	await page.goto(`${base}/item/${id}`);
	await page.waitForSelector('#margin .notelist li');
	// The margin places its cards on the next frame; wait for that.
	await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
	const list = await cards(page);
	check(list.length === notes.length, `the margin carries the ${notes.length} earlier notes`);

	const text = await page.locator('#packet-body').evaluate((el) => el.textContent);
	let lost = 0;
	let answered = 0;
	for (const note of notes) {
		const card = list.find((c) => c.key === `earlier-${note.id}`);
		check(card !== undefined && card.value === note.text, `the note ${note.id} shows its text, read-only`);
		const reply = replies.find((r) => r.note === note.id);
		if (reply) {
			check(card.reply.includes(reply.text), `the note ${note.id} shows its reply in place`);
			answered++;
		}
		if (note.anchor && 'quote' in note.anchor) {
			const gone = !text.includes(note.anchor.quote);
			check(card.lost === gone, `the note ${note.id} ${gone ? 'says "This passage changed"' : 'is placed on its passage'}`);
			check(card.quote.replace(/…$/, '') === note.anchor.quote.slice(0, 96).replace(/\s+/g, ' ') || card.quote.startsWith(note.anchor.quote.slice(0, 90)), `the note ${note.id} keeps its original quote`);
			if (gone) lost++;
		}
	}
	check(answered > 0, 'at least one note is answered in place');
	check(lost > 0, 'at least one note says "This passage changed"');
	const changed = await page.locator('.packet-body .changed-para').count();
	check(changed > 0, `${changed} paragraph(s) of the resend are marked changed`);
	console.log('notes-resend: ok');
} finally {
	await browser.close();
}
