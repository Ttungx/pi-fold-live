import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSource,core,themeModule,stripAnsi } from './test-runtime.mjs';
const { registerModernPrompts,modernPromptTemplates,matchingModernPrompt,modernPromptSummary }=await loadSource('./modern-prompts.ts');
const { installModernPromptAdapter }=await loadSource('./modern-prompts-adapter.ts');
const { createDisplayMode }=await loadSource('./display-mode.ts');
const { UserMessageComponent }=core;
const dir=mkdtempSync(join(tmpdir(),'compact-prompts-'));
const path=join(dir,'fixture.md');
const prefix='These are the original long template instructions; keep every source character.\n\n';
const source=`---\ndescription: fixture\n---\n${prefix}Target: $1\n\nEnd of the original instructions.`;
writeFileSync(path,source);
const original=`${prefix}Target: sample 行🙂\n\nEnd of the original instructions.`;
const commands=[{source:'prompt',name:'fixture',description:'Inspect fixture cards and their keyboard controls.',sourceInfo:{path}}];
const listeners=new Map(),bus=new Map(),terminal=new Set(),transformers=[];
const subscribe=(map,key,fn)=>{const set=map.get(key)||new Set();map.set(key,set);set.add(fn);return()=>set.delete(fn);};
const pi={on:(event,fn)=>subscribe(listeners,event,fn),events:{on:(event,fn)=>subscribe(bus,event,fn),emit:(event,data)=>{for(const fn of [...bus.get(event)||[]])fn(data);}},getCommands:()=>commands,registerMarkdownTransformer:fn=>transformers.push(fn)};
const mode=createDisplayMode();let redraws=0;
const ctx={mode:'tui',ui:{setHiddenThinkingLabel(){redraws++;},onTerminalInput(fn){terminal.add(fn);return()=>terminal.delete(fn);}}};
const emit=(event,data={})=>{for(const fn of [...listeners.get(event)||[]])fn(data,ctx);};
const key=data=>[...terminal].some(fn=>fn(data)?.consume);
const plain=card=>card.render(100).map(stripAnsi).join('\n');
const native={render:UserMessageComponent.prototype.render,mouse:UserMessageComponent.prototype.handleMouse};
let dispose=registerModernPrompts(pi,mode);
try{
  emit('session_start',{type:'session_start',reason:'startup'});
  const card=new UserMessageComponent(original,themeModule.getMarkdownTheme(),1,transformers);
  const ordinary=new UserMessageComponent('Ordinary visible user prompt',themeModule.getMarkdownTheme(),1,transformers);
  assert.match(plain(card),/prompt · \/fixture/);assert.ok(!plain(card).includes('original long template'));
  assert.match(plain(ordinary),/Ordinary visible user prompt/);
  assert.match(plain(card),/Inspect fixture cards and their keyboard controls\./, 'collapsed template includes its authored description');
  assert.equal(modernPromptSummary('First recorded sentence. More details.'), 'First recorded sentence.');
  assert.equal(modernPromptSummary('ignored', 'Specific authored summary'), 'Specific authored summary');
  assert.ok(modernPromptSummary('x'.repeat(1000000)).length <= 111, 'fallback excerpt is bounded');
  assert.doesNotMatch(modernPromptSummary('\x1b[31m unsafe\u202e title'), /[\x1b\u202e]/);
  const savedDescription=commands[0].description; commands[0].description='Use **literal** labels <tag> and `code`.';emit('session_tree');
  assert.match(plain(card),/Use literal labels <tag> and code\./, 'summary uses native inline Markdown without adding escape characters');
  commands[0].description=savedDescription;emit('session_tree');plain(card);
  assert.equal(key('\r'),false);assert.equal(key('\x1bi'),true);assert.equal(key('\r'),true);
  assert.match(plain(card),/original long template instructions/);assert.match(plain(card),/sample 行🙂/);
  assert.equal(card.text,original,'native recorded source stays exact');
  assert.equal(key('\x1b[B'),false,'native arrows remain available for expanded prompt scrolling');
  assert.equal(key('\x1b'),false,'forwarded arrow releases prompt inspection');assert.equal(key('\r'),false);
  card.handleMouse({type:'click',button:'left',y:1,x:2,width:100,height:20});assert.ok(!plain(card).includes('original long template'));
  // Identical expanded templates remain independent cards.
  const second=new UserMessageComponent(original,themeModule.getMarkdownTheme(),1,transformers);plain(second);
  second.handleMouse({type:'click',button:'left',y:1,x:2,width:100,height:20});
  assert.match(plain(second),/original long template/);assert.ok(!plain(card).includes('original long template'));
  key('\x1bi');pi.events.emit('compact-renderer:focus:v1',{owner:'thinking'});assert.equal(key('\r'),false);
  key('\x1bi');emit('ui_prompt_start');assert.equal(key('\r'),false);
  mode.setEnabled(false);assert.match(plain(card),/original long template/);assert.ok(!plain(card).includes('prompt · /fixture'));
  mode.setEnabled(true);assert.ok(!plain(card).includes('original long template'));
  const staleChoices=[];pi.events.emit('compact-renderer:inspect:v1',{add:choice=>staleChoices.push(choice)});
  emit('session_tree');plain(card);staleChoices[0].focus();
  assert.equal(key('\r'),false,'a stale picker choice cannot capture Enter after rebuilding the same component');
  const freshChoices=[];pi.events.emit('compact-renderer:inspect:v1',{add:choice=>freshChoices.push(choice)});
  freshChoices[0].focus();assert.match(plain(card),/Esc returns/);assert.equal(key('\x1b'),true);
  for(const event of ['session_tree','session_compact']){emit(event);assert.match(plain(card),/prompt · \/fixture/);assert.equal(terminal.size,1);}
  for(const reason of ['reload','new','resume','fork','startup']){
    emit('session_start',{type:'session_start',reason});assert.match(plain(card),/prompt · \/fixture/);assert.equal(terminal.size,1);
  }
  // Transformer alone cannot collapse a card with an unknown native shape.
  const unknown=new UserMessageComponent(original,themeModule.getMarkdownTheme(),1,transformers);
  assert.match(plain(unknown),/prompt · \/fixture/);
  unknown.children.push({render:()=>[],invalidate(){}});assert.match(plain(unknown),/original long template/);
  emit('session_shutdown');assert.equal(terminal.size,0);assert.match(plain(card),/original long template/,'shutdown restores the original content');
  const resumedCard=new UserMessageComponent(original,themeModule.getMarkdownTheme(),1,transformers);
  assert.match(plain(resumedCard),/original long template/,'a prebuilt card stays native before session_start');
  emit('session_start',{type:'session_start',reason:'resume'});assert.match(plain(resumedCard),/prompt · \/fixture/,'initial resumed render invalidates prebuilt native Markdown');plain(card);assert.equal(terminal.size,1);
  dispose();dispose();assert.equal(terminal.size,0);assert.deepEqual({render:UserMessageComponent.prototype.render,mouse:UserMessageComponent.prototype.handleMouse},native);
  assert.match(plain(card),/original long template/);assert.equal(card.text,original);
  dispose=registerModernPrompts(pi,mode);emit('session_start',{type:'session_start',reason:'startup'});assert.match(plain(card),/prompt · \/fixture/);
  const staleDispose=dispose;dispose=registerModernPrompts(pi,mode);assert.equal(terminal.size,0,'replacement registration disposes the prior input listener');emit('session_start',{type:'session_start',reason:'startup'});assert.equal(terminal.size,1);staleDispose();assert.equal(terminal.size,1);
  assert.match(plain(card),/prompt · \/fixture/);dispose();
  { const cleanup = installModernPromptAdapter({render(){},mouse(){}},'1.1.0'); assert.equal(typeof cleanup, 'function'); cleanup(); }
  { const cleanup = installModernPromptAdapter({render(){},mouse(){}},'9.0.0'); assert.equal(typeof cleanup, 'function'); cleanup(); }
  const templates=modernPromptTemplates(commands);assert.equal(matchingModernPrompt(original,templates),'fixture');assert.equal(matchingModernPrompt('Unrelated prompt',templates),undefined);
  assert.equal(modernPromptTemplates([...commands,{source:'extension',name:'fixture'}]).length,0);
  assert.equal(modernPromptTemplates([{...commands[0],sourceInfo:{path:join(dir,'missing')}}]).length,0);
  assert.equal(matchingModernPrompt('x'.repeat(200001),templates),undefined);
  assert.ok(redraws>0);console.log('modern prompts: public display transformer, native inline expansion, keyboard, lifecycle, unknown-shape fallback, and exact sources passed');
}finally{dispose();rmSync(dir,{recursive:true,force:true});}
