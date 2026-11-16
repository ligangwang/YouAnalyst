import test from 'node:test';
import assert from 'node:assert/strict';
import {Timestamp} from 'firebase-admin/firestore';
import {compileMarketQuery,filterIdentityOrdered,project,type Step} from '../../src/lib/market-store/query';
import {queryIndex} from '../../src/lib/market-store/value';
import {withDuck} from '../../src/lib/price-store/parquet';

test('identity-ordered equality merges match DuckDB for values, projections and page bounds',async()=>{
    const values=[null,true,false,0,-1,NaN,'text',[1,2],{nested:'value'},Timestamp.fromMillis(1234),Buffer.from('bytes'),undefined];
    const rows=values.map((value,i)=>({id:['a','é','中','😀','z','b','c','d','e','f','g','h'][i],data:{value,group:i%2}}));
    const cases:Step[][]=[[],[{method:'orderBy',args:['__name__','desc']}],[{method:'limit',args:[3]},{method:'offset',args:[2]}],
        [{method:'limitToLast',args:[3]},{method:'offset',args:[1]}],[{method:'orderBy',args:['__name__','desc']},{method:'limitToLast',args:[4]}],
        [{method:'where',args:['__name__','in',['é','a','é']]}],
        [{method:'where',args:['value','in',[null,NaN,'text']]}],
        [{method:'where',args:['group','==',1]},{method:'select',args:['value']},{method:'limit',args:[3]}],
        ...values.filter(value=>value!==undefined).map(value=>[{method:'where',args:['value','==',value]}]),
    ];
    await withDuck(async db=>{
        await db.run('CREATE TABLE records (id VARCHAR,keys JSON,arrays JSON,position INTEGER)');const append=await db.createAppender('records');
        try{rows.forEach((row,i)=>{const index=queryIndex(row.data);append.appendVarchar(row.id);append.appendVarchar(JSON.stringify(index.keys));append.appendVarchar(JSON.stringify(index.arrays));append.appendInteger(i);append.endRow();});}finally{append.closeSync();}
        for(const steps of cases){
            const plan=compileMarketQuery(steps);
            const expected=(await db.runAndReadAll(`SELECT position FROM records WHERE ${plan.where} ORDER BY ${plan.order}${plan.limit===undefined?'':` LIMIT ${plan.limit}`} OFFSET ${plan.offset}`)).getRows().map(([i])=>rows[Number(i)]);
            if(plan.last)expected.reverse();
            const projected=plan.selection?expected.map(row=>({...row,data:project(row.data,plan.selection!)})):expected;
            assert.deepEqual(filterIdentityOrdered(rows,steps),projected);
        }
    });
});
test('complex ordering, inequalities and cursors stay on the SQL path',()=>{
    for(const steps of [[{method:'orderBy',args:['value']}],[{method:'where',args:['value','>',1]}],[{method:'startAfter',args:['a']}],[{method:'where',args:['value','array-contains','a']}]] as Step[][])
        assert.equal(filterIdentityOrdered([],steps),undefined);
});
