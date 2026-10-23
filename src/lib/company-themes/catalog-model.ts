import { hierarchyPath, validateHierarchy, type HierarchyNode } from '../hierarchy/model';

export type ThemeCatalog = HierarchyNode[];
export const isThemeId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value);
export function validateThemeCatalog(nodes: ThemeCatalog): ThemeCatalog {
  validateHierarchy(nodes);
  if (!nodes.length || nodes.length > 2000) throw new Error('Theme catalog is empty or too large');
  for (const node of nodes) {
    if (!/^[a-z][a-z0-9.-]{0,159}$/.test(node.id)) throw new Error('Invalid theme node ID');
    const path = hierarchyPath(nodes, node.id);
    if (path.length <= 2 && !isThemeId(node.id)) throw new Error('Invalid family or theme ID');
    if (path.length > 12) throw new Error('Theme hierarchy is too deep');
  }
  return [...nodes].sort((a,b)=>a.order-b.order || a.id.localeCompare(b.id));
}
export const themeFamilies = (nodes: ThemeCatalog) => nodes.filter(node=>node.parentId===null);
export const catalogThemes = (nodes: ThemeCatalog) => {
  const families = new Set(themeFamilies(nodes).map(node=>node.id));
  return nodes.filter(node=>node.parentId!==null && families.has(node.parentId));
};
export const catalogThemeIds = (nodes: ThemeCatalog) => catalogThemes(nodes).map(node=>node.id);
export function resolveCatalogTheme(nodes:ThemeCatalog,value:unknown){
  const themes=catalogThemeIds(nodes);
  if(value===undefined || value===null || value==='')return themes[0];
  return isThemeId(value)&&themes.includes(value)?value:undefined;
}
export function catalogThemeForNode(nodes: ThemeCatalog, id: string) {
  return hierarchyPath(nodes,id)[1];
}
export function catalogThemeName(nodes: ThemeCatalog, id: string, chinese=false) {
  return nodes.find(node=>node.id===id)?.names[chinese?'zh-CN':'en'] ?? id;
}
/** Families and themes aggregate descendants at read time; company records stay unchanged. */
export function descendantThemeIds(nodes: ThemeCatalog, id: string) {
  return catalogThemes(nodes).filter(theme=>hierarchyPath(nodes,theme.id).some(node=>node.id===id)).map(theme=>theme.id);
}
