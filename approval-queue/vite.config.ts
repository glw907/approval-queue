import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { queuePort } from './src/lib/port.ts';

// Read once at build time: the CSRF origin and the Host check must name the same port.
const port = queuePort(process.env.APPROVAL_QUEUE_PORT);

export default defineConfig({
	define: { __QUEUE_PORT__: JSON.stringify(port) },
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter(),
			// The built app's CSRF check trusts this origin; without it adapter-node
			// derives an https origin and every form post from the browser fails.
			paths: { origin: `http://127.0.0.1:${port}` },
			csp: { directives: { 'script-src': ['self'] } }
		})
	]
});
