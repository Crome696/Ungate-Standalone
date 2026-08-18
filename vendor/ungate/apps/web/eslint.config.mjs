import { createSvelteEslintConfig } from '@ungate/dev-kit/eslint-svelte';

import svelteConfig from './svelte.config.js';

export default createSvelteEslintConfig({
	projectRoot: import.meta.dirname,
	svelteConfig,
	alias: {
		'$shared/*': ['./src/shared/*'],
		'$components/*': ['./src/components/*'],
		'$features/*': ['./src/features/*'],
		'$layouts/*': ['./src/layouts/*'],
		'$src/*': ['./src/*']
	},
	additionalRules: {
		'import-x/no-unresolved': ['error', { ignore: ['^virtual:icons/'] }]
	},
	additionalSvelteRules: {
		'import-x/no-unresolved': ['error', { ignore: ['^virtual:icons/'] }],
		'@typescript-eslint/no-unsafe-call': 'off',
		'@typescript-eslint/no-unsafe-member-access': 'off',
		'@typescript-eslint/prefer-nullish-coalescing': 'off'
	}
});
