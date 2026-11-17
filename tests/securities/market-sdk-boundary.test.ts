import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Raw clients are restricted to the two adapters, explicitly wrapped clients,
// and operator tools that inspect migration controls/heads or retire sources.
const rawClients=new Set([
    'src/lib/firebase/admin.ts','src/lib/firebase/firestore.ts',
    'scripts/backfill-mapped-price-history.ts','scripts/normalize-price-history.ts',
    'scripts/bundle-market-indexes.ts','scripts/compact-market-heads.ts',
    'scripts/finalize-market-parquet.ts','scripts/migrate-market-parquet.ts',
    'scripts/migrate-read-optimization.ts',
    'scripts/sync-entity-snapshots.ts',
]);
test('application and scheduled readers cannot import a raw Firestore client',()=>{
    const violations:string[]=[];
    const files=execFileSync('git',['ls-files','src','scripts'],{encoding:'utf8'}).trim().split('\n');
    for(const file of files.filter(file=>/\.(?:[cm]?[jt]sx?)$/.test(file))){
        if(rawClients.has(file)||file==='src/lib/firebase/client.ts')continue;
        const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
        for(const node of source.statements){
            if(!ts.isImportDeclaration(node)||!ts.isStringLiteral(node.moduleSpecifier))continue;
            if(!['firebase-admin','firebase-admin/firestore','@google-cloud/firestore','firebase/firestore'].includes(node.moduleSpecifier.text))continue;
            const clause=node.importClause;
            if(!clause||clause.isTypeOnly)continue;
            const bindings=clause.namedBindings;
            if(clause.name||bindings&&ts.isNamespaceImport(bindings)||bindings&&ts.isNamedImports(bindings)&&bindings.elements.some(
                name=>!name.isTypeOnly&&['getFirestore','Firestore'].includes((name.propertyName??name.name).text)))violations.push(file);
        }
    }
    assert.deepEqual(violations,[],'Use the shared Parquet-aware Firestore adapter, not a raw SDK client');
});
test('maintenance and usage inspection have no legacy payload source path',()=>{
    const sync=readFileSync('scripts/sync-entity-snapshots.ts','utf8');
    assert.doesNotMatch(sync,/snapshotSource|syncCollection|companyViewSnapshotFiles/);
    assert.match(sync,/legacy Firestore snapshot publication is retired/);
    const report=readFileSync('scripts/inspect-background-usage.mjs','utf8');
    assert.match(report,/from '\.\.\/src\/lib\/firebase\/firestore\.ts'/);
    assert.match(report,/finally \{ await db\.terminate\(\); \}/);
    for(const name of ['corporate-actions','entity-updated-at','instrument-onboarding']){
        const retired=readFileSync(`scripts/migrate-${name}.ts`,'utf8');
        assert.match(retired,/throw Error/);
        assert.doesNotMatch(retired,/from |\.collection\(|new Firestore|initializeApp/);
    }
});
test('ESM usage report can load the TypeScript CommonJS adapter without credentials',()=>{
    execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',
        "import market from './src/lib/firebase/firestore.ts'; if(typeof market.getFirestore!=='function'||!market.FieldPath)throw Error('Missing adapter exports');"],{stdio:'pipe'});
});
