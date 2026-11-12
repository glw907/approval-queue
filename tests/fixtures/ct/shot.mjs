// Takes one screenshot of a served page at 1440 by 900 once its network is idle and its primary button shows.
// Usage: node shot.mjs <url> <file>
import { launch } from './notes-common.mjs';

const [url, file] = process.argv.slice(2);
if (!url || !file) {
	console.error('usage: shot.mjs <url> <file>');
	process.exit(2);
}
const { browser, page } = await launch();
try {
	await page.goto(url, { waitUntil: 'networkidle' });
	await page.locator('.btn-primary').first().waitFor({ state: 'visible' });
	await page.screenshot({ path: file });
	console.log(`shot: ${file}`);
} finally {
	await browser.close();
}
