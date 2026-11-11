// CT step 6 (second half): after `sendback.mjs` and a resend with --replies, the page carries the earlier
// notes into the margin, shows the answered note's reply in place, and labels the note whose quote was
// rewritten "This passage changed". Usage: node resend-check.mjs <base url> <resent item id> <state dir>
import { args, cards, check, launch } from './notes-common.mjs';

const { base, id } = args();
const { browser, page } = await launch();
try {
	await page.goto(`${base}/item/${id}`);
	await page.waitForSelector('#margin');
	await page.waitForLoadState('networkidle');
	const list = await cards(page);
	check(list.length === 2, `the margin carries both earlier notes (${list.length})`);
	const kept = list.find((c) => c.value.includes('Keep the first one.'));
	const rewritten = list.find((c) => c.value.includes('Rewrite this one.'));
	check(kept && kept.reply.includes('Kept as written'), 'the kept note shows its reply in place');
	check(kept && !kept.lost, 'the kept note is placed at its passage');
	check(rewritten && rewritten.lost, 'the rewritten note shows "This passage changed"');
	check(rewritten && rewritten.quote.includes('did not read the changed docs page'), 'the rewritten note keeps its original quote');
	check(rewritten && rewritten.reply.includes('Reworded in the resend'), 'the rewritten note shows its reply');
} finally {
	await browser.close();
}
