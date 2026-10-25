import {instrumentFromCompany,instrumentId,validateInstrument,type Instrument} from './model';
import {isSupportedCompany} from '../company-support/model';
import {predictionInstrument} from '../predictions/instrument';

/** Company coverage also includes private/non-priceable editorial profiles. */
export function instrumentMigrationScope(ids:readonly string[]){
  return ids.filter(id=>/^(US:|XSHG:|XSHE:)/.test(id)&&Boolean(predictionInstrument(id.startsWith('US:')?id.slice(3):id)));
}

/** Only an explicit frozen legacy-coverage list may be grandfathered. */
export function planInstrumentSupportMigration(rows:{id:string;company:Record<string,unknown>;instrument?:Instrument}[],legacyIds:readonly string[]){
  const allowed=new Set(legacyIds),seen=new Set<string>();
  return rows.flatMap(row=>{
    if(!allowed.has(row.id)||seen.has(row.id))throw Error('Invalid legacy migration scope');seen.add(row.id);
    if(!isSupportedCompany(row.company))throw Error(`${row.id}: migrate canonical company support first`);
    const record=row.instrument??instrumentFromCompany(row.id,row.company);
    if(!record)return [];
    validateInstrument(record);
    if(record.companyId!==row.id||record.providerSymbols.youanalyst!==row.id||(record as Instrument&{isDeleted?:boolean}).isDeleted)throw Error(`${row.id}: reviewed instrument identity required`);
    if(record.status==='DELISTED')return [];
    if(record.onboarding?.status==='SUPPORTED')return [];
    if(record.onboarding)throw Error(`${row.id}: active instrument onboarding conflicts`);
    return [{id:instrumentId(row.id),companyId:row.id,record}];
  });
}
