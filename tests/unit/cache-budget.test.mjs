import test from 'node:test';
import assert from 'node:assert/strict';
import {CacheBudget} from '../../src/app/cache-budget.cjs';
const G=1024**3,M=1024**2;
test('auto budget uses system size, manual budget remains an upper limit',()=>{
 const c=new CacheBudget();assert.equal(c.update(32*G,16*G).budget,4*G);
 c.preference='8';assert.equal(c.update(32*G,16*G,0,true).budget,8*G);
 const limited=c.update(32*G,4*G,0);assert.ok(limited.budget< G);assert.equal(limited.adjusted,true);
});
test('pressure reclaims occupied cache without waiting for a restart',()=>{
 const c=new CacheBudget('4');c.update(32*G,16*G);
 const result=c.update(32*G,1*G,3*G);
 assert.ok(result.budget<=0.81*G);assert.ok(result.budget>=128*M);
 assert.equal(c.preference,'4');
});
test('recovery waits for sustained headroom and grows gradually',()=>{
 const c=new CacheBudget('4');c.update(32*G,16*G);const low=c.update(32*G,1*G,3*G).budget;
 for(let i=0;i<4;i++)assert.equal(c.update(32*G,16*G,0).budget,low);
 assert.equal(c.update(32*G,16*G,0).budget,low+256*M);
});
test('invalid persisted preference falls back to auto and pressure budget stays bounded',()=>{
 const c=new CacheBudget('garbage');assert.equal(c.preference,'auto');assert.equal(c.update(8*G,0,0).budget,128*M);
});
