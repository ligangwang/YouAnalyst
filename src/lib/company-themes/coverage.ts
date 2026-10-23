import { loadThemeCatalog } from './catalog';
import { catalogThemeIds } from './catalog-model';
import { loadThemeGraph } from './graph-service';
import { mergeCoverageGraphs } from '../posts/evidence';

/** Publication uses the same catalog as browsing, with bounded graph reads. */
export async function loadThemeCoverage(loadCatalog=loadThemeCatalog,loadGraph=loadThemeGraph) {
  const themes=catalogThemeIds(await loadCatalog());
  const entries:Parameters<typeof mergeCoverageGraphs>[0]=[];
  for(let offset=0;offset<themes.length;offset+=4)entries.push(...await Promise.all(themes.slice(offset,offset+4).map(async theme=>({theme,graph:await loadGraph(theme)}))));
  return mergeCoverageGraphs(entries);
}
