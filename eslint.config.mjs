import tsParser from '@typescript-eslint/parser';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import eslintPluginImportX from 'eslint-plugin-import-x';
import prettier from 'eslint-plugin-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config['rules']} */
const sharedRules = {
	'prettier/prettier': 'error',
	'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
	'padding-line-between-statements': [
		'error',
		{ blankLine: 'always', prev: '*', next: 'return' },
		{ blankLine: 'always', prev: 'import', next: '*' },
		{ blankLine: 'any', prev: 'import', next: 'import' }
	],
	'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
	'import-x/no-named-as-default-member': 'off',
	'import-x/no-unresolved': 'error',
	'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
	'import-x/order': [
		'error',
		{
			'newlines-between': 'always',
			groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
			alphabetize: {
				order: 'asc',
				caseInsensitive: true
			}
		}
	]
};

const resolverSettings = {
	'import-x/resolver-next': [
		createTypeScriptImportResolver({
			alwaysTryTypes: true,
			extensions: ['.ts', '.js', '.mjs', '.cjs', '.d.ts', '.json']
		})
	]
};

export default defineConfig(
	tseslint.configs.recommendedTypeChecked,
	eslintPluginImportX.flatConfigs.recommended,
	eslintPluginImportX.flatConfigs.typescript,
	globalIgnores(['vendor/**', 'dist/**', 'resources/**', 'node_modules/**', 'release/**']),
	{
		plugins: { prettier },
		files: ['**/*.{ts,js,mjs,cjs}'],
		settings: resolverSettings,
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
				allowDefaultProject: ['scripts/*.mjs', 'src/preload.cjs', 'eslint.config.mjs', 'prettier.config.mjs']
			},
			globals: {
				...globals.node
			},
			ecmaVersion: 'latest',
			sourceType: 'module'
		},
		rules: sharedRules
	},
	{
		files: ['scripts/**/*.mjs', 'src/**/*.cjs'],
		extends: [tseslint.configs.disableTypeChecked],
		languageOptions: {
			parserOptions: {
				projectService: false
			}
		},
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
		}
	},
	{
		files: ['src/preload.cjs'],
		languageOptions: {
			sourceType: 'commonjs'
		},
		rules: {
			'@typescript-eslint/no-require-imports': 'off'
		}
	},
	eslintConfigPrettier
);
