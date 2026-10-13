import { describe, expect, it } from 'vitest';
import { render, renderInline } from './markdown.ts';

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

describe('links', () => {
	it('keeps http, https, mailto, and relative links', () => {
		expect(render('[a](https://x.test) [b](mailto:a@x.test) [c](docs/x.md)')).toContain('<a href="https://x.test">a</a>');
		expect(render('[c](docs/x.md)')).toContain('<a href="docs/x.md">c</a>');
	});

	it('renders a javascript: or data: link as its text', () => {
		expect(render('[x](javascript:alert(1))')).toBe('<p>x</p>\n');
		expect(renderInline('[y](data:text/html,hi)')).toBe('y');
	});
});
