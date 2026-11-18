import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const base='ae5a74160b295f77671e20b957f507ee2ff537c7';
for(const file of ['index.html','zh/index.html']){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 const modal=html.slice(html.indexOf('<div id="lead-modal"'),html.indexOf('<script>',html.indexOf('<div id="lead-modal"')));
 assert.equal((modal.match(/type="submit"/g)||[]).length,1);
 assert.ok(modal.includes('lead-modal-fields')&&modal.includes('lead-modal-actions'));
 assert.ok(!html.includes('21 год опыта')&&!html.includes('21年市场经验'));
 const styles={},classes={},events={};
 const panel={style:{setProperty:(k,v)=>styles[k]=v},classList:{toggle:(k,v)=>classes[k]=v}};
 const viewport={height:800,offsetTop:0,addEventListener:(k,v)=>events[k]=v};
 const context={document:{getElementById:()=>panel},window:{innerHeight:800,visualViewport:viewport,addEventListener:(k,v)=>events['window-'+k]=v}};
 const block=html.match(/\/\/ OWNER_MOBILE_VIEWPORT_START([\s\S]*?)\/\/ OWNER_MOBILE_VIEWPORT_END/)[1];
 vm.createContext(context);vm.runInContext(block,context);context.syncLeadViewport();
 assert.equal(styles['--lead-viewport-height'],'800px');assert.equal(classes['lead-modal-compact'],false);
 // Android-style keyboard: only visual viewport shrinks; layout stays 800.
 viewport.height=320;viewport.offsetTop=42;events.resize();
 assert.equal(context.window.innerHeight,800);assert.equal(styles['--lead-viewport-height'],'320px');assert.equal(styles['--lead-viewport-top'],'42px');assert.equal(classes['lead-modal-compact'],true);
 viewport.offsetTop=55;events.scroll();assert.equal(styles['--lead-viewport-top'],'55px');
 context.window.visualViewport=null;context.window.innerHeight=640;events['window-resize']();assert.equal(styles['--lead-viewport-height'],'640px');assert.equal(styles['--lead-viewport-top'],'0px');
 const before=execFileSync('git',['show',base+':'+file],{cwd:root,encoding:'utf8'});
 const tariffBlock=t=>t.slice(t.indexOf('const tariffsData ='),t.indexOf('function tariffCalcInit()'));
 assert.equal(tariffBlock(html),tariffBlock(before),'Tariffs/options/calculation rules must remain byte-identical');
}
for(const file of ['tools/currency-calculator/index.html','tools/currency-calculator/zh/index.html']){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 const before=execFileSync('git',['show',base+':'+file],{cwd:root,encoding:'utf8'});
 // Compare the complete existing currency script, not just chosen formulas.
 const scripts=t=>[...t.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1].trim()).filter(s=>!s.includes('OWNER_CURRENCY_DISCLOSURE_START'));
 assert.deepEqual(scripts(html),scripts(before));
 const panel={open:true},query={matches:true,addEventListener:(key,callback)=>{assert.equal(key,'change');query.callback=callback;}};
 const context={document:{getElementById:()=>panel},window:{matchMedia:()=>query}};
 vm.runInNewContext(html.match(/\/\/ OWNER_CURRENCY_DISCLOSURE_START([\s\S]*?)\/\/ OWNER_CURRENCY_DISCLOSURE_END/)[1],context);
 assert.equal(panel.open,false);panel.open=true;assert.equal(panel.open,true);query.matches=false;query.callback();assert.equal(panel.open,true);query.matches=true;query.callback();assert.equal(panel.open,false);
}
for(const file of ['tax/index.html','zh/tax/index.html','tools/tax-calculator/index.html','tools/tax-calculator/zh/index.html','assets/logo.svg','assets/edo/taxcom.svg']){
 assert.equal(fs.readFileSync(path.join(root,file),'utf8'),execFileSync('git',['show',base+':'+file],{cwd:root,encoding:'utf8'}),file+' must not change');
}
console.log('PASS: viewport-only keyboard/offset/fallback, single submit, disclosure breakpoints, exact tariffs/currency script, untouched tax and logos.');
