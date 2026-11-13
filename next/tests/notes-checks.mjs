// The note checks of pass A5.
//
// `node next/tests/notes-checks.mjs` runs seven checks against `next/build`, which
// `npm run build --prefix next` makes; it builds nothing. Each check drives a document page and
// reads the store from disk to see what the page wrote. It prints one `ok:` or `FAIL:` line per
// assertion, screenshots each state to `.playwright-mcp/a5/`, and exits 1 on any failure. The
// server is a child of this script, started and stopped only here.
//
// `node next/tests/notes-checks.mjs mockup <dir>` serves the mockup app installed in <dir>, with
// its seeded notes kept, and takes the returned close packet at 1440 and 390 pixels into
// `.playwright-mcp/a5/mockup/`, for the close's side-by-side read.
//
// Environment: PLAYWRIGHT_CORE and CHROMIUM, as `next/scripts/page-checks.mjs` reads them.
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, seed, serve } from '../scripts/page-checks.mjs';
import { readThreads, writeNote } from '../src/lib/components/notes.server.ts';
import { parse } from '../src/lib/doc/parse.ts';
import { createDocument, readDecisions, readNamed, readRecords, writeNamed } from '../src/lib/store/store.ts';
import { DOC, NOTES } from '../src/lib/strings.ts';

/** The one port the note checks use. */
const PORT = 7957;
/** The one port the mockup mode uses. */
const MOCK_PORT = 7959;
const BASE = `http://127.0.0.1:${PORT}`;
const MOCKUP = fileURLToPath(new URL('../../docs/mockup/', import.meta.url));
const CLI = fileURLToPath(new URL('../cli/index.js', import.meta.url));
const BUILD = fileURLToPath(new URL('../build', import.meta.url));
const SHOTS = fileURLToPath(new URL('../../.playwright-mcp/a5/', import.meta.url));
const ACTION_MS = 5000;
const CHECK_MS = 120_000;
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };

// next/ doesn't install playwright-core, so its types stand as any here.
/** @typedef {any} Browser */
/** @typedef {any} Page */

/** @param {number} ms */
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

let failed = false;

/** @param {boolean} ok @param {string} message */
function check(ok, message) {
	if (!ok) failed = true;
	console.log(`${ok ? 'ok' : 'FAIL'}: ${message}`);
}

/** @type {string} */
let state;
/** @type {string} */
let root;
/** @type {import('node:child_process').ChildProcess | null} */
let server = null;

async function start() {
	server = await serve(
		process.execPath,
		[BUILD],
		{ env: { ...process.env, HOST: '127.0.0.1', PORT: String(PORT), APPROVAL_QUEUE_STATE: state } },
		BASE
	);
}

/** Stops the server and waits for it to exit, so nothing still holds the port. */
async function stop() {
	const child = server;
	server = null;
	if (!child || child.exitCode !== null) return;
	const exited = once(child, 'exit');
	child.kill();
	await exited;
}

/**
 * The fixture for checks 1, 2, 6, and 7: "same phrase" once in the first paragraph and once in
 * the sixth, with four long paragraphs between, so the two sit more than a card's height apart.
 */
const FIXTURE = `---
kind: design
---
# A fixture for the note checks

The first paragraph says the same phrase once, close to its start.

${Array.from(
	{ length: 4 },
	(_, i) =>
		`Paragraph ${i + 2} is filler. It holds enough words to fill three or four lines of the reading column, so the two phrases this document repeats sit well apart on the page, more than one note card's height from each other.`
).join('\n\n')}

The sixth paragraph says the same phrase again, further down.

The seventh paragraph is the one a session quotes when it opens a thread.
`;

const SESSION_QUOTE = 'The seventh paragraph is the one a session quotes when it opens a thread.';

/** Stores a fresh copy of the fixture. */
const fixture = () => createDocument(root, FIXTURE, { kind: 'design', title: 'A fixture for the note checks' }).id;

/**
 * Stores a fresh copy of a mockup document, as the decision checks do.
 *
 * @param {string} name the file name under `docs/mockup/content/` without `.md`
 */
function fresh(name) {
	const source = readFileSync(join(MOCKUP, 'content', `${name}.md`), 'utf8');
	const { doc } = parse(source);
	const id = createDocument(root, source, { kind: doc.kind ?? 'design', title: doc.title }).id;
	if (doc.kind === 'merge') {
		writeNamed(root, id, 'heads.json', doc.prs.map((pr, i) => ({ repo: pr.repo, number: pr.number, head: `head${i}` })));
	}
	return id;
}

/** @param {string} id */
const noteCount = (id) => readRecords(root, id, 'note').length;

/** @param {Browser} browser */
async function newPage(browser, viewport = WIDE) {
	const page = await browser.newPage({ viewport });
	page.setDefaultTimeout(ACTION_MS);
	return page;
}

/** @param {any} locator */
const visible = (locator, ms = ACTION_MS) =>
	locator.first().waitFor({ state: 'visible', timeout: ms }).then(
		() => true,
		() => false
	);

/** Waits for the load, the fonts, and the margin's layout, so a read or a shot sees the settled page. */
async function settle(/** @type {Page} */ page) {
	await page.waitForLoadState('networkidle').catch(() => {});
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	await pause(600);
}

/** @param {Page} page @param {string} id */
async function open(page, id) {
	await page.goto(`${BASE}/d/${id}`);
	await settle(page);
}

/**
 * Screenshots the page at 1440 pixels, then at 390, then sets it back to 1440.
 *
 * @param {Page} page @param {string} name
 */
async function shots(page, name, dir = SHOTS) {
	await page.screenshot({ path: join(dir, `${name}-1440.png`) }).catch(() => {});
	await page.setViewportSize(NARROW);
	await pause(600);
	await page.screenshot({ path: join(dir, `${name}-390.png`) }).catch(() => {});
	await page.setViewportSize(WIDE);
	await pause(600);
}

/** The margin's cards at the wide width. @param {Page} page */
const marginCards = (page) => page.locator('.page-margin .note-card[data-card]');

/**
 * Selects the `nth` occurrence (from 0) of `phrase` in the article, as a reader's drag would, and
 * answers the top of its first line in page coordinates, or null when the article lacks it.
 *
 * @param {Page} page @param {string} phrase @param {number} nth
 */
function select(page, phrase, nth) {
	return page.evaluate(
		(/** @type {[string, number]} */ [phrase, nth]) => {
			const article = document.querySelector('article');
			if (!article) return null;
			const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
			let seen = 0;
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				let at = (n.nodeValue ?? '').indexOf(phrase);
				while (at >= 0) {
					if (seen++ === nth) {
						const r = document.createRange();
						r.setStart(n, at);
						r.setEnd(n, at + phrase.length);
						const sel = getSelection();
						sel?.removeAllRanges();
						sel?.addRange(r);
						return r.getBoundingClientRect().top + scrollY;
					}
					at = (n.nodeValue ?? '').indexOf(phrase, at + 1);
				}
			}
			return null;
		},
		[phrase, nth]
	);
}

/** The page-coordinate top of each occurrence of `phrase` in the article. @param {Page} page @param {string} phrase */
function tops(page, phrase) {
	return page.evaluate((/** @type {string} */ phrase) => {
		const article = document.querySelector('article');
		/** @type {number[]} */
		const found = [];
		if (!article) return found;
		const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			let at = (n.nodeValue ?? '').indexOf(phrase);
			while (at >= 0) {
				const r = document.createRange();
				r.setStart(n, at);
				r.setEnd(n, at + phrase.length);
				found.push(r.getBoundingClientRect().top + scrollY);
				at = (n.nodeValue ?? '').indexOf(phrase, at + 1);
			}
		}
		return found;
	}, phrase);
}

/** The text and page-coordinate top of every range in the `note` highlight. @param {Page} page */
function highlighted(page) {
	return page.evaluate(() => {
		const h = 'highlights' in CSS ? CSS.highlights.get('note') : undefined;
		if (!h) return [];
		return [.../** @type {Iterable<AbstractRange>} */ (h)].map((r) => {
			const range = /** @type {Range} */ (r);
			return { text: range.toString(), top: range.getBoundingClientRect().top + scrollY };
		});
	});
}

/** The page-coordinate top of a locator's first element, or null. @param {any} locator */
async function topOf(locator) {
	if (!(await visible(locator, 1000))) return null;
	return locator.first().evaluate((/** @type {Element} */ el) => el.getBoundingClientRect().top + scrollY);
}

/**
 * Writes a note from the page: selects the `nth` "same phrase", opens the box, types, and saves.
 * Answers false, with a failed check, at the first step the page doesn't offer.
 *
 * @param {Page} page @param {string} label @param {number} nth @param {string} text
 */
async function writeFromPage(page, label, nth, text, save = true) {
	const top = await select(page, 'same phrase', nth);
	check(top !== null, `${label}: the article holds occurrence ${nth + 1} of "same phrase"`);
	const add = page.getByRole('button', { name: NOTES.addNote });
	const offered = await visible(add);
	check(offered, `${label}: selecting the words offers "${NOTES.addNote}"`);
	if (!offered) return false;
	await add.first().click();
	const box = page.getByLabel(NOTES.draftLabel);
	const boxed = await visible(box);
	check(boxed, `${label}: "${NOTES.addNote}" opens the note box`);
	if (!boxed) return false;
	await box.fill(text);
	if (!save) return true;
	await page.getByRole('button', { name: NOTES.saveNote, exact: true }).click();
	await pause(800);
	return true;
}

/**
 * Runs `reply` as a child with the checks' store, answering its exit code and output.
 *
 * @param {string[]} args @param {string} body the text.md the command reads
 */
function reply(args, body) {
	const file = join(state, `reply-${Date.now()}.md`);
	writeFileSync(file, body);
	const run = spawnSync(process.execPath, [CLI, 'reply', ...args, file], {
		encoding: 'utf8',
		env: { ...process.env, APPROVAL_QUEUE_STATE: state }
	});
	return { code: run.status, out: run.stdout, err: run.stderr };
}

/** The id check 1 writes on and check 2 replies to, then check 7 reads. */
let shared = '';

/** Check 1: a note on the second of two identical phrases is stored and drawn on the second. */
async function check1(/** @type {Browser} */ browser) {
	const id = (shared = fixture());
	const page = await newPage(browser);
	await open(page, id);
	const wrote = await writeFromPage(page, 'check 1', 1, 'Why say it twice?');
	const records = readRecords(root, id, 'note');
	const first = /** @type {any} */ (records[0]?.value);
	check(
		records.length === 1 && first?.op === 'open' && first?.who === 'geoff' && first?.quote === 'same phrase',
		`check 1: note-1.json is ${JSON.stringify(first ?? null)}`
	);
	if (!wrote) return void (await page.close());
	await shots(page, '1-saved');
	await page.reload();
	await settle(page);
	const [one, second] = await tops(page, 'same phrase');
	const card = await topOf(marginCards(page));
	check(card !== null, 'check 1: after a reload, the margin holds the card');
	check(
		card !== null && second !== undefined && Math.abs(card - second) < 24 && Math.abs(card - one) > 100,
		`check 1: the card's top is ${card?.toFixed(0)} px, beside the second phrase at ${second?.toFixed(0)}, away from the first at ${one?.toFixed(0)}`
	);
	const marks = await highlighted(page);
	check(
		marks.length === 1 && marks[0].text === 'same phrase' && Math.abs(marks[0].top - second) < 2,
		`check 1: the highlight covers the second phrase only: ${JSON.stringify(marks.map((/** @type {{ top: number }} */ m) => Math.round(m.top)))}`
	);
	await shots(page, '1-reloaded');
	await page.close();
}

/** Check 2: `reply` adds a labeled entry to a thread, and with no thread opens a labeled one. */
async function check2(/** @type {Browser} */ browser) {
	const id = shared || fixture();
	if (!noteCount(id)) writeNote(root, id, { op: 'open', who: 'geoff', quote: 'same phrase', version: 1, text: 'Why say it twice?', at: new Date().toISOString() });
	const thread = readThreads(root, id).threads[0]?.id ?? 1;
	const one = reply([id, String(thread)], 'Because the fixture needs two.\n');
	check(one.code === 0, `check 2: reply to thread ${thread} exited ${one.code} ${one.err.trim()}`);
	const page = await newPage(browser);
	await open(page, id);
	const replied = marginCards(page).filter({ hasText: 'Because the fixture needs two.' });
	check(await visible(replied), 'check 2: the card shows the session\'s entry after a load');
	const label = replied.locator('.note-who.claude');
	check(
		(await visible(label, 1000)) && (await label.first().textContent())?.trim() === NOTES.claude,
		`check 2: the entry is labeled "${NOTES.claude}"`
	);
	const two = reply([id], `> ${SESSION_QUOTE}\n\nA note from the session on this line.\n`);
	check(two.code === 0, `check 2: reply with a blockquote exited ${two.code} ${two.err.trim()}`);
	await page.reload();
	await settle(page);
	const opened = marginCards(page).filter({ hasText: 'A note from the session on this line.' });
	const shown = await visible(opened);
	check(shown, 'check 2: a new card shows the session\'s thread');
	check(
		shown && (await opened.locator('.note-who.claude').first().textContent().catch(() => ''))?.trim() === NOTES.claude,
		`check 2: the new thread is labeled "${NOTES.claude}"`
	);
	const [passage] = await tops(page, SESSION_QUOTE);
	const card = await topOf(opened);
	// A card can't overlap the one above it, so it sits beside its passage or just below that card.
	const above = await marginCards(page).filter({ hasText: 'Because the fixture needs two.' }).first()
		.evaluate((/** @type {Element} */ el) => el.getBoundingClientRect().bottom + scrollY).catch(() => null);
	check(
		card !== null && passage !== undefined && card >= passage - 24 &&
			(card - passage < 24 || (above !== null && card - above >= 0 && card - above < 16)),
		`check 2: the new card's top is ${card?.toFixed(0)} px, beside its passage at ${passage?.toFixed(0)} or just below the card above, which ends at ${above?.toFixed(0)}`
	);
	await shots(page, '2-replies');
	await page.close();
}

/** Check 3: the returned close packet marks its three changed passages, and the switch hides them. */
async function check3(/** @type {Browser} */ browser, /** @type {string} */ id) {
	const page = await newPage(browser);
	await open(page, id);
	const counts = await page.evaluate(() => {
		const a = document.querySelector('article');
		const h1 = a?.querySelector('h1');
		const firstP = a?.querySelector('.prose-doc p');
		const option = a?.querySelectorAll('fieldset.question')[0];
		return {
			del: a?.querySelectorAll('del').length ?? 0,
			ins: a?.querySelectorAll('ins').length ?? 0,
			title: !!h1?.querySelector('del') && !!h1?.querySelector('ins'),
			para: !!firstP?.querySelector('del') && !!firstP?.querySelector('ins'),
			option: !!option?.querySelector('del') && !!option?.querySelector('ins')
		};
	});
	check(counts.del === 3 && counts.ins === 3, `check 3: the article holds ${counts.del} del and ${counts.ins} ins`);
	check(counts.title && counts.para && counts.option, `check 3: marks in the title, the first paragraph, and question 1's option: ${JSON.stringify(counts)}`);
	await shots(page, '3-marks-on');
	const toggle = page.getByLabel(DOC.showChanges);
	const has = await visible(toggle);
	check(has, `check 3: the banner offers "${DOC.showChanges}"`);
	if (has) await toggle.uncheck();
	await pause(300);
	const off = await page.evaluate(() => {
		const a = document.querySelector('article');
		return {
			off: !!a?.classList.contains('changes-off'),
			delShown: [...(a?.querySelectorAll('del') ?? [])].filter((el) => getComputedStyle(el).display !== 'none').length,
			insHidden: [...(a?.querySelectorAll('ins') ?? [])].filter((el) => getComputedStyle(el).display === 'none').length,
			insTinted: [...(a?.querySelectorAll('ins') ?? [])].filter((el) => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)').length
		};
	});
	check(off.off, 'check 3: unchecking the switch puts changes-off on the article');
	check(off.delShown === 0, `check 3: ${off.delShown} del still shown`);
	check(off.insHidden === 0 && off.insTinted === 0, `check 3: every ins stays visible with no background: ${JSON.stringify(off)}`);
	await shots(page, '3-marks-off');
	await page.close();
}

/**
 * Seeds the returned close packet with the mockup's three threads (`content/seed-notes.json`),
 * the first two opened on the sent version's words, which the returned version changed.
 *
 * @param {string} id
 */
function seedThreads(id) {
	const at = (/** @type {string} */ t) => new Date(t).toISOString();
	writeNote(root, id, { op: 'open', who: 'geoff', quote: 'Two answers needed before workstation #233 and #234 merge', version: 1, text: 'The title counts the questions without saying what they are.', at: at('2026-11-12T09:40') });
	writeNote(root, id, { op: 'reply', thread: 1, who: 'claude', text: 'Retitled so it names both questions.', at: at('2026-11-12T11:52') });
	const t2 = writeNote(root, id, { op: 'open', who: 'geoff', quote: 'because its branch is cut from #233’s', version: 1, text: 'What does "cut from" mean here?', at: at('2026-11-12T09:42') });
	writeNote(root, id, { op: 'reply', thread: t2, who: 'claude', text: 'Reworded. #234 was built on top of #233, so it can’t merge first.', at: at('2026-11-12T11:52') });
	writeNote(root, id, {
		op: 'open',
		who: 'claude',
		quote: 'fix the four rules in round.md as backlog #81',
		version: 2,
		text: 'Why I recommend this over fixing it now: round.md belongs to an earlier pass, and the design you approved for this pass left it alone. Fixing it here would go outside that design.',
		at: at('2026-11-12T11:52')
	});
}

/** Check 4: a thread opened on words the returned version changed shows the words it was made on. */
async function check4(/** @type {Browser} */ browser, /** @type {string} */ id) {
	seedThreads(id);
	const old = 'Two answers needed before workstation #233 and #234 merge';
	const folded = readThreads(root, id).threads[0];
	check(folded?.was === old, `check 4: the fold gives thread 1 was ${JSON.stringify(folded?.was)}`);
	const page = await newPage(browser);
	await open(page, id);
	const card = marginCards(page).filter({ hasText: 'The title counts the questions' });
	const shown = await visible(card);
	check(shown, 'check 4: the margin holds the card on the changed title');
	const text = shown ? ((await card.first().textContent()) ?? '') : '';
	check(text.includes(NOTES.was) && text.includes(old), `check 4: the card shows "${NOTES.was}" and the original words`);
	const wasAt = shown ? text.indexOf(old) : -1;
	check(wasAt >= 0 && wasAt < text.indexOf('The title counts the questions'), 'check 4: the original words sit above the entries');
	const title = await topOf(page.locator('article h1'));
	const cardTop = await topOf(card);
	check(title !== null && cardTop !== null && Math.abs(cardTop - title) < 40, `check 4: the card's top is ${cardTop?.toFixed(0)} px, beside the new title at ${title?.toFixed(0)}`);
	await shots(page, '4-was');
	await page.close();
}

/** Check 5: a send-back with nothing to act on is refused on the page, and records once there is. */
async function check5(/** @type {Browser} */ browser) {
	const id = fresh('20-survey-edit');
	const page = await newPage(browser);
	await open(page, id);
	const decide = page.locator('section.decide');
	const sendBack = decide.getByRole('button', { name: DOC.sendBack });
	check((await sendBack.getAttribute('aria-disabled').catch(() => null)) === 'true', 'check 5: Send back is aria-disabled with no note and every pick recommended');
	// A reader can click a button marked aria-disabled, so the click skips Playwright's enabled wait.
	await sendBack.click({ force: true }).catch(() => {});
	check(await visible(decide.getByText(DOC.nothingToSendBack)), 'check 5: a click shows nothingToSendBack');
	await pause(500);
	check(readDecisions(root, id).length === 0, `check 5: ${readDecisions(root, id).length} decision records after the click`);
	await shots(page, '5-refused');
	const off = page.locator('fieldset.question').first().locator('input[type=radio]').nth(1);
	await off.check();
	for (let i = 0; i < 30 && !readNamed(root, id, 'answers.json'); i++) await pause(100);
	check((await sendBack.getAttribute('aria-disabled').catch(() => 'true')) !== 'true', 'check 5: with one answer moved, Send back is enabled');
	await sendBack.click();
	await visible(page.getByText(DOC.recorded));
	check(readDecisions(root, id).at(-1)?.action === 'sendback', 'check 5: with one answer moved, the send-back is on disk');
	await page.close();

	const noted = fresh('20-survey-edit');
	writeNote(root, noted, { op: 'open', who: 'geoff', quote: 'Keep the edit', version: 1, text: 'Which two passages?', at: new Date().toISOString() });
	const second = await newPage(browser);
	await open(second, noted);
	const line = second.locator('section.decide').getByText(DOC.notesWaiting(1));
	check(await visible(line), `check 5: the line under Send back reads "${DOC.notesWaiting(1)}"`);
	const button = second.locator('section.decide').getByRole('button', { name: DOC.sendBack });
	await button.click();
	await visible(second.getByText(DOC.recorded));
	check(readDecisions(root, noted).at(-1)?.action === 'sendback', 'check 5: with one note waiting, the send-back is on disk');
	await second.close();
}

/** Check 6: a note over 4,000 characters shows its count in the box and isn't saved. */
async function check6(/** @type {Browser} */ browser) {
	const id = fixture();
	const page = await newPage(browser);
	await open(page, id);
	const typed = await writeFromPage(page, 'check 6', 0, 'x'.repeat(4001), false);
	check(typed && (await visible(page.getByText(NOTES.tooLong(4001)))), `check 6: the box shows "${NOTES.tooLong(4001)}"`);
	await page.getByRole('button', { name: NOTES.saveNote, exact: true }).click({ timeout: 1000 }).catch(() => {});
	await pause(800);
	check(noteCount(id) === 0, `check 6: ${noteCount(id)} note records after a save of 4,001 characters`);
	await shots(page, '6-too-long');
	await page.close();
}

/** Check 7: at 390 pixels the sheet opens and holds the same cards as the wide margin. */
async function check7(/** @type {Browser} */ browser, /** @type {string} */ id) {
	const wide = await newPage(browser);
	await open(wide, id);
	/** @param {any} cards */
	const texts = async (cards) => (await cards.locator('.note-entry').allTextContents()).map((/** @type {string} */ t) => t.replace(/\s+/g, ' ').trim());
	const inMargin = await texts(marginCards(wide));
	await wide.close();
	const n = readThreads(root, id).threads.filter((t) => !t.resolved).length;
	check(n > 0 && inMargin.length > 0, `check 7: the wide margin holds ${inMargin.length} entries across ${n} open threads`);
	const page = await newPage(browser, NARROW);
	await open(page, id);
	const opener = page.getByRole('button', { name: NOTES.open(n) });
	const has = await visible(opener);
	check(has, `check 7: at 390 pixels the page offers "${NOTES.open(n)}"`);
	if (has) await opener.click();
	const sheet = page.locator('dialog[open]');
	check(await visible(sheet), 'check 7: the button opens the sheet');
	const inSheet = await texts(sheet.locator('.note-card[data-card]'));
	check(inSheet.length > 0 && JSON.stringify(inSheet) === JSON.stringify(inMargin), `check 7: the sheet holds the margin's ${inMargin.length} entries`);
	await pause(600);
	await page.screenshot({ path: join(SHOTS, '7-sheet-390.png') }).catch(() => {});
	await page.close();
}

/** Takes the returned close packet, with its threads, at both widths, the sheet open at 390. */
async function shootPacket(/** @type {Browser} */ browser, /** @type {string} */ base, /** @type {string} */ path, /** @type {string} */ dir) {
	mkdirSync(dir, { recursive: true });
	const page = await newPage(browser);
	await page.goto(base + path);
	await settle(page);
	await page.screenshot({ path: join(dir, 'packet-1440.png'), fullPage: true }).catch(() => {});
	await page.setViewportSize(NARROW);
	await page.goto(base + path);
	await settle(page);
	await page.screenshot({ path: join(dir, 'packet-390.png'), fullPage: true }).catch(() => {});
	const opener = page.locator('.page-main button.btn-sm').first();
	if (await visible(opener, 2000)) {
		await opener.click();
		await pause(600);
		await page.screenshot({ path: join(dir, 'packet-390-sheet.png') }).catch(() => {});
	}
	await page.close();
}

async function run(/** @type {string} */ label, /** @type {() => Promise<void>} */ body) {
	try {
		await Promise.race([
			body(),
			pause(CHECK_MS).then(() => {
				throw new Error(`the check didn't finish within ${CHECK_MS / 1000} seconds`);
			})
		]);
	} catch (err) {
		check(false, `${label}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
	} finally {
		if (!server) await start().catch((err) => check(false, `${label}: the server didn't restart: ${err}`));
	}
}

async function checkApp() {
	mkdirSync(SHOTS, { recursive: true });
	const scratch = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, 'tmp') : tmpdir();
	state = mkdtempSync(join(scratch, 'aq-notes-checks-'));
	/** @type {Browser} */
	let browser;
	try {
		const seeded = await seed(state);
		root = seeded.root;
		const packet = seeded.ids['20-survey-edit'];
		await start();
		browser = await chromium();
		await run('check 1', () => check1(browser));
		await run('check 2', () => check2(browser));
		await run('check 3', () => check3(browser, packet));
		await run('check 4', () => check4(browser, packet));
		await run('check 5', () => check5(browser));
		await run('check 6', () => check6(browser));
		await run('check 7', () => check7(browser, shared || packet));
		await shootPacket(browser, BASE, `/d/${packet}`, join(SHOTS, 'app'));
	} finally {
		await browser?.close();
		await stop();
		rmSync(state, { recursive: true, force: true });
	}
}

/** @param {string} dir the mockup app, installed, its `seed-notes.json` kept */
async function shootMockup(dir) {
	const base = `http://127.0.0.1:${MOCK_PORT}`;
	const vite = join(dir, 'node_modules', '.bin', 'vite');
	let child;
	/** @type {Browser} */
	let browser;
	try {
		child = await serve(vite, ['dev', '--host', '127.0.0.1', '--port', String(MOCK_PORT), '--strictPort'], { cwd: dir }, base);
		browser = await chromium();
		// vite dev optimizes its dependencies on the first hit to a page and reloads, so the page is
		// loaded once and thrown away before any shot.
		const warm = await browser.newPage();
		await warm.goto(`${base}/d/20-survey-edit`);
		await settle(warm);
		await warm.close();
		await shootPacket(browser, base, '/d/20-survey-edit', join(SHOTS, 'mockup'));
		console.log('ok: mockup: the returned close packet at 1440 and 390 pixels in .playwright-mcp/a5/mockup/');
	} finally {
		await browser?.close();
		child?.kill();
	}
}

const [mode, dir] = process.argv.slice(2);
if (mode === 'mockup') {
	if (!dir) throw new Error('usage: notes-checks.mjs mockup <dir>');
	await shootMockup(dir);
} else {
	await checkApp();
}
process.exit(failed ? 1 : 0);
