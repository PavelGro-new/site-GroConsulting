import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const base='6a6407ea5feb32f25ded970f240832c62e7fd9f9';
const files=['index.html','zh/index.html','tax/index.html','zh/tax/index.html','tools/tax-calculator/index.html','tools/tax-calculator/zh/index.html','tools/currency-calculator/index.html','tools/currency-calculator/zh/index.html'];
const scripts=html=>[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!m[1].includes('application/ld+json')).map(m=>m[2].trim());
// Status-only DOM text changes are allowed; every other deployed script statement must match.
const withoutStatusText=script=>script.replace(/^.*els\.status\.textContent.*$/gm,'');
const approvedOverlay=text=>text.replaceAll('http://127.0.0.1:3100/api/lead','/api/lead')
 .replaceAll("const parseMoney = (str) => parseFloat(str.replace(/\\s/g, '')) || 0;","const parseMoney = (str) => parseFloat(str.replace(/[\\s,]/g, '')) || 0;")
 .replaceAll('const response = await fetch(toArchiveUrl(candidate), { cache: "no-store" });','let response; try { response = await fetch(toArchiveUrl(candidate), { cache: "no-store" }); } catch (_) { cursor.setDate(cursor.getDate() - 1); continue; }')
 .replaceAll('Сейчас показан последний доступный курс. Попробуйте обновить страницу позже.','Источник недоступен: показаны демонстрационные курсы на 01.08.2026, не актуальные курсы.')
 .replaceAll('当前显示最近可用汇率。请稍后刷新页面。','数据源不可用：显示的是 2026-08-01 的演示汇率，并非当前汇率。');
for(const file of files){
 const current=fs.readFileSync(path.join(root,file),'utf8');
 const previous=execFileSync('git',['show',base+':'+file],{cwd:root,encoding:'utf8'});
 assert.deepEqual(scripts(current).map(withoutStatusText),scripts(approvedOverlay(previous)).map(withoutStatusText),file+': scripts differ from deployed logic beyond status text');
 for(const [index,script] of scripts(current).entries())new vm.Script(script,{filename:file+':script'+index});
}
const svg=fs.readFileSync(path.join(root,'assets/edo/taxcom.svg'),'utf8');
const provenance=JSON.parse(fs.readFileSync(path.join(root,'assets/edo/taxcom-source.json'),'utf8'));
const paths=[...svg.matchAll(/\bd="([^"]+)"/g)].map(m=>m[1]);
assert.equal(crypto.createHash('sha256').update(paths.join('\n')).digest('hex'),provenance.pathDataSha256);
assert.ok(svg.includes('viewBox="0 0 194 24"')&&!svg.includes('<text'));
assert.ok(svg.includes('color="#2962ff"'));
for(const file of ['index.html','zh/index.html']){
 const text=fs.readFileSync(path.join(root,file),'utf8');assert.equal((text.match(/<img\b[^>]*\bsrc="\/assets\/logo\.svg"/g)||[]).length,2);
 assert.ok(fs.existsSync(path.join(root,'assets/logo.svg')));
}
const tax=fs.readFileSync(path.join(root,'zh/tax/index.html'),'utf8');
const parser=tax.match(/const parseMoney = \(str\) => ([^;]+);/)[0];
const parseMoney=new Function(parser+';return parseMoney;')();
for(const input of ['40,000,000','40\u00a0000\u00a0000','40000000'])assert.equal(parseMoney(input),40000000);
for(const file of ['tools/currency-calculator/index.html','tools/currency-calculator/zh/index.html']){
 const text=fs.readFileSync(path.join(root,file),'utf8');
 const start=text.indexOf('async function fetchWithFallback('),end=text.indexOf('function setLoading(',start);
 const fn=text.slice(start,end);
 const loadingStart=text.indexOf('function setLoading('),loadingEnd=text.indexOf('function showMessage(',loadingStart);
 const els={app:{classList:{toggle(){}}},status:{textContent:'verified date'}};
 const loading=new Function('els',text.slice(loadingStart,loadingEnd)+';return setLoading;')(els);
 loading(false);assert.equal(els.status.textContent,'verified date');
 loading(true);assert.notEqual(els.status.textContent,'verified date');
 const make=new Function('fetch','toInputDate','toArchiveUrl','dateFromIso',fn+';return fetchWithFallback;');
 const format=d=>d.toISOString().slice(0,10);const dates=[];
 const fallback=make(async d=>{dates.push(d);if(d==='2026-11-17')throw new TypeError('offline fixture');if(d==='2026-11-16')return{ok:false};return{ok:true,json:async()=>({Date:'2026-11-15T12:00:00Z',Valute:{}})};},format,d=>d,v=>v.slice(0,10));
 assert.equal((await fallback('2026-11-17')).actual,'2026-11-15');assert.equal(dates.length,3);
 let failures=0;const unavailable=make(async()=>{failures++;throw new TypeError('offline fixture');},format,d=>d,v=>v.slice(0,10));
 await assert.rejects(unavailable('2026-11-17'));assert.equal(failures,14);
}
console.log('PASS: calculations match deployed logic; syntax, official vector paths, logo links, number parsing, preserved date/status and bounded currency failure tested offline.');
