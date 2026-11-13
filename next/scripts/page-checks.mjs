// The page checks of pass A3, and the seed the pages' tests share.
//
// `node next/scripts/page-checks.mjs` runs the nine checks against `next/build`, which
// `npm run build --prefix next` makes; it builds nothing. It prints one `ok:` or `FAIL:` line per
// check and exits 1 on any failure. `node next/scripts/page-checks.mjs mockup <dir>` serves the
// mockup app installed in <dir> and takes the same screenshots of its pages. A vitest import takes
// `seed` and launches nothing.
//
// Environment: PLAYWRIGHT_CORE (the playwright-core directory) and CHROMIUM (the browser
// executable) override the workstation's paths, as in `tests/fixtures/ct/notes-common.mjs`.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from '../src/lib/doc/parse.ts';
import { addVersion, createDocument, writeDecision } from '../src/lib/store/store.ts';

const MOCKUP = fileURLToPath(new URL('../../docs/mockup/', import.meta.url));
const CLI = fileURLToPath(new URL('../cli/index.js', import.meta.url));
const BUILD = fileURLToPath(new URL('../build', import.meta.url));
const SHOTS = fileURLToPath(new URL('../../.playwright-mcp/a3/', import.meta.url));

// Serves `repo view` (a default branch of main), `pr view <n>` from pr-<n>.json, and `pr merge`,
// as the stub in `next/cli/land.test.ts` does.
const STUB = `#!/usr/bin/env bash
dir=$(dirname "$0")
case "$1 $2" in
  "repo view") echo '{"defaultBranchRef":{"name":"main"}}' ;;
  "pr view") cat "$dir/pr-$3.json" ;;
  "pr merge") ;;
  *) echo "unexpected gh call" >&2; exit 1 ;;
esac
`;

/** @param {number} ms */
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Stores the mockup's five documents and its merged lines under the state directory `state`, the
 * directory `APPROVAL_QUEUE_STATE` names.
 *
 * Each document is created at least 2 ms after the one before, so the store lists them in name
 * order. `20-survey-edit` is stored as the version the session sent, then given its returned
 * version. The merged lines go through `land`, oldest first, against a stub `gh`.
 *
 * @param {string} state
 * @returns {Promise<{ root: string, ids: Record<string, string> }>} the store's root and each
 *   document's id by its file name without `.md`
 */
export async function seed(state) {
	const root = join(state, 'store');
	const content = join(MOCKUP, 'content');
	/** @type {Record<string, string>} */
	const ids = {};
	const names = readdirSync(content).filter((n) => n.endsWith('.md')).sort();
	for (const file of names) {
		const name = file.slice(0, -3);
		const source = readFileSync(join(content, file), 'utf8');
		const sentPath = join(MOCKUP, 'versions', `${name}.sent.md`);
		const first = name === '20-survey-edit' ? readFileSync(sentPath, 'utf8') : source;
		const { doc } = parse(first);
		const started = Date.now();
		const meta = createDocument(root, first, { kind: doc.kind ?? 'design', title: doc.title });
		if (first !== source) addVersion(root, meta.id, source);
		ids[name] = meta.id;
		while (Date.now() - started < 2) await pause(1);
	}

	const stub = join(state, 'gh-stub');
	mkdirSync(stub, { recursive: true });
	writeFileSync(join(stub, 'gh'), STUB);
	chmodSync(join(stub, 'gh'), 0o755);
	/** @type {{ repo: string, lines: { pr: number, time: string, text: string }[] }[]} */
	const groups = JSON.parse(readFileSync(join(content, 'merged.json'), 'utf8'));
	const lines = groups
		.flatMap((g) => g.lines.map((l) => ({ ...l, repo: g.repo })))
		.sort((x, y) => x.time.localeCompare(y.time));
	for (const line of lines) {
		const view = {
			state: 'OPEN',
			isDraft: false,
			headRefOid: 'abc123def456',
			body: 'A merged line for the page checks.',
			baseRefName: 'main',
			statusCheckRollup: [{ name: 'gate', status: 'COMPLETED', conclusion: 'SUCCESS' }]
		};
		writeFileSync(join(stub, `pr-${line.pr}.json`), JSON.stringify(view));
		const run = spawnSync(process.execPath, [CLI, 'land', `${line.repo}#${line.pr}`, line.text], {
			encoding: 'utf8',
			env: { ...process.env, APPROVAL_QUEUE_STATE: state, PATH: `${stub}:${process.env.PATH}` }
		});
		if (run.status !== 0) throw new Error(`land ${line.repo}#${line.pr} exited ${run.status}: ${run.stderr}`);
		await pause(2);
	}
	return { root, ids };
}

const APP_PORT = 7951;
const MOCK_PORT = 7953;
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };
const CSP_BLOCK = 'violates the following Content Security Policy';

/**
 * A paragraph with a remote image and a link with an inline handler, for check 2. The document is
 * approved as soon as it's stored, so no list shows it and the screenshots don't change.
 */
const HOSTILE = `---
kind: report
---
# A document with a remote image and an inline handler

A paragraph with <img src="https://example.com/x.png" alt="remote"> and <a href="#x" id="bad" onclick="document.title='ran'">a link that runs a script</a>.
`;

/**
 * The pages the screenshots cover, each shot at its top and then with each named heading at the top.
 *
 * @type {[name: string, path: string | null, headings: string[]][]}
 */
const SHOT_PAGES = [
	['front', '/', []],
	['10-merge-gaps', null, []],
	['20-survey-edit', null, []],
	['30-round-report', null, []],
	['40-queue-design', null, []],
	['50-backlog', null, []],
	['markdown', '/d/markdown', ['Tables', 'Code']],
	['long', '/d/long', ['The command', 'The round']]
];

let failed = false;

// next/ doesn't install playwright-core, so its types stand as any here.
/** @typedef {any} Browser */
/** @typedef {any} Page */
/** @typedef {Record<string, string>} Ids */

/** @param {boolean} ok @param {string} message */
function check(ok, message) {
	if (!ok) failed = true;
	console.log(`${ok ? 'ok' : 'FAIL'}: ${message}`);
}

export function chromium() {
	const home = process.env.HOME ?? '';
	const core = process.env.PLAYWRIGHT_CORE ?? `${home}/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`;
	const executablePath = process.env.CHROMIUM ?? `${home}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`;
	const { chromium } = createRequire(import.meta.url)(core);
	return chromium.launch({ executablePath });
}

/**
 * Starts `command` as a child of this script and waits up to 60 seconds for `url` to answer.
 *
 * @param {string} command @param {string[]} args @param {object} options @param {string} url
 */
export async function serve(command, args, options, url) {
	const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options });
	for (let i = 0; i < 300; i++) {
		if (child.exitCode !== null) throw new Error(`${command} exited ${child.exitCode} at start`);
		const up = await fetch(url).then(
			() => true,
			() => false
		);
		if (up) return child;
		await pause(200);
	}
	child.kill();
	throw new Error(`${url} didn't answer in 60 seconds`);
}

/**
 * Waits for the load event and the fonts, then 500 ms, so a screenshot shows the settled page.
 *
 * @param {Page} page
 */
async function settle(page) {
	await page.waitForLoadState('load');
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	await pause(500);
}

/**
 * Scrolls the reading column's heading whose text is `text` to the top of the window.
 *
 * @param {Page} page @param {string} text
 */
function scrollToHeading(page, text) {
	return page.evaluate((/** @type {string} */ text) => {
		const h = [...document.querySelectorAll('.page-main h2, .page-main h3')].find((el) => el.textContent?.trim() === text);
		if (!h) throw new Error(`no heading "${text}"`);
		h.scrollIntoView({ block: 'start' });
	}, text);
}

/**
 * Takes the screenshots of call 12 into `dir`: per width and theme, every page in `SHOT_PAGES` at
 * its top and at each named heading. `before` runs on each page after it settles.
 *
 * @param {Browser} browser
 * @param {string} base
 * @param {(name: string) => string} address
 * @param {string} dir
 * @param {(page: Page, name: string) => Promise<void>} [before]
 */
async function shoot(browser, base, address, dir, before) {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	let taken = 0;
	for (const [label, viewport] of /** @type {const} */ ([['1440', WIDE], ['390', NARROW]])) {
		for (const colorScheme of ['light', 'dark']) {
			const context = await browser.newContext({ viewport, colorScheme });
			const page = await context.newPage();
			let n = 0;
			for (const [name, path, headings] of SHOT_PAGES) {
				await page.goto(base + (path ?? address(name)));
				await settle(page);
				if (before) await before(page, name);
				const at = (/** @type {string} */ suffix) => join(dir, `${label}-${colorScheme}-${String(++n).padStart(2, '0')}-${name}${suffix}.png`);
				await page.screenshot({ path: at('') });
				for (const heading of headings) {
					await scrollToHeading(page, heading);
					await pause(500);
					await page.screenshot({ path: at(`-${heading.toLowerCase().replace(/ /g, '-')}`) });
				}
				taken += 1 + headings.length;
			}
			await context.close();
		}
	}
	return taken;
}

/**
 * The value of directive `name` in a content security policy, or null when it has none.
 *
 * @param {string} policy @param {string} name
 */
function directive(policy, name) {
	const part = policy.split(';').map((p) => p.trim()).find((p) => p.split(/\s+/)[0] === name);
	return part ? part.split(/\s+/).slice(1).join(' ') : null;
}

/**
 * The document pages: the five stored documents by name and the two specimens.
 *
 * @param {Ids} ids @returns {[name: string, path: string][]}
 */
function docPages(ids) {
	return [
		...Object.keys(ids).map((name) => /** @type {[string, string]} */ ([name, `/d/${ids[name]}`])),
		['markdown', '/d/markdown'],
		['long', '/d/long']
	];
}

/**
 * Check 1: every page's status, its policy, and no blocked inline code.
 *
 * @param {Browser} browser @param {string} base @param {Ids} ids
 */
async function checkPolicy(browser, base, ids) {
	const pages = [['front', '/', 200], ...docPages(ids).map(([n, p]) => [n, p, 200]), ['unknown id', '/d/20991231-235959-abcdef', 404]];
	const context = await browser.newContext({ viewport: WIDE });
	const page = await context.newPage();
	for (const [name, path, status] of pages) {
		/** @type {string[]} */
		const blocked = [];
		const listen = (/** @type {{ text(): string }} */ m) => m.text().includes(CSP_BLOCK) && blocked.push(m.text());
		page.on('console', listen);
		const response = await page.goto(base + path);
		await settle(page);
		page.off('console', listen);
		const policy = response?.headers()['content-security-policy'] ?? '';
		const img = directive(policy, 'img-src');
		const script = directive(policy, 'script-src') ?? '';
		const style = directive(policy, 'style-src') ?? '';
		check(response?.status() === status, `check 1: ${name} answers ${status} (got ${response?.status()})`);
		check(img === "'self' data:", `check 1: ${name} has img-src 'self' data: (got ${img})`);
		check(!!policy && !script.includes("'unsafe-inline'"), `check 1: ${name} has a policy whose script-src allows no inline script (got ${script})`);
		check(!style.includes("'sha"), `check 1: ${name} has no hash in style-src (got ${style})`);
		check(blocked.length === 0, `check 1: ${name} logs no blocked code${blocked.length ? ` (got ${blocked[0]})` : ''}`);
	}
	await context.close();
}

/**
 * Check 2: the test document's remote image and inline handler.
 *
 * @param {Browser} browser @param {string} base @param {string} id
 */
async function checkHostile(browser, base, id) {
	const context = await browser.newContext({ viewport: WIDE });
	const page = await context.newPage();
	const hosts = new Set();
	page.on('request', (/** @type {{ url(): string }} */ r) => hosts.add(new URL(r.url()).host));
	const response = await page.goto(`${base}/d/${id}`);
	await settle(page);
	const pre = await page.evaluate(() => ({
		img: !!document.querySelector('img[alt="remote"]'),
		onclick: document.querySelector('#bad')?.getAttribute('onclick') ?? null
	}));
	check(response?.status() === 200, 'check 2: the test document answers 200');
	check(pre.img, 'check 2: the test document draws img[alt="remote"]');
	check(!!pre.onclick, 'check 2: #bad keeps its onclick attribute in the DOM');
	const title = await page.title();
	await page.click('#bad');
	await pause(300);
	const own = new URL(base).host;
	const outside = [...hosts].filter((h) => h !== own);
	check(outside.length === 0, `check 2: no request leaves ${own}${outside.length ? ` (got ${outside.join(', ')})` : ''}`);
	check(
		await page.evaluate(() => !document.querySelector('img[alt="remote"]')?.hasAttribute('src')),
		'check 2: the remote image has no src'
	);
	check((await page.title()) === title, `check 2: a click on #bad leaves the title "${title}"`);
	await context.close();
}

/**
 * Check 3: the reading text's size, leading, and line length on /d/long.
 *
 * @param {Browser} browser @param {string} base
 */
async function checkMeasure(browser, base) {
	const context = await browser.newContext({ viewport: WIDE });
	const page = await context.newPage();
	await page.goto(`${base}/d/long`);
	await settle(page);
	const r = await page.evaluate(() => {
		const ps = [...document.querySelectorAll('.page-main .prose-doc p')].filter((p) => p.checkVisibility());
		const styles = ps.map((p) => getComputedStyle(p));
		const bad = styles.filter((s) => s.fontSize !== '16px' || s.lineHeight !== '24px').map((s) => `${s.fontSize}/${s.lineHeight}`);
		let wrapped = 0;
		const long = [];
		for (const p of ps) {
			if ((p.textContent ?? '').length <= 80) continue;
			const lines = new Map();
			const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const text = /** @type {Text} */ (node);
				for (let i = 0; i < text.length; i++) {
					const range = document.createRange();
					range.setStart(text, i);
					range.setEnd(text, i + 1);
					const rect = range.getClientRects()[0];
					if (!rect) continue;
					const top = Math.round(rect.top / 4);
					lines.set(top, (lines.get(top) ?? '') + text.data[i]);
				}
			}
			// The space a line breaks at stays on the line it ends, so it doesn't count.
			const texts = [...lines.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1].trimEnd());
			if (texts.length > 1) wrapped++;
			const over = texts.slice(0, -1).filter((t) => t.length > 80);
			for (const t of over) long.push(t);
		}
		const column = Math.round(ps[0]?.getBoundingClientRect().width ?? 0);
		return { count: ps.length, bad, wrapped, long, column };
	});
	check(r.count >= 10, `check 3: /d/long has ${r.count} paragraphs in the reading column, at least 10`);
	check(r.bad.length === 0, `check 3: every paragraph is 16px on 24px${r.bad.length ? ` (got ${r.bad[0]})` : ''}`);
	check(r.wrapped >= 1, `check 3: ${r.wrapped} paragraphs longer than 80 characters wrap`);
	// The mockup's column, 36.5rem, sets a few full lines of 81 or 82 characters in Karla. The mockup
	// wins for anything seen on a page (the plan's standing answers), so the check holds the column to
	// the mockup's width and reports the longer lines for the call that asks Geoff about them.
	check(r.column === 584, `check 3: the reading column is ${r.column} px, the mockup's 36.5rem (584 px)`);
	const longest = Math.max(0, ...r.long.map((/** @type {string} */ t) => t.length));
	console.log(`note: check 3: ${r.long.length} full lines pass 80 characters, the longest ${longest || 'none'}${r.long.length ? ` ("${r.long[0]}")` : ''}`);
	await context.close();
}

/**
 * Check 4: "On this page" on every document page, and its marked line on /d/long.
 *
 * @param {Browser} browser @param {string} base @param {Ids} ids
 */
async function checkOutline(browser, base, ids) {
	const context = await browser.newContext({ viewport: WIDE });
	const page = await context.newPage();
	for (const [name, path] of docPages(ids)) {
		await page.goto(base + path);
		await settle(page);
		const r = await page.evaluate(() => ({
			headings: [...document.querySelectorAll('.page-main .prose-doc h2, .page-main .prose-doc h3')].map((h) => h.textContent?.trim()),
			lines: [...document.querySelectorAll('.page-outline a')].map((a) => a.textContent?.trim())
		}));
		if (r.headings.length >= 3) {
			check(JSON.stringify(r.lines) === JSON.stringify(r.headings), `check 4: ${name} lists its ${r.headings.length} headings in order`);
		} else {
			check(r.lines.length === 0, `check 4: ${name}, with ${r.headings.length} headings, draws no "On this page"`);
		}
		if (name === '50-backlog') check(r.lines.length === 0, 'check 4: 50-backlog draws no "On this page"');
	}
	await page.goto(`${base}/d/long`);
	await settle(page);
	for (const text of ['What changes', 'The command', 'The round']) {
		await scrollToHeading(page, text);
		await pause(300);
		const current = await page.evaluate(() => document.querySelector('.page-outline a[aria-current]')?.textContent?.trim());
		check(current === text, `check 4: after a scroll to "${text}" its line is marked (got ${current})`);
	}
	await context.close();
}

/**
 * Check 5: a click on a heading inside a closed fold opens the fold and brings the heading up.
 *
 * @param {Browser} browser @param {string} base
 */
async function checkFold(browser, base) {
	const context = await browser.newContext({ viewport: WIDE });
	const page = await context.newPage();
	await page.goto(`${base}/d/long`);
	await settle(page);
	const find = () => [...document.querySelectorAll('.page-main h3')].find((h) => h.textContent?.trim() === 'Prompts');
	const before = await page.evaluate(`(${find})()?.closest('details')?.open ?? null`);
	const seen = await page.evaluate(`(${find})()?.checkVisibility() ?? null`);
	check(before === false, `check 5: the "Technical notes" fold starts closed (got ${before})`);
	check(seen === false, `check 5: "Prompts" starts hidden (got ${seen})`);
	await page.click('.page-outline a:text-is("Prompts")');
	await pause(1000);
	const after = await page.evaluate(`(() => { const h = (${find})(); return { open: h?.closest('details')?.open, top: h?.getBoundingClientRect().top }; })()`);
	check(after.open === true, 'check 5: a click on its line opens the fold');
	check(after.top >= 0 && after.top <= 100, `check 5: one second later "Prompts" is ${Math.round(after.top)} px from the top`);
	await context.close();
}

/**
 * Check 6: the specimen's wide table and long code block scroll inside their frames at 390 px.
 *
 * @param {Browser} browser @param {string} base
 */
async function checkFrames(browser, base) {
	const context = await browser.newContext({ viewport: NARROW });
	const page = await context.newPage();
	await page.goto(`${base}/d/markdown`);
	await settle(page);
	const r = await page.evaluate(() => {
		const widest = (/** @type {string} */ sel) => [...document.querySelectorAll(sel)].sort((a, b) => b.scrollWidth - a.scrollWidth)[0];
		/** @type {[string, Element | undefined][]} */
		const frames = [
			['table frame', widest('.page-main .table-frame')],
			['code block', widest('.page-main pre')]
		];
		return frames.map(([name, el]) => ({
			name,
			found: !!el,
			scrolls: el ? el.scrollWidth > el.clientWidth : false,
			overflow: el ? getComputedStyle(el).overflowX : null
		}));
	});
	for (const f of r) {
		check(f.found && f.scrolls && ['auto', 'scroll'].includes(f.overflow), `check 6: the ${f.name} scrolls inside its frame (overflow-x ${f.overflow})`);
	}
	await context.close();
}

/**
 * Check 7: no page reaches past 390 px.
 *
 * @param {Browser} browser @param {string} base @param {Ids} ids
 */
async function checkNarrow(browser, base, ids) {
	const context = await browser.newContext({ viewport: NARROW });
	const page = await context.newPage();
	for (const [name, path] of [['front', '/'], ...docPages(ids)]) {
		await page.goto(base + path);
		await settle(page);
		const r = await page.evaluate(() => {
			const scrolls = (/** @type {Element} */ el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX);
			const wide = [];
			for (const el of document.body.querySelectorAll('*')) {
				if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
				let up = el.parentElement;
				while (up && !scrolls(up)) up = up.parentElement;
				if (up) continue;
				const b = el.getBoundingClientRect();
				if (b.width === 0 && b.height === 0) continue;
				if (b.right > 390.5 || b.left < -0.5) wide.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${Math.round(b.left)}-${Math.round(b.right)}`);
			}
			return { width: document.documentElement.scrollWidth, wide };
		});
		check(r.width <= 390, `check 7: ${name} is ${r.width} px wide at 390`);
		check(r.wide.length === 0, `check 7: ${name} has no element past the viewport${r.wide.length ? ` (${r.wide.length}, first ${r.wide[0]})` : ''}`);
	}
	await context.close();
}

/**
 * Check 8: each document's radios and decide buttons.
 *
 * @param {Browser} browser @param {string} base @param {Ids} ids
 */
async function checkControls(browser, base, ids) {
	const context = await browser.newContext({ viewport: WIDE });
	const page = await context.newPage();
	for (const [name, path] of docPages(ids)) {
		const file = name === 'markdown' || name === 'long' ? join(MOCKUP, 'specimen', `${name}.md`) : join(MOCKUP, 'content', `${name}.md`);
		const { doc } = parse(readFileSync(file, 'utf8'));
		const options = doc.segments.reduce((n, s) => n + (s.type === 'question' ? s.options.length : 0), 0);
		const buttons = doc.kind === 'report' ? 1 : 2;
		await page.goto(base + path);
		await settle(page);
		const r = await page.evaluate(() => ({
			radios: document.querySelectorAll('.page-main input[type=radio]').length,
			buttons: document.querySelectorAll('.page-main section.decide button[type=button]').length,
			all: document.querySelectorAll('.page-main section.decide button').length
		}));
		check(r.radios === options, `check 8: ${name} draws ${r.radios} radios for ${options} options`);
		check(r.buttons === buttons && r.all === buttons, `check 8: ${name}'s decide section holds ${r.buttons} button[type=button] of ${r.all}, ${buttons} expected`);
	}
	await context.close();
}

async function checkApp() {
	const base = `http://127.0.0.1:${APP_PORT}`;
	const scratch = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, 'tmp') : tmpdir();
	const state = mkdtempSync(join(scratch, 'aq-page-checks-'));
	let server;
	let browser;
	try {
		const { root, ids } = await seed(state);
		const hostile = createDocument(root, HOSTILE, { kind: 'report', title: 'A document with a remote image and an inline handler' }).id;
		writeDecision(root, hostile, { action: 'approve', at: new Date().toISOString() });
		server = await serve(
			process.execPath,
			[BUILD],
			{ env: { ...process.env, HOST: '127.0.0.1', PORT: String(APP_PORT), APPROVAL_QUEUE_STATE: state } },
			base
		);
		browser = await chromium();
		await checkPolicy(browser, base, ids);
		await checkHostile(browser, base, hostile);
		await checkMeasure(browser, base);
		await checkOutline(browser, base, ids);
		await checkFold(browser, base);
		await checkFrames(browser, base);
		await checkNarrow(browser, base, ids);
		await checkControls(browser, base, ids);
		const taken = await shoot(browser, base, (name) => `/d/${ids[name]}`, join(SHOTS, 'app'));
		check(taken === 48, `check 9: ${taken} screenshots in .playwright-mcp/a3/app/`);
	} finally {
		await browser?.close();
		server?.kill();
		rmSync(state, { recursive: true, force: true });
	}
}

/** @param {string} dir the mockup app, installed */
async function shootMockup(dir) {
	const base = `http://127.0.0.1:${MOCK_PORT}`;
	writeFileSync(join(dir, 'content', 'seed-notes.json'), '{}');
	const vite = join(dir, 'node_modules', '.bin', 'vite');
	let server;
	let browser;
	try {
		server = await serve(vite, ['dev', '--host', '127.0.0.1', '--port', String(MOCK_PORT), '--strictPort'], { cwd: dir }, base);
		browser = await chromium();
		// vite dev optimizes its dependencies on the first hit to each page and reloads, so each page is
		// loaded once and thrown away before any shot.
		const warm = await browser.newPage();
		for (const [name, path] of SHOT_PAGES) {
			await warm.goto(base + (path ?? `/d/${name}`));
			await settle(warm);
		}
		await warm.close();
		const taken = await shoot(browser, base, (name) => `/d/${name}`, join(SHOTS, 'mockup'), async (page, name) => {
			if (name !== '20-survey-edit') return;
			const toggle = page.locator('input.toggle');
			if (await toggle.isChecked()) await toggle.click();
			await pause(300);
		});
		check(taken === 48, `mockup: ${taken} screenshots in .playwright-mcp/a3/mockup/`);
	} finally {
		await browser?.close();
		server?.kill();
	}
}

async function main() {
	const [mode, dir] = process.argv.slice(2);
	if (mode === 'mockup') {
		if (!dir) throw new Error('usage: page-checks.mjs mockup <dir>');
		await shootMockup(dir);
	} else {
		await checkApp();
	}
	if (failed) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
