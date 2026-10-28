#!/usr/bin/env node
// Synthetic playback through native UI/lifecycle events. This never invokes an
// agent loop, tool executor, model, shell, network, or another user's session.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreview } from './preview.mjs';

export async function createWorkStripPreview({ stepMs = 1000, inspection = false, actionGroups = false } = {}) {
  const old = process.env.PI_PREVIEW_WORK_STRIP;
  process.env.PI_PREVIEW_WORK_STRIP = '1';
  const preview = await createPreview();
  const { manager, runtime, eventBus } = preview;
  let stopped = false, playing = false;
  const waits = new Map();
  const delay = ms => new Promise(resolve => { const id = setTimeout(() => { waits.delete(id); resolve(); }, ms); waits.set(id, resolve); });
  const base = Date.now();
  const assistant = value => ({role:'assistant',content:[{type:'text',text:value}],timestamp:Date.now(),stopReason:'stop',api:'openai-codex-responses',provider:'openai-codex',model:'gpt-6-luna',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
  manager.appendCustomMessageEntry('ddd', 'Five recorded maintenance reminders.\n\nThis invented notice has no severity metadata. It stays visible as a compact row. Expand it to inspect this complete text.', true);
  manager.appendMessage(assistant('Work-strip preview: intermediate content is folded; final replies and decisions remain visible. /inspect or a click opens a strip. Use /fold collapse or /fold expand for explicit control; Ctrl+Alt+W toggles completed work. Run /fixture-work to play 10 seconds of invented progress. Each live reply stays indented until the final reply is confirmed. Scroll up before it finishes to test deferred folding, or manually open its strip to keep it open. /prompt-jump end returns to the latest output. No model or tool runs.'));
  const entries = manager.getBranch();
  const users = entries.map((entry,index)=>entry.message?.role==='user'?index:-1).filter(index=>index>=0);
  for (const [number,start] of users.entries()) {
    const end = (users[number+1] ?? entries.length)-1;
    const final = entries.slice(start+1,end+1).findLast(entry=>entry.message?.role==='assistant' && entry.message.content.some(block=>block.type==='text' && block.text.trim()));
    if (final) manager.appendCustomEntry('compact-renderer:work-settled:v1',{version:1,userId:entries[start].id,finalId:final.id,endId:entries[end].id,startedAt:base-90000,endedAt:base-30000+number*1000,outcome:'completed'});
  }
  manager.appendMessage({role:'user',content:[
    'Long submitted prompt: inspect these invented renderer requirements.',
    '',
    ...Array.from({length:10},(_,i)=>`${i+1}. Preserve recorded sample ${i+1}, its unit, and its original wording.`),
    '',
    'This is a display fixture. Do not execute tools or access any external data.',
  ].join('\n'),timestamp:Date.now()});
  manager.appendMessage(assistant('This direct reply has no work strip. Expand the prompt above to inspect all ten recorded requirements.'));
  if (inspection) {
    manager.appendMessage({role:'user',content:'Inspection regression preview: expand the work, then click more in the recorded code output and the three-round thinking group.',timestamp:Date.now()});
    const userId = manager.getBranch().at(-1).id;
    for (let i = 1; i <= 2; i++) {
      const name = i === 1 ? 'read' : 'codemode';
      const args = i === 1 ? {path:'/fixture/recorded.txt'} : {code:'text(await tools.read({ path: "/fixture/recorded.txt" }));'};
      const call = assistant(''); call.stopReason = 'toolUse';
      call.content = [{type:'thinking',thinking:`Review recorded sample ${i}.\n\n` + Array.from({length:45},(_,n)=>`Round ${i}, recorded line ${n+1}. This is invented fixture text.`).join('\n')}, {type:'toolCall',id:`inspection-${i}`,name,arguments:args}];
      manager.appendMessage(call);
      manager.appendMessage({role:'toolResult',toolCallId:`inspection-${i}`,toolName:name,content:[{type:'text',text:Array.from({length:60},(_,n)=>`Recorded output ${n+1}`).join('\n')}],details:i===2?{calls:[{name:'read',args:JSON.stringify({path:'/fixture/recorded.txt'}),status:'ok',durationMs:1}]}:{},isError:false,timestamp:Date.now()});
    }
    const final = assistant('Inspection result: the final thinking belongs to the same three-round group. Clicking more advances the recorded output. This answer stays outside the group. No tools or model ran.');
    final.content.unshift({type:'thinking',thinking:'Finalize the recorded result.\n\n' + Array.from({length:45},(_,n)=>`Final round, recorded line ${n+1}. This is invented fixture text.`).join('\n')});
    manager.appendMessage(final);
    const finalId = manager.getBranch().at(-1).id;
    manager.appendCustomEntry('compact-renderer:work-settled:v1',{version:1,userId,finalId,endId:finalId,startedAt:base-90000,endedAt:base,outcome:'completed'});
  }
  if (actionGroups) {
    manager.appendMessage({role:'user',content:'Compare mixed action groups: successful bash, codemode, and file calls belong together. Keep nested failures visible.',timestamp:Date.now()});
    const userId = manager.getBranch().at(-1).id;
    const recorded = (id, name, args, text, calls = []) => {
      const call = assistant(''); call.stopReason = 'toolUse';
      call.content = [{type:'toolCall',id,name,arguments:args}];
      manager.appendMessage(call);
      manager.appendMessage({role:'toolResult',toolCallId:id,toolName:name,content:[{type:'text',text}],details:name==='codemode'?{calls}:{},isError:false,durationMs:12,timestamp:Date.now()});
    };
    const code = (id, status = 'ok') => recorded(id, 'codemode', {code:'text(await tools.read({ path: "/fixture/units.txt" }));'}, 'Recorded units: kg/L. No file was read.', [{name:'read',args:'{"path":"/fixture/units.txt"}',status,durationMs:3,...(status==='error'?{error:'Invented missing-file warning, handled by the script.'}:{})}]);
    recorded('mixed-bash', 'bash', {command:'printf "recorded sample"'}, 'Recorded shell output. No command ran.');
    code('mixed-code-a'); code('mixed-code-b');
    recorded('mixed-read', 'read', {path:'/fixture/summary.txt'}, 'Recorded summary.');
    manager.appendMessage(assistant('The four calls above form one group. Each codemode counts once and retains its nested source, calls, and output. This reply separates the next group, which starts with codemode.'));
    code('mixed-code-first');
    recorded('mixed-write', 'write', {path:'/fixture/report.txt',content:'Recorded report.'}, 'Successfully wrote to /fixture/report.txt');
    code('mixed-nested-warning', 'error');
    manager.appendMessage(assistant('Mixed-action preview: expand the work, then the 4-action and 2-action groups. Open codemode to inspect its recorded content. The nested-error card stays separate. Test /fold collapse, Ctrl+Alt+W, /inspect, and Esc. All content is invented; no tool or model ran.'));
    const finalId = manager.getBranch().at(-1).id;
    manager.appendCustomEntry('compact-renderer:work-settled:v1',{version:1,userId,finalId,endId:finalId,startedAt:base-45000,endedAt:base,outcome:'completed'});
  }
  const emit = async event => {
    if (stopped) return;
    runtime.session._emit(event);
    await runtime.session.extensionRunner.emit(event);
  };
  const message = async value => {
    if (stopped) return;
    await emit({type:'message_start',message:value});
    manager.appendMessage(value);
    await emit({type:'message_end',message:value});
  };
  const play = async notify => {
    if (playing) { notify?.('The invented recording is already playing.'); return; }
    playing = true;
    try {
      await emit({type:'agent_start'});
      await message({role:'user',content:'Invented playback: inspect the recorded samples.',timestamp:Date.now()});
      const call = assistant('');
      const toolCallId = `fixture-read-${Date.now()}`;
      call.content = [{type:'toolCall',id:toolCallId,name:'read',arguments:{path:'/fixture/sample-a.txt'}}]; call.stopReason = 'toolUse';
      await message(call);
      await message({role:'toolResult',toolCallId,toolName:'read',content:[{type:'text',text:'Synthetic sample: 3 kg'}],isError:false,timestamp:Date.now()});
      await message(assistant('Reading the recorded sample labels.'));
      await delay(3 * stepMs); if(stopped)return;
      await message(assistant('Comparing the recorded units.'));
      await delay(3 * stepMs); if(stopped)return;
      await message(assistant('Checking the recorded result.'));
      await delay(3 * stepMs); if(stopped)return;
      const final = assistant('The invented samples agree. This final reply remains visible after the work strip folds. Nothing was executed.');
      final.content.unshift({type:'thinking',thinking:'Compare the invented samples. This recorded reasoning belongs inside the completed work strip.'});
      await message(final);
      await delay(stepMs); if(stopped)return;
      await emit({type:'agent_end',messages:[]});
      await emit({type:'agent_settled',aborted:false});
    } catch (error) { notify?.(`Preview playback stopped: ${error.message}`); }
    finally {playing=false;}
  };
  const off = eventBus.on('preview:work-strip-run:v1', request=>{void play(request?.notify);});
  return {...preview, play, cleanup:async()=>{
    stopped=true; off(); for(const [id,resolve] of waits){clearTimeout(id);resolve();} waits.clear();
    await preview.cleanup();
    if(old===undefined)delete process.env.PI_PREVIEW_WORK_STRIP;else process.env.PI_PREVIEW_WORK_STRIP=old;
  }};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const preview=await createWorkStripPreview(); let ui;
  try { ui=new preview.core.InteractiveMode(preview.runtime,{tuiMode:'fullscreen'}); await ui.run(); }
  finally { ui?.stop(); await preview.cleanup(); }
}
