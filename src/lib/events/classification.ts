export const EVENT_CLASSIFICATION_VERSION = 1;
export const EVENT_TYPES = ['earnings','insider_trade','relationship','product_business','corporate_action','financing','regulatory_governance','other'] as const;
export type EventType = typeof EVENT_TYPES[number];
export type EventClassification = {eventType:EventType;eventSubtype:string;eventClassification:{version:1;method:'parser'|'rules'|'fallback';rule:string;evidence:string[]}};
export type ClassifiedEvent = Partial<EventClassification> & {eventGroupingKey?:string};
const labels:Record<string,[string,string]> = {
 earnings_results:['Earnings results','业绩结果'],earnings_scheduled:['Upcoming earnings','业绩预告日程'],earnings_guidance:['Earnings guidance','业绩指引'],financial_report:['Financial report','财务报告'],
 insider_buy:['Insider buy','内部人买入'],insider_sell:['Insider sell','内部人卖出'],insider_award:['Stock award','股票授予'],insider_exercise:['Option exercise / conversion','期权行权／转换'],insider_withholding:['Exercise / tax withholding','行权／税款扣股'],insider_gift:['Gift','赠与'],insider_planned_sale:['Planned insider sale','拟进行的内部人出售'],insider_ownership:['Insider ownership disclosure','内部人持股披露'],insider_mixed:['Multiple insider transaction types','多种内部人交易'],
 relationship_new:['New relationship','新增合作关系'],relationship_expanded:['Relationship expansion','合作关系扩大'],relationship_terminated:['Relationship termination','合作关系终止'],relationship_disclosure:['Relationship disclosure','合作关系披露'],
 product_launch:['Product launch','产品发布'],business_update:['Business update','业务动态'],acquisition_announced:['Acquisition announced','收购宣布'],acquisition_completed:['Acquisition completed','收购完成'],dividend:['Dividend','股息'],buyback:['Share buyback','股份回购'],stock_split:['Stock split','股票拆分'],financing:['Financing','融资'],management_change:['Management / board change','管理层／董事变更'],regulatory:['Regulatory development','监管动态'],other_disclosure:['Other disclosure','其他披露'],
};
const typeNames:Record<EventType,[string,string]>={earnings:['Earnings','业绩'],insider_trade:['Insider trades','内部人交易'],relationship:['Relationships','关系'],product_business:['Business','业务'],corporate_action:['Corporate actions','公司行动'],financing:['Financing','融资'],regulatory_governance:['Governance','治理'],other:['Other','其他']};
export function eventPresentation(value:ClassifiedEvent,chinese=false){
 const type=value.eventType&&EVENT_TYPES.includes(value.eventType)?value.eventType:'other';
 const subtype=value.eventSubtype??'other_disclosure';
 const [symbol,color]=type==='insider_trade'?subtype==='insider_buy'?['▲','#67dfc5']:subtype==='insider_sell'?['▼','#ff93ad']:['◇','#aad7d3']:({earnings:['◆','#f2ce79'],relationship:['⬡','#c49aff'],product_business:['●','#78cff5'],corporate_action:['■','#ffb478'],financing:['＋','#70e4ee'],regulatory_governance:['✦','#c4b9fa'],other:['○','#a7b5c5']} as const)[type];
 return {type,label:(labels[subtype]??typeNames[type])[chinese?1:0],typeLabel:typeNames[type][chinese?1:0],symbol,color};
}
function classified(type:EventType,subtype:string,method:EventClassification['eventClassification']['method'],rule:string,evidence:string[]):EventClassification{
 return {eventType:type,eventSubtype:subtype,eventClassification:{version:EVENT_CLASSIFICATION_VERSION,method,rule,evidence:evidence.map(s=>s.slice(0,500)).slice(0,3)}};
}
/** Conservative metadata/headline classification. Form names do not prove a trade direction. */
export function classifyEvent(row:Record<string,unknown>):EventClassification{
 const title=typeof row.title==='string'?row.title:'',form=typeof row.form==='string'?row.form.replace(/\/A$/,''):'';
 const hit=(pattern:RegExp)=>title.match(pattern)?.[0];
 const rule=(pattern:RegExp,type:EventType,subtype:string)=>{const match=hit(pattern);return match?classified(type,subtype,'rules','headline.'+subtype,[match]):null;};
 if(['3','4','5','144'].includes(form))return classified('insider_trade',form==='144'?'insider_planned_sale':'insider_ownership','parser','sec.form',[form]);
 if(row.category==='EARNINGS'&&form==='8-K')return classified('earnings','earnings_results','parser','sec.item.2.02',['SEC Item 2.02']);
 if(/^(10-K|10-Q|20-F|40-F)$/.test(form))return classified('earnings','financial_report','parser','sec.periodic_report',[form]);
 const rules:[RegExp,EventType,string][]=[
 [/\b(?:to report|will report|sets? (?:a |the )?date|announces? (?:a |the )?date).*\b(?:earnings|financial results)|\b(?:earnings|financial results).*\b(?:conference call|scheduled|date)\b|业绩(?:发布|说明)会.*(?:召开|时间)|预约.*(?:季度|年度)报告/i,'earnings','earnings_scheduled'],
 [/\b(?:reports?|announces?|releases?).*\b(?:quarter|year|financial).*\bresults\b|(?:季度|半年度|年度)报告|业绩快报/i,'earnings','earnings_results'],
 [/\b(?:raises?|lowers?|updates?|revises?).*\b(?:guidance|outlook)\b|业绩预告|盈利预测/i,'earnings','earnings_guidance'],
 [/\b(?:completes?|closes?).*\b(?:acquisition|merger)\b|完成.*(?:收购|合并)/i,'corporate_action','acquisition_completed'],
 [/\b(?:to acquire|agrees? to acquire|announces?.*acquisition|merger agreement)\b|拟.*收购|签署.*(?:收购|合并)/i,'corporate_action','acquisition_announced'],
 [/\b(?:declares?|announces?|approves?).*\bdividend\b|利润分配|派发.*股息|分红/i,'corporate_action','dividend'],
 [/\b(?:announces?|approves?|authorizes?|expands?).*\b(?:buyback|share repurchase)\b|回购股份|股份回购/i,'corporate_action','buyback'],
 [/\bstock split\b|股票拆分|转增股本/i,'corporate_action','stock_split'],
 [/\b(?:terminates?|ends?).*\b(?:partnership|agreement|contract)\b|终止.*(?:合作|合同|协议)/i,'relationship','relationship_terminated'],
 [/\b(?:expands?|extends?|renews?).*\b(?:partnership|agreement|collaboration|contract)\b|扩大.*合作|续签.*(?:合同|协议)/i,'relationship','relationship_expanded'],
 [/\b(?:announces?|enters?|signs?|forms?|launches?).*\b(?:partnership|collaboration|supply agreement|customer agreement)\b|签署.*(?:合作|供货|采购).*协议|建立.*合作/i,'relationship','relationship_new'],
 [/\b(?:launches?|introduces?|unveils?|releases?).*\b(?:product|chip|processor|platform|software|accelerator)\b|发布.*(?:产品|芯片|处理器|平台)/i,'product_business','product_launch'],
 [/\b(?:announces?|prices?|closes?).*\b(?:offering|debt financing|notes offering|capital raise)\b|发行.*(?:债券|股票)|定向增发|融资/i,'financing','financing'],
 [/\b(?:appoints?|names?|resigns?|steps down|retire[sd]?).*\b(?:CEO|CFO|chief|director)|\b(?:CEO|CFO|director).*\b(?:resigns?|steps down|retires?)|聘任|辞任|董事变更/i,'regulatory_governance','management_change'],
 [/\b(?:regulatory approval|antitrust|regulator|SEC investigation)\b|监管.*(?:批准|调查)|行政处罚/i,'regulatory_governance','regulatory'],
 ];
 for(const [pattern,type,subtype] of rules){const result=rule(pattern,type,subtype);if(result)return result;}
 if(row.type==='company_news')return classified('product_business','business_update','fallback','official_news',[title]);
 return classified('other','other_disclosure','fallback','unresolved',[title||form||'Disclosure']);
}
/** Read only classifications produced by the current schema, otherwise use safe rules. */
export function eventClassification(row:Record<string,unknown>):EventClassification{
 const meta=row.eventClassification as EventClassification['eventClassification']|undefined;
 const subtype=typeof row.eventSubtype==='string'?row.eventSubtype:'';
 const subtypeType:EventType=subtype.startsWith('earnings_')||subtype==='financial_report'?'earnings':subtype.startsWith('insider_')?'insider_trade':subtype.startsWith('relationship_')?'relationship':['product_launch','business_update'].includes(subtype)?'product_business':['acquisition_announced','acquisition_completed','dividend','buyback','stock_split'].includes(subtype)?'corporate_action':subtype==='financing'?'financing':['management_change','regulatory'].includes(subtype)?'regulatory_governance':'other';
 if(meta?.version===EVENT_CLASSIFICATION_VERSION&&['parser','rules','fallback'].includes(meta.method)&&EVENT_TYPES.includes(row.eventType as EventType)&&row.eventType===subtypeType&&subtype in labels&&typeof meta.rule==='string'&&Array.isArray(meta.evidence)&&meta.evidence.every(e=>typeof e==='string'))return {eventType:row.eventType as EventType,eventSubtype:subtype,eventClassification:meta};
 return classifyEvent(row);
}
