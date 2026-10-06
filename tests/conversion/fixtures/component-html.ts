import { build, type BuildOptions } from 'esbuild';

type FixtureOptions = Pick<BuildOptions, 'alias' | 'plugins' | 'jsx' | 'define' | 'outfile'>;

/** Bundle real components into an isolated page; each scenario owns its service mocks. */
export async function componentFixtureHtml(contents: string, options: FixtureOptions = {}, css = '') {
  const result = await build({
    bundle: true, write: false, outfile: 'fixture.js', platform: 'browser',
    define: { 'process.env': '{}' }, ...options,
    stdin: { contents, resolveDir: process.cwd(), loader: 'tsx' },
  });
  const script = result.outputFiles.find(file => file.path.endsWith('.js'));
  if (!script) throw new Error('Component fixture produced no browser script');
  const moduleCss = result.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${moduleCss}</style></head><body><div id="root"></div><script>${script.text.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
