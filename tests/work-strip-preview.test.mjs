import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWorkStripPreview} from '../scripts/preview-work-strip.mjs';
const preview=await createWorkStripPreview({stepMs:20});
const {core,runtime,manager}=preview;
const {visibleWidth}=await import(pathToFileURL(preview.tuiPath));
const {theme,initTheme}=await import(pathToFileURL(path.join(preview.agentRoot,'dist/modes/interactive/theme/theme.js')));
initTheme('dark',false);
const strip=s=>s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g,'');
const errors=[];
runtime.session.extensionRunner.onError(error=>errors.push(error));
const ui=new core.InteractiveMode(runtime,{tuiMode:'fullscreen'});
ui.updateTerminalTitle=()=>{};
Object.defineProperty(ui.ui,'isFollowingOutput',{get:()=>true});
const inputs=[];
runtime.session.extensionRunner.setUIContext({...ui.createExtensionUIContext(),theme,onTerminalInput(fn){inputs.push(fn);return()=>{};},setHiddenThinkingLabel(){},setStatus(){},setWidget(){},notify(){}},'tui');
const paint=()=>strip(ui.chatContainer.render(110).join('\n'));
let off, offLive;
try{
  // Native reload ordering: replay first, extension session_start second.
  ui.renderSessionEntries(manager.getBranch());
  await runtime.session.extensionRunner.emit({type:'session_start',reason:'resume'});
  // Native startup refreshes the UI after extension session_start. Rebuild
  // cached custom-message renderers too, as the terminal's invalidation does.
  ui.chatContainer.invalidate();
  const before=paint();
  const lines=before.split('\n');
  const dddLine=lines.findIndex(line=>line.includes('DDD · Five recorded maintenance'));
  assert.equal(lines[dddLine-1].trim(),'','DDD has the same one-line separation as decision rows');
  const projected=ui.chatContainer[Symbol.for('compact-renderer:projected-children:v1')];
  const canonical=ui.chatContainer.children;
  const skill=canonical.find(row=>row.constructor.name==='SkillInvocationMessageComponent');
  const skillPosition=projected.indexOf(skill);
  assert.ok(skillPosition>0,'native skill remains the combined prompt anchor');
  assert.equal(projected[skillPosition-1],canonical[canonical.indexOf(skill)-1],'folding preserves the outside gap before the combined prompt');
  const combined = strip(skill.render(110).join('\n'));
  assert.match(combined, /▸ \/skill:fixture-review/);
  assert.match(combined, /Show the native skill card and one final successful action/);
  assert.doesNotMatch(combined, /\[skill\]|ctrl\+o|Review the synthetic preview/);
  assert.equal((before.match(/Show the native skill card and one final successful action/g)||[]).length,1,'combined user text appears exactly once');
  const promptFill = theme.bg('userMessageBg', '').replace(/\x1b\[49m$/, '');
  assert.ok(skill.render(110).every(line => line.includes(promptFill)), 'combined skill and message share the blue prompt surface');
  skill.handleMouse({type:'click',button:'left',x:3,y:1,width:110});
  assert.match(strip(skill.render(110).join('\n')), /Review the synthetic preview/, 'click reveals the recorded skill body');
  skill.handleMouse({type:'click',button:'left',x:3,y:1,width:110});
  for(let i=1;i<projected.length;i++) if(projected[i] instanceof core.UserMessageComponent) {
    assert.equal(projected[i-1].constructor.name,'Spacer','next prompt keeps an outside gap after folded work');
  }
  const header=projected.find(row=>row.constructor.name==='WorkStripHeader');
  assert.ok(header.render(110).join('\n').includes(theme.fg('muted','▸ '+header.title)),'work-strip label uses quiet secondary contrast');
  assert.match(strip(header.render(110).join('\n')),/Worked for.*─{4}/,'work strip has a visible divider');
  for(const width of [1,2,4,20,80,160]) for(const line of header.render(width)) assert.ok(visibleWidth(line)<=width,'divider stays within the terminal width');
  header.render(110);
  assert.equal(header.handleMouse({type:'click',button:'left',x:30,y:1})?.handled,true,'divider is part of the disclosure target');
  assert.equal(header.open,true);
  header.handleMouse({type:'click',button:'left',x:30,y:1});
  assert.equal((before.match(/▸ Worked for/g)||[]).length,3);
  assert.match(before,/Question · Answered/); assert.match(before,/DDD · Five recorded maintenance/);
  const workColumn = lines.find(line => line.includes('Worked for')).search(/\S/);
  for (const label of ['Question · Answered', 'worker · Decision answered', 'Subagent · researcher', 'Subagent · scout', 'DDD · Five recorded maintenance']) {
    const row = lines.find(line => line.includes(label));
    assert.ok(row, `preview includes ${label}`);
    assert.equal(row.search(/\S/), workColumn + 2, `${label} is indented beneath the collapsed work strip`);
  }
  assert.doesNotMatch(before,/Run Node.js script|Subagent workflow|Synthetic instruction 70|Read files/);
  assert.match(before,/Work-strip preview/);
  assert.match(before,/⋯ Show more/,'long prompt has generic quiet disclosure');
  assert.match(before,/Do not execute tools or access any external data/,'long prompt keeps its ending');
  assert.doesNotMatch(before,/Preserve recorded sample 1,/,'opening excerpt does not expose a partial list');
  const neutral = theme.bg('toolPendingBg', '').replace(/\x1b\[49m$/, '');
  for (const label of ['Recorded preview decisions', 'Work-strip preview:', 'This direct reply has no work strip']) {
    const line = ui.chatContainer.render(110).find(row => strip(row).includes(label));
    assert.ok(line && !line.includes(neutral), `${label} keeps the native reply surface in the real runtime`);
  }
  // Final mixed thinking is folded, while final Markdown remains native.
  ui.isInitialized=true;
  off=runtime.session.subscribe(event=>ui.handleEvent(event));
  const live=[];
  offLive=runtime.session.subscribe(event=>{
    if(!['message_start','message_end'].includes(event.type) || event.message.role!=='assistant')return;
    const label=event.message.content.find(block=>block.type==='text' && block.text)?.text;
    if(!label)return;
    const rendered=paint().split('\n');
    const projected=ui.chatContainer[Symbol.for('compact-renderer:projected-children:v1')];
    const row=ui.chatContainer.children.findLast(row=>row instanceof core.AssistantMessageComponent);
    const view=projected.find(item=>item===row || item.children?.[0]===row);
    live.push({type:event.type,label,row,view,column:rendered.findLast(line=>line.includes(label.slice(0,40)))?.search(/\S/)});
  });
  const playing=preview.play();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.match(paint(),/Working · 0s · Reading the recorded sample labels/);
  assert.match(paint(),/Reading the recorded sample labels/);
  if(process.env.PI_PREVIEW_STATUSLINE) {
    assert.ok(ui.customFooter,'matching native footer mounted');
    assert.doesNotMatch(strip(ui.customFooter.render(160).join('\n')),/Working ·/,'work strip owns execution status');
  }
  await playing; await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(live.length,8,'all four invented replies render during streaming and after message_end');
  for(const frame of live) {
    assert.equal(frame.view?.constructor.name,'WorkChild',`${frame.label} stays indented during ${frame.type}`);
    assert.equal(frame.column,workColumn+2,'live commentary uses the same child column as recorded work');
  }
  for(let i=0;i<live.length;i+=2) assert.equal(live[i].view,live[i+1].view,'message_end does not shift the current reply');
  const after=paint();
  assert.equal((after.match(/▸ Worked for/g)||[]).length,4);
  assert.doesNotMatch(after,/Comparing the recorded units|Checking the recorded result|Compare the invented samples|Thinking/);
  assert.match(after,/The invented samples agree/);
  const settledRow = ui.chatContainer.render(110).find(row => strip(row).includes('The invented samples agree'));
  assert.ok(settledRow && !settledRow.includes(neutral), 'live final reply keeps the native surface after settlement');
  assert.equal(manager.getBranch().filter(e=>e.customType==='compact-renderer:work-settled:v1').length,4);
  assert.deepEqual(errors,[]);
  console.log('Work strip real runtime preview, native reload order, live playback and final folding passed');
}finally{offLive?.(); off?.(); ui.ui.stop(); await preview.cleanup(); ui.footerDataProvider.dispose();}
