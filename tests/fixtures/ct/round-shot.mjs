// Takes two screenshots at 1440 by 900: the board (reached with the b key from an item's page) and the digest page.
// A fourth argument, a round report's item id, adds a third: that report's page, saved as report.png.
// Usage: node round-shot.mjs <base url> <item id> <directory> [report item id]
import { join } from 'node:path';
import { launch } from './notes-common.mjs';

const [base, id, dir, reportId] = process.argv.slice(2);
if (!base || !id || !dir) {
	console.error('usage: round-shot.mjs <base url> <item id> <directory>');
	process.exit(2);
}
const root = base.replace(/\/$/, '');
const { browser, page } = await launch();
try {
	await page.goto(`${root}/item/${id}`, { waitUntil: 'networkidle' });
	await page.keyboard.press('b');
	await page.locator('table.board-table').waitFor({ state: 'visible' });
	await page.screenshot({ path: join(dir, 'board.png') });
	await page.goto(`${root}/digest`, { waitUntil: 'networkidle' });
	await page.locator('h1').first().waitFor({ state: 'visible' });
	await page.screenshot({ path: join(dir, 'digest.png') });
	if (reportId) {
		await page.goto(`${root}/item/${reportId}`, { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: 'Mark read' }).waitFor({ state: 'visible' });
		await page.screenshot({ path: join(dir, 'report.png') });
	}
	console.log(`shots: ${dir}`);
} finally {
	await browser.close();
}
