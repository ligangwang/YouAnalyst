import releaseCatalog from '../../../data/investment-themes/catalog-v1.json';
import { validateThemeCatalog } from './catalog-model';

const published = validateThemeCatalog(
  releaseCatalog.nodes.filter(node => node.status === 'PUBLISHED' && !('isDeleted' in node && node.isDeleted === true)).map(
    ({ id, parentId, names, order, descriptions }) => ({
      id, parentId, names, order, ...(descriptions ? { descriptions } : {}),
    }),
  ),
);

/** The released catalog is validated and shared without a database lookup. */
export async function loadThemeCatalog() {
  return published;
}
