import { build, type BuildOptions } from 'esbuild';
import { legacyCatalog } from '../../helpers/theme-catalog';

type FixtureOptions = Pick<BuildOptions, 'alias' | 'plugins' | 'jsx' | 'define' | 'outfile'> & {mockThemeCatalog?:boolean};

/** Bundle real components into an isolated page; each scenario owns its service mocks. */
export async function componentFixtureHtml(contents: string, options: FixtureOptions = {}, css = '') {
  const {mockThemeCatalog=true,...buildOptions}=options;
  const result = await build({
    bundle: true, write: false, outfile: 'fixture.js', platform: 'browser',
    define: { 'process.env': '{}' }, ...buildOptions,
    stdin: { contents, resolveDir: process.cwd(), loader: 'tsx' },
  });
  const script = result.outputFiles.find(file => file.path.endsWith('.js'));
  if (!script) throw new Error('Component fixture produced no browser script');
  const moduleCss = result.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  const catalogMock=mockThemeCatalog?`const originalFetch=window.fetch;window.fetch=(input,init)=>new URL(typeof input==='string'?input:input.url,location.href).pathname==='/api/investment-themes'?Promise.resolve(new Response(${JSON.stringify(JSON.stringify({nodes:legacyCatalog}))},{headers:{'Content-Type':'application/json'}})):originalFetch.call(window,input,init);`:'';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${moduleCss}</style></head><body><div id="root"></div><script>${catalogMock}${script.text.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
