import type { Firestore } from 'firebase-admin/firestore';
import seed from '../../data/investment-themes/catalog-v1.json';
export const legacyCatalog=seed.nodes.filter(node=>node.parentId===null||['ai','robotics','space'].some(id=>node.id===id||node.id.startsWith(id+'.')));
/** Supply the catalog as an independent read, leaving each scenario's company/query mocks intact. */
export function withThemeCatalog(db:Firestore,nodes=legacyCatalog):Firestore{
  return new Proxy(db,{get(target,key){
    if(key==='collection')return (name:string)=>{
      if(name!=='investment_themes')return target.collection(name);
      const query={where:()=>query,select:()=>query,limit:()=>query,get:async()=>({docs:nodes.map(node=>({id:node.id,data:()=>node}))})};return query;
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
}
