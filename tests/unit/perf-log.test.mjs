import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createPerfLog,logDirectory} from '../../src/app/perf-log.cjs';
async function directory(){await mkdir('build',{recursive:true});return mkdtemp(path.resolve('build/perf-log-test-'));}
test('ordered async batches create their directory before the first session record',async()=>{
 const dir=path.join(await directory(),'new','logs'),log=createPerfLog(dir);
 log.write({t:1,e:'session'});const first=log.flush();log.write({t:2,e:'perf'});const second=log.flush();
 await Promise.all([first,second]);await log.close();
 assert.deepEqual((await readFile(log.file,'utf8')).trim().split('\n').map(JSON.parse),[{t:1,e:'session',n:1},{t:2,e:'perf',n:2}]);
 assert.equal(log.status().error,null);
});
test('byte limit is explicit and later records are not accepted',async()=>{
 const log=createPerfLog(await directory(),{maxBytes:120});for(let i=0;i<50;i++)log.write({t:i,e:'perf',n:i});
 await log.flush();const before=await readFile(log.file,'utf8');assert.match(before,/"e":"cap"/);
 assert.equal(log.write({t:999,e:'perf'}),false);await log.close();assert.equal(await readFile(log.file,'utf8'),before);
});
test('write failure is surfaced and does not pretend the bytes were saved',async()=>{
 const errors=[],log=createPerfLog(await directory(),{onError:e=>errors.push(e),append:async()=>{throw Object.assign(Error('denied'),{code:'EACCES'});}});
 log.write({e:'session'});await log.flush();assert.equal(log.status().writtenBytes,0);assert.deepEqual(errors,['EACCES']);assert.equal(log.write({e:'perf'}),false);
});
test('an unwritable directory reports failure without falling back elsewhere',async()=>{
 const dir=await directory(),file=path.join(dir,'file');await writeFile(file,'not a directory');
 const log=createPerfLog(path.join(file,'logs'));log.write({e:'session'});await log.close();assert.ok(log.status().error);assert.equal(log.status().writtenBytes,0);
});
test('packaged logs follow executable, not cwd or profile; development logs stay in project',()=>{
 const root=path.resolve('build/project'),executable=path.resolve('build/portable/OwlSight.exe');
 assert.equal(logDirectory({packaged:true,root,executable}),path.resolve('build/portable/logs'));
 assert.equal(logDirectory({packaged:false,root,executable}),path.join(root,'logs'));
});
test('same-time sessions never overwrite each other and close drains pending writes',async()=>{
 const dir=await directory(),now=()=>new Date(0),a=createPerfLog(dir,{now}),b=createPerfLog(dir,{now});assert.notEqual(a.file,b.file);
 a.write({e:'session-end'});await a.close();assert.match(await readFile(a.file,'utf8'),/session-end/);await b.close();
});
