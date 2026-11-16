import { quote } from '../price-store/parquet';
import { fieldName, sortKey, type Data, getField,queryIndex } from './value';
export type Step = {
    method: string;
    args: unknown[];
};
const name = (v: unknown) => fieldName(v);
const jsonPath = (field: string) => '$.' + JSON.stringify(field);
const searchFields = new Set(['searchPrefixes', 'searchTerms', 'namePrefixes', 'symbolPrefixes']);
const literal = (field: string, value: unknown) => quote(field === '__name__' ? String(value) : sortKey(value) ?? 'missing');
export function compileMarketQuery(steps: Step[], fast = false) {
    const scalar = (field: string) => field === '__name__' ? 'id' : `json_extract_string(${fast && !searchFields.has(field.split('.')[0]) ? 'view_keys' : 'keys'},${quote(jsonPath(field))})`;
    const filters: string[] = [], orders: Array<{
        field: string;
        desc: boolean;
    }> = [];
    let limit: number | undefined, offset = 0, last = false;
    const selections: string[] = [];
    let projected = false;
    for (const { method, args } of steps) {
        const [a, b, c] = args;
        if (method === 'where') {
            const field = name(a), column = scalar(field), op = String(b);
            if (['in', 'not-in'].includes(op)) {
                if (!Array.isArray(c) || !c.length)
                    throw Error('Invalid IN query');
                filters.push(op === 'not-in' && c.includes(null) ? 'FALSE' : `${column} ${op === 'in' ? 'IN' : 'NOT IN'} (${c.map(v => literal(field, v)).join(',')})`);
                if (op === 'not-in')
                    filters.push(`${column} <> '0'`);
            }
            else if (op === 'array-contains' || op === 'array-contains-any') {
                const values = op === 'array-contains' ? [c] : c;
                if (!Array.isArray(values) || !values.length)
                    throw Error('Invalid array query');
                filters.push('(' + values.map(v => `json_contains(json_extract(arrays,${quote(jsonPath(field))}),${quote(JSON.stringify(sortKey(v)))})`).join(' OR ') + ')');
            }
            else {
                if (!['==', '!=', '<', '<=', '>', '>='].includes(op))
                    throw Error('Unsupported query operator');
                filters.push(op === '!=' && c === null ? 'FALSE' : `${column} ${op === '==' ? '=' : op} ${literal(field, c)}`);
                if (op === '!=')
                    filters.push(`${column} <> '0'`);
                if (['<', '<=', '>', '>='].includes(op) && field !== '__name__')
                    filters.push(`substr(${column},1,1)=${quote(sortKey(c)!.slice(0, 1))}`);
            }
        }
        else if (method === 'orderBy')
            orders.push({ field: name(a), desc: b === 'desc' });
        else if (method === 'limit' || method === 'limitToLast') {
            if (!Number.isSafeInteger(a) || Number(a) < 1)
                throw Error('Invalid query limit');
            limit = Number(a);
            last = method === 'limitToLast';
        }
        else if (method === 'offset') {
            if (!Number.isSafeInteger(a) || Number(a) < 0)
                throw Error('Invalid offset');
            offset = Number(a);
        }
        else if (method === 'select') {
            projected = true;
            selections.push(...args.map(name));
        }
        else if (!['startAt', 'startAfter', 'endAt', 'endBefore', 'count'].includes(method))
            throw Error(`Unsupported market query ${method}`);
    }
    for (const field of [...new Set(steps.filter(s => s.method === 'where' && ['<', '<=', '>', '>=', '!=', 'not-in'].includes(String(s.args[1]))).map(s => name(s.args[0])))].sort())
        if (!orders.some(o => o.field === field))
            orders.push({ field, desc: orders.at(-1)?.desc ?? false });
    if (!orders.some(o => o.field === '__name__'))
        orders.push({ field: '__name__', desc: orders.at(-1)?.desc ?? false });
    for (const order of orders)
        filters.push(`${scalar(order.field)} IS NOT NULL`);
    for (const step of steps.filter(s => ['startAt', 'startAfter', 'endAt', 'endBefore'].includes(s.method))) {
        const doc = step.args[0] as {
            id?: string;
            get?: (field: string) => unknown;
        };
        const values = doc?.get ? orders.map(o => o.field === '__name__' ? doc.id : doc.get!(o.field)) : step.args;
        if (!values.length || values.length > orders.length)
            throw Error('Invalid query cursor');
        const after = step.method.startsWith('start'), inclusive = step.method === 'startAt' || step.method === 'endAt';
        filters.push('(' + values.map((value, i) => '(' + [...values.slice(0, i).map((v, n) => `${scalar(orders[n].field)}=${literal(orders[n].field, v)}`), `${scalar(orders[i].field)} ${after !== orders[i].desc ? '>' : '<'}${inclusive && i === values.length - 1 ? '=' : ''} ${literal(orders[i].field, value)}`].join(' AND ') + ')').join(' OR ') + ')');
    }
    const ordering = orders.map(o => `${scalar(o.field)} ${o.desc !== last ? 'DESC' : 'ASC'}`).join(',');
    return { where: filters.join(' AND ') || 'TRUE', order: ordering, limit, offset, last, selection: projected ? selections : undefined };
}
export function project(data: Data, fields: string[]): Data {
    const result: Data = {};
    for (const field of fields) {
        if (field === '__name__')
            continue;
        const value = getField(data, field);
        if (value === undefined)
            continue;
        const parts = field.split('.');
        let into = result;
        for (const part of parts.slice(0, -1))
            into = (into[part] ??= {}) as Data;
        into[parts.at(-1)!] = value;
    }
    return result;
}
/** Equality-only, identity-ordered merges need no database connection. Use the
 * same encoded keys as SQL; complex ordering, inequalities and cursors retain
 * the DuckDB path. This keeps live UGC merges out of the scan queue. */
export function filterIdentityOrdered<T extends {id:string;data:Data}>(rows:T[],steps:Step[]):T[]|undefined{
    if(steps.some(step=>step.method==='where'&&!['==','in'].includes(String(step.args[1]))
        ||step.method==='orderBy'&&fieldName(step.args[0])!=='__name__'
        ||!['where','orderBy','select','limit','limitToLast','offset','count'].includes(step.method)))return undefined;
    const plan=compileMarketQuery(steps),predicates=steps.filter(step=>step.method==='where');
    const fields=[...new Set(predicates.map(step=>fieldName(step.args[0])).filter(field=>field!=='__name__'))];
    let selected=rows.filter(row=>{
        const index=fields.length?queryIndex(project(row.data,fields)):undefined;
        return predicates.every(step=>{
            const field=fieldName(step.args[0]),key=field==='__name__'?row.id:index!.keys[field];
            if(key===undefined)return false;
            const values=step.args[1]==='in'?step.args[2] as unknown[]:[step.args[2]];
            return values.some(value=>key===(field==='__name__'?String(value):sortKey(value)??'missing'));
        });
    });
    const desc=(steps.find(step=>step.method==='orderBy')?.args[1]==='desc')!==plan.last;
    selected.sort((a,b)=>(desc?-1:1)*Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
    selected=selected.slice(plan.offset,plan.limit===undefined?undefined:plan.offset+plan.limit);
    if(plan.last)selected.reverse();
    return plan.selection?selected.map(row=>({...row,data:project(row.data,plan.selection!)})):selected;
}
