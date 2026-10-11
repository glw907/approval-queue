import { defineParams } from '@sveltejs/kit/params';

/** Item ids are `<YYYYmmddTHHMMSS>-<pid>`, so a URL id cannot carry a path segment. */
export const params = defineParams({
	id: (param) => (/^\d{8}T\d{6}-\d+$/.test(param) ? param : undefined)
});
