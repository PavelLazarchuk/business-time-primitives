import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const LOCAL_DATE_ACCESSORS = [
    'getFullYear',
    'getMonth',
    'getDate',
    'getDay',
    'getHours',
    'getMinutes',
    'getSeconds',
];

export default tseslint.config(
    { ignores: ['dist/', 'coverage/', 'node_modules/'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        ignores: ['**/*.test.ts', 'src/testUtils.ts'],
        rules: {
            'no-restricted-globals': [
                'error',
                { name: 'setTimeout', message: 'Business time math never schedules anything.' },
                { name: 'setInterval', message: 'Business time math never schedules anything.' },
            ],
            'no-restricted-imports': ['error', { patterns: ['node:*'] }],
            'no-restricted-properties': [
                'error',
                { object: 'Date', property: 'now', message: 'Pure functions never read a clock.' },

                ...LOCAL_DATE_ACCESSORS.map(property => ({
                    property,
                    message: `Use ${property.replace('get', 'getUTC')} — the host time zone is never the calendar's.`,
                })),
            ],
        },
    },
    {
        files: ['**/*.test.ts', 'src/testUtils.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            globals: {
                console: 'readonly',
                process: 'readonly',
                URL: 'readonly',
            },
        },
    },
    prettier
);
