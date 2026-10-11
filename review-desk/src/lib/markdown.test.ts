import { describe, expect, it } from 'vitest';
import { render } from './markdown.ts';

describe('render', () => {
	it('renders markdown', () => {
		expect(render('# Hi')).toContain('<h1>Hi</h1>');
	});

	it.each(['<form method="post" action="?/approve"><button>x</button></form>', '<style>b{}</style>', '<script>alert(1)</script>'])(
		'escapes block HTML %s',
		(source) => {
			const html = render(source);
			expect(html).not.toMatch(/<(form|style|script|button)/);
			expect(html).toContain('&lt;');
		}
	);

	it('escapes inline HTML', () => {
		const html = render('text <form action="?/approve">x</form> and <script>1</script> and <style>b{}</style>');
		expect(html).not.toMatch(/<(form|style|script)/);
		expect(html).toContain('&lt;form');
	});
});
