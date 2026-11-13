// The decision checks of pass A4.
//
// `node approval-queue/tests/decide-checks.mjs` runs seven checks against `approval-queue/build`, which
// `npm run build --prefix approval-queue` makes; it builds nothing. Each check clicks a decision on a
// document page and reads the store from disk to see what the click recorded. It prints one `ok:`
// or `FAIL:` line per assertion, screenshots each state to `.playwright-mcp/a4/`, and exits 1 on
// any failure. The server is a child of this script, started and stopped only here.
//
// Environment: PLAYWRIGHT_CORE and CHROMIUM, as `approval-queue/scripts/page-checks.mjs` reads them.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, seed, serve } from '../scripts/page-checks.mjs';
import { parse } from '../src/lib/doc/parse.ts';
import { createDocument, readDecisions, readNamed, writeDecision, writeNamed } from '../src/lib/store/store.ts';
import { DOC, FRONT, LAYOUT } from '../src/lib/strings.ts';

/** The one port the decision checks use. */
const PORT = 7955;
const BASE = `http://127.0.0.1:${PORT}`;
const MOCKUP = fileURLToPath(new URL('../../docs/mockup/', import.meta.url));
const CLI = fileURLToPath(new URL('../cli/index.js', import.meta.url));
const BUILD = fileURLToPath(new URL('../build', import.meta.url));
const SHOTS = fileURLToPath(new URL('../../.playwright-mcp/a4/', import.meta.url));
const ACTION_MS = 5000;
/** The longest one check may run; check 2 waits 20 seconds and check 4 about 25 by design. */
const CHECK_MS = 120_000;

// approval-queue/ doesn't install playwright-core, so its types stand as any here.
/** @typedef {any} Browser */
/** @typedef {any} Page */
/** @typedef {any} Route */

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
 * Stores a fresh copy of a mockup document, so each check starts on a waiting document of its own.
 * A merge document gets the `heads.json` that `send` would have written.
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
const records = (id) => readDecisions(root, id);

/** @param {Browser} browser */
async function newPage(browser) {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	page.setDefaultTimeout(ACTION_MS);
	return page;
}

/** @param {Page} page @param {string} name */
async function shot(page, name) {
	await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false }).catch(() => {});
}

/** @param {Page} page */
const decide = (page) => page.locator('section.decide');
/** @param {Page} page */
const approveButton = (page) => decide(page).getByRole('button', { name: new RegExp(`^${DOC.approve}`) });
/** @param {Page} page */
const undoButton = (page) => decide(page).getByRole('button', { name: DOC.undoApprove });
/** @param {Page} page */
const tryAgain = (page) => page.getByRole('button', { name: DOC.tryAgain });
/** @param {Page} page */
const alertBlock = (page) => page.locator('[role=alert]');

/** @param {any} locator */
const visible = (locator, ms = ACTION_MS) =>
	locator.first().waitFor({ state: 'visible', timeout: ms }).then(
		() => true,
		() => false
	);

/** @param {Page} page @param {string} id */
async function open(page, id) {
	await page.goto(`${BASE}/d/${id}`);
	await page.waitForLoadState('networkidle').catch(() => {});
}

/**
 * Holds each `POST` to `/api/` until `release` is called, which continues every held request.
 * A `GET` (the page's poll) passes through.
 *
 * @param {Page} page
 */
async function hold(page) {
	/** @type {Route[]} */
	const held = [];
	/** @type {(() => void) | null} */
	let arrived = null;
	const posted = new Promise((done) => (arrived = () => done(undefined)));
	const first = Promise.race([
		posted,
		pause(ACTION_MS).then(() => {
			throw new Error(`no post reached /api/ within ${ACTION_MS / 1000} seconds`);
		})
	]);
	first.catch(() => {});
	await page.route('**/api/**', (/** @type {Route} */ route) => {
		if (route.request().method() !== 'POST') return route.continue();
		held.push(route);
		arrived?.();
	});
	return {
		first,
		release: async () => {
			await page.unroute('**/api/**');
			for (const route of held.splice(0)) await route.continue().catch(() => {});
		}
	};
}

/** Runs one check, turning a throw into a FAIL so the next check still runs. */
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

/** Check 1: the page changes only after the decision is on disk. */
async function check1(/** @type {Browser} */ browser) {
	const id = fresh('40-queue-design');
	const page = await newPage(browser);
	await open(page, id);
	const route = await hold(page);
	await approveButton(page).click();
	await route.first;
	check(await approveButton(page).isVisible(), 'check 1: while the post is held, the Approve button is still drawn');
	check(records(id).length === 0, 'check 1: while the post is held, no decision record exists');
	await shot(page, '1-held');
	let onDisk = null;
	const seen = visible(page.getByText(DOC.recorded)).then((/** @type {boolean} */ ok) => {
		onDisk = records(id).at(0)?.action ?? null;
		return ok;
	});
	await route.release();
	check(await seen, 'check 1: after the release, the decided view appears');
	check(onDisk === 'approve', `check 1: when the decided view appears, decision-1.json holds ${onDisk}`);
	await shot(page, '1-decided');
	await page.close();
}

/** Check 2: a click while the server is down records nothing and says so, and "Try again" records it. */
async function check2(/** @type {Browser} */ browser) {
	const id = fresh('10-merge-gaps');
	const page = await newPage(browser);
	await open(page, id);
	await stop();
	await approveButton(page).click();
	const blocked = await visible(alertBlock(page).getByText(DOC.decisionUnsent));
	check(blocked, 'check 2: with the server down, Approve shows decisionUnsent');
	check(await alertBlock(page).getByText(DOC.queueDown).isVisible(), 'check 2: the block says queueDown');
	check(!(await approveButton(page).isVisible()), 'check 2: the Approve button is gone');
	check(records(id).length === 0, 'check 2: no record exists');
	await shot(page, '2-down');
	await pause(15_000);
	check(await alertBlock(page).getByText(DOC.decisionUnsent).isVisible(), 'check 2: after 15 seconds, the block is still drawn');
	await start();
	await tryAgain(page).click();
	check(await visible(page.getByText(DOC.recorded)), 'check 2: after a restart, Try again shows the decided view');
	check(records(id).length === 1, `check 2: Try again wrote ${records(id).length} record, 1 expected`);

	await stop();
	await pause(5000);
	check(await page.getByText(DOC.recorded).isVisible(), 'check 2: with the server down 5 seconds, the decided document is still drawn');
	await undoButton(page).click();
	check(await visible(alertBlock(page).getByText(DOC.undoUnsent)), 'check 2: Undo with the server down shows undoUnsent');
	check(await alertBlock(page).getByText(DOC.queueDown).isVisible(), 'check 2: the Undo block says queueDown');
	await shot(page, '2-undo-down');
	await start();
	await tryAgain(page).click();
	check(await visible(approveButton(page)), 'check 2: after a restart, Try again undoes it and Approve is back');
	check(records(id).at(-1)?.action === 'undo', 'check 2: the last record is the undo');
	await page.close();
}

/** Check 3: a fetch that fails, an answer lost after the write, and a post past 10 seconds. */
async function check3(/** @type {Browser} */ browser) {
	const lost = fresh('20-survey-edit');
	let page = await newPage(browser);
	await open(page, lost);
	const route = await hold(page);
	await approveButton(page).click();
	await route.first;
	await stop();
	await route.release();
	check(await visible(alertBlock(page).getByText(DOC.decisionUnsent)), 'check 3: a fetch that fails shows decisionUnsent');
	check(records(lost).length === 0, 'check 3: no record exists');
	await start();
	await tryAgain(page).click();
	check(await visible(page.getByText(DOC.recorded)), 'check 3: Try again after a restart records it');
	check(records(lost).length === 1, `check 3: the store holds ${records(lost).length} record, 1 expected`);
	await page.close();

	const lostAnswer = fresh('40-queue-design');
	page = await newPage(browser);
	await open(page, lostAnswer);
	await page.route('**/api/**', async (/** @type {Route} */ r) => {
		if (r.request().method() !== 'POST') return r.continue();
		await r.fetch();
		await r.abort('failed');
	});
	await approveButton(page).click();
	check(await visible(alertBlock(page)), 'check 3: an answer lost after the write shows the not-recorded block');
	check(records(lostAnswer).length === 1, 'check 3: the server wrote decision-1.json before the answer was lost');
	await page.unroute('**/api/**');
	await shot(page, '3-lost-answer');
	await tryAgain(page).click();
	check(await visible(page.getByText(DOC.recorded)), 'check 3: Try again answers 200 and shows the decided view');
	check(records(lostAnswer).length === 1, `check 3: the store still holds ${records(lostAnswer).length} decision record, 1 expected`);
	await page.close();

	const slow = fresh('40-queue-design');
	page = await newPage(browser);
	await open(page, slow);
	await page.route('**/api/**', async (/** @type {Route} */ r) => {
		if (r.request().method() !== 'POST') return r.continue();
		await pause(11_000);
		await r.continue().catch(() => {});
	});
	await approveButton(page).click();
	check(await visible(alertBlock(page).getByText(DOC.tooSlow), 15_000), 'check 3: a post held past 10 seconds shows tooSlow');
	await shot(page, '3-too-slow');
	await page.close();
}

/**
 * Whether the rail's section headed `label` links to document `id`.
 *
 * @param {Page} page @param {string} label @param {string} id
 */
function railHas(page, label, id) {
	return page.evaluate(
		(/** @type {[string, string]} */ [label, id]) =>
			[...document.querySelectorAll('nav.rail section')].some(
				(s) => (s.querySelector('h2')?.textContent ?? '').trim().startsWith(label) && !!s.querySelector(`a[href="/d/${id}"]`)
			),
		[label, id]
	);
}

/** Check 4: Undo returns the document to the rail, and the hand-off shows with no reload. */
async function check4(/** @type {Browser} */ browser) {
	const id = fresh('40-queue-design');
	const page = await newPage(browser);
	await open(page, id);
	await approveButton(page).click();
	await page.getByText(DOC.recorded).waitFor();
	await undoButton(page).click();
	check(await visible(approveButton(page)), 'check 4: Undo brings Approve back');
	const undo = records(id).at(1);
	check(undo?.action === 'undo' && undo?.of === 1, `check 4: decision-2.json is ${JSON.stringify(undo)}`);
	check(await railHas(page, LAYOUT.outstanding, id), 'check 4: the rail lists the document under Outstanding decisions again');

	await approveButton(page).click();
	await page.getByText(DOC.recorded).waitFor();
	check(await page.getByText(DOC.handoffBefore).isVisible(), 'check 4: the decided view shows handoffBefore');
	const began = Date.now();
	const collect = spawn(process.execPath, [CLI, 'collect', id], {
		stdio: ['ignore', 'ignore', 'inherit'],
		env: { ...process.env, APPROVAL_QUEUE_STATE: state }
	});
	const [code] = await Promise.race([once(collect, 'exit'), pause(45_000).then(() => [null])]);
	if (code === null) collect.kill();
	check(code === 0, `check 4: collect exited ${code} after ${Math.round((Date.now() - began) / 1000)} seconds`);
	check(await visible(page.getByText(DOC.handoffAfter)), 'check 4: within 5 seconds, the page shows handoffAfter with no reload');
	check(!(await undoButton(page).isVisible()), 'check 4: no Undo button once handed');
	await shot(page, '4-handed');
	await page.close();
}

/** Check 5: a read report leaves Reports, shows in Decided today, and returns on Mark as unread. */
async function check5(/** @type {Browser} */ browser, /** @type {string} */ id) {
	const page = await newPage(browser);
	await open(page, id);
	await decide(page).getByRole('button', { name: DOC.markRead }).click();
	check(await visible(decide(page).getByRole('button', { name: DOC.markUnread })), 'check 5: Mark as read shows Mark as unread');
	check(records(id).at(-1)?.action === 'read', 'check 5: the store holds the read record');
	check(!(await railHas(page, LAYOUT.reports, id)), 'check 5: the report has left Reports in the rail');
	check(await railHas(page, LAYOUT.decidedToday, id), 'check 5: the report shows in Decided today');
	await shot(page, '5-read');
	await page.goto(BASE);
	const onFront = () =>
		page.evaluate(
			(/** @type {[string, string]} */ [label, id]) =>
				[...document.querySelectorAll('main section')].some(
					(s) => (s.querySelector('h2')?.textContent ?? '').trim() === label && !!s.querySelector(`a[href="/d/${id}"]`)
				),
			[FRONT.reports, id]
		);
	check(!(await onFront()), 'check 5: the front page no longer lists the report under Reports');
	await open(page, id);
	await decide(page).getByRole('button', { name: DOC.markUnread }).click();
	check(await visible(decide(page).getByRole('button', { name: DOC.markRead })), 'check 5: Mark as unread brings Mark as read back');
	check(await railHas(page, LAYOUT.reports, id), 'check 5: the report is back under Reports');
	await page.goto(BASE);
	check(await onFront(), 'check 5: after Mark as unread, the front page lists the report under Reports');
	await page.close();
}

/**
 * Presses Tab until the focused element passes `test`, up to 300 times.
 *
 * @param {Page} page @param {string} test a function body over `el`, the focused element
 */
async function tabTo(page, test) {
	for (let i = 0; i < 300; i++) {
		await page.keyboard.press('Tab');
		const hit = await page.evaluate((/** @type {string} */ body) => {
			const el = document.activeElement;
			return !!el && new Function('el', `return (${body});`)(el);
		}, test);
		if (hit) return true;
	}
	return false;
}

/** Check 6: the whole decision by keyboard, on a document with two or more questions. */
async function check6(/** @type {Browser} */ browser, /** @type {string} */ name) {
	const id = fresh(name);
	const { doc } = parse(readFileSync(join(MOCKUP, 'content', `${name}.md`), 'utf8'));
	const first = /** @type {any} */ (doc.segments.find((s) => s.type === 'question'));
	const page = await newPage(browser);
	await open(page, id);
	const onRadio = await tabTo(page, `el.matches('input[type=radio]:checked')`);
	check(onRadio, 'check 6: Tab reaches the first question\'s chosen answer');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Space');
	await pause(1000);
	const picks = /** @type {Record<string, number> | undefined} */ (readNamed(root, id, 'answers.json'));
	const moved = picks?.[first.id];
	const recommended = first.options.findIndex((/** @type {any} */ o) => o.recommended);
	check(moved !== undefined && moved !== recommended, `check 6: answers.json holds ${first.id}: ${moved}, off the recommended ${recommended}`);
	const onApprove = await tabTo(page, `el.tagName === 'BUTTON' && el.textContent.trim().startsWith(${JSON.stringify(DOC.approve)})`);
	check(onApprove, 'check 6: Tab reaches Approve');
	await page.keyboard.press('Enter');
	await page.getByText(DOC.recorded).waitFor();
	const focused = await page.evaluate(() => {
		const el = document.activeElement;
		return !!el?.closest('section.decide') && !!el.closest('[role=status]');
	});
	check(focused, 'check 6: after the approve, focus is on the decided view');
	check(records(id).at(-1)?.action === 'approve', 'check 6: the approve is on disk');
	await shot(page, '6-decided');
	const onUndo = await tabTo(page, `el.tagName === 'BUTTON' && el.textContent.trim() === ${JSON.stringify(DOC.undoApprove)}`);
	check(onUndo, 'check 6: Tab reaches Undo');
	await page.keyboard.press('Enter');
	check(await visible(approveButton(page)), 'check 6: Enter on Undo brings the document back to waiting');
	const reach = await tabTo(page, `el.tagName === 'BUTTON' && el.textContent.trim().startsWith(${JSON.stringify(DOC.approve)})`);
	check(reach, 'check 6: Approve is reachable by Tab again');
	await page.close();
}

/**
 * Routes each answer post through `handle`, letting every other request pass.
 *
 * @param {Page} page @param {(route: Route) => Promise<void>} handle
 */
async function onAnswer(page, handle) {
	await page.unroute('**/api/**');
	await page.route('**/api/**', (/** @type {Route} */ route) => {
		const body = route.request().postData() ?? '';
		return route.request().method() === 'POST' && body.includes('"op":"answer"') ? handle(route) : route.continue();
	});
}

/** @param {Page} page @param {string} test a function body over `el`, the focused element */
const focusIs = (page, test) =>
	page.evaluate((/** @type {string} */ body) => {
		const el = document.activeElement;
		return !!el && new Function('el', `return (${body});`)(el);
	}, test);

/**
 * Check 7: an answer's failure is drawn against the document's standing, and focus moves only
 * from where the user's focus is.
 */
async function check7(/** @type {Browser} */ browser, /** @type {string} */ name) {
	const id = fresh(name);
	const { doc } = parse(readFileSync(join(MOCKUP, 'content', `${name}.md`), 'utf8'));
	const [q1, q2] = /** @type {any[]} */ (doc.segments.filter((s) => s.type === 'question'));
	/** @param {any} q */
	const offPick = (q) => (q.options.findIndex((/** @type {any} */ o) => o.recommended) === 0 ? 1 : 0);
	/** @param {any} q */
	const radio = (q, n = offPick(q)) => page.locator(`input[name="${id}-${q.id}"]`).nth(n);
	/** @param {any} q */
	const blockFor = (q) => page.locator(`[data-question="${q.id}"] [role=alert]`);
	const page = await newPage(browser);
	await open(page, id);

	// An answer lost before an approve and an Undo doesn't come back after them.
	await onAnswer(page, (r) => r.abort('failed'));
	await radio(q2).check();
	check(await visible(blockFor(q2).getByText(DOC.answerUnsent)), 'check 7: a lost answer shows answerUnsent under its question');
	await page.unroute('**/api/**');
	await approveButton(page).click();
	await page.getByText(DOC.recorded).waitFor();
	await undoButton(page).click();
	await approveButton(page).waitFor();
	check(!(await blockFor(q2).isVisible()), 'check 7: after an approve and an Undo, the old answer failure is gone');
	await shot(page, '7-stale-gone');

	// A retried answer refused with no standing leaves focus in its question, never on the body.
	await onAnswer(page, (r) => r.abort('failed'));
	await radio(q1).check();
	await blockFor(q1).getByRole('button', { name: DOC.tryAgain }).waitFor();
	await onAnswer(page, (r) =>
		r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ standing: null, message: DOC.badRequest }) })
	);
	await blockFor(q1).getByRole('button', { name: DOC.tryAgain }).focus();
	await page.keyboard.press('Enter');
	check(await visible(blockFor(q1).getByText(DOC.badRequest)), 'check 7: the retried answer shows the refusal under its question');
	await pause(500);
	check(
		await focusIs(page, `el.matches('input[type=radio]') && el.name === ${JSON.stringify(`${id}-${q1.id}`)}`),
		'check 7: after the refused retry, focus is on the question\'s radio'
	);
	await shot(page, '7-refused-retry');

	// A refusal that moves the document on leaves focus where the user moved it.
	/** @type {Route | null} */
	let held = null;
	await onAnswer(page, async (r) => {
		held = r;
	});
	// Part one left q2 on its off pick, so this pick is a change, and posts.
	await radio(q2, 1 - offPick(q2)).check();
	for (let i = 0; i < 50 && !held; i++) await pause(100);
	const away = page.locator(`nav.rail a[href^="/d/"]:not([href="/d/${id}"])`).first();
	await away.focus();
	const awayHref = await away.getAttribute('href');
	writeDecision(root, id, { action: 'sendback', at: new Date().toISOString() });
	check(!!held, 'check 7: the answer post reached the route and is held');
	await /** @type {any} */ (held)?.continue();
	check(await visible(decide(page).getByText(DOC.alreadyDecided)), 'check 7: the refusal shows in the decide section once the document moved on');
	await pause(500);
	check(
		await focusIs(page, `el.tagName === 'A' && el.getAttribute('href') === ${JSON.stringify(awayHref)}`),
		'check 7: focus stays on the link the user moved to'
	);
	await shot(page, '7-moved-on');
	await page.close();
}

/** The seeded mockup document with the most questions, two or more. */
function questioned() {
	const content = join(MOCKUP, 'content');
	let best = { name: '', n: 0 };
	for (const name of ['10-merge-gaps', '20-survey-edit', '40-queue-design', '50-backlog']) {
		const { doc } = parse(readFileSync(join(content, `${name}.md`), 'utf8'));
		const n = doc.segments.filter((s) => s.type === 'question').length;
		if (n > best.n) best = { name, n };
	}
	if (best.n < 2) throw new Error('no mockup document asks two questions');
	return best.name;
}

async function main() {
	mkdirSync(SHOTS, { recursive: true });
	const scratch = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, 'tmp') : tmpdir();
	state = mkdtempSync(join(scratch, 'aq-decide-checks-'));
	/** @type {Browser} */
	let browser;
	try {
		const seeded = await seed(state);
		root = seeded.root;
		await start();
		browser = await chromium();
		await run('check 1', () => check1(browser));
		await run('check 2', () => check2(browser));
		await run('check 3', () => check3(browser));
		await run('check 4', () => check4(browser));
		await run('check 5', () => check5(browser, seeded.ids['30-round-report']));
		await run('check 6', () => check6(browser, questioned()));
		await run('check 7', () => check7(browser, questioned()));
	} finally {
		await browser?.close();
		await stop();
		rmSync(state, { recursive: true, force: true });
	}
	process.exit(failed ? 1 : 0);
}

await main();
