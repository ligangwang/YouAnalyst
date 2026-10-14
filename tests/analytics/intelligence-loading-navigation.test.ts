import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

test('loading HTML retains localized research links before company data arrives', async () => {
  let locale = 'en';
  const result = await build({ entryPoints: ['src/components/intelligence-loading-shell.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', external: ['./providers/locale-provider', './intelligence-theme-selector', 'next/link'], plugins: [{ name: 'css-fixture', setup(builder) { builder.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default {}', loader: 'js' })); } }] });
  const realRequire = createRequire(import.meta.url), evaluated = { exports: {} };
  const injected = (name: string) => {
    if (name === './providers/locale-provider') return { useLocale: () => ({ locale, chinese: locale === 'zh-CN' }) };
    if (name === './intelligence-theme-selector') return { IntelligenceThemeSelector: () => null };
    if (name === 'next/link') return { __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) };
    return realRequire(name);
  };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(injected, evaluated, evaluated.exports);
  const Shell = (evaluated.exports as { IntelligenceLoadingShell: React.ComponentType<{ theme?: 'ai' | 'robotics' }> }).IntelligenceLoadingShell;
  for (const [language, prefix] of [['en', 'en'], ['zh-CN', 'zh-cn']]) {
    locale = language;
    const html = renderToStaticMarkup(React.createElement(Shell));
    for (const slug of ['nvidia-ai-ecosystem', 'amd-ai-ecosystem']) assert(html.includes(`href="/${prefix}/research/${slug}"`));
    assert(!renderToStaticMarkup(React.createElement(Shell, { theme: 'robotics' })).includes('nvidia-ai-ecosystem'));
  }
});
