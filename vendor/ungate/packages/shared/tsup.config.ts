import { defineConfig } from 'tsup';

export default defineConfig([
	{
		entry: ['src/index.ts', 'src/frontend.ts'],
		outDir: 'lib',
		tsconfig: 'tsconfig.build.json',
		format: ['esm'],
		target: 'node22',
		bundle: true,
		splitting: false,
		sourcemap: true,
		clean: true,
		dts: true,
		outExtension: () => ({ js: '.js' })
	},
	{
		entry: ['src/**/*.ts'],
		outDir: 'lib',
		tsconfig: 'tsconfig.build.json',
		format: ['cjs'],
		target: 'node22',
		bundle: false,
		splitting: false,
		sourcemap: true,
		clean: false,
		dts: false,
		outExtension: () => ({ js: '.cjs' })
	}
]);
