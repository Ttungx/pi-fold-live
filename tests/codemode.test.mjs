import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSource, loadAgent, themeModule, stripAnsi, tui, backgroundCells } from './test-runtime.mjs';
const { registerModernTools, toolStatus } = await loadSource('./modern-tools.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { CodePane } = await loadSource('./modern-code-pane.ts');
const { WorkChild } = await loadSource('./work-strip-view.ts');
const stylePane = new CodePane(() => 12);
stylePane.heading = 'codemode · Read files';
stylePane.title = `${stylePane.heading} · 2 nested calls · 1 nested error`;
stylePane.theme = Object.assign(Object.create(themeModule.theme), { bold: text => `\x1b[1m${text}\x1b[22m` });
stylePane.tone = 'warning';
assert.doesNotMatch(stylePane.render(100)[0], /\x1b\[1m/, 'codemode category and intent use normal weight beside a warning');
assert.ok(stylePane.render(100)[0].includes(themeModule.theme.fg('syntaxVariable', '▸ codemode')), 'only codemode category retains teal');
assert.ok(stylePane.render(100)[0].includes(themeModule.theme.fg('muted', ' · Read files')), 'codemode intent uses muted text');
assert.ok(stylePane.render(100)[0].includes(themeModule.theme.fg('warning', ' · 1 nested error')), 'nested warning keeps its distinct color');
stylePane.tone = 'error'; assert.match(stylePane.render(100)[0], /\x1b\[1m/, 'failed codemode retains its weight');
const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const { installModernToolImages } = await loadSource('./modern-tool-images.ts');
const { codemodeRenderers } = await loadAgent('extensions/codemode/renderer.js');
const { readRenderers } = await loadAgent('core/tools/renderers/read.js');
const hooks = new Map(), bus = new Map(); let resolver, input;
const pi = {
 registerToolRenderer(fn) { resolver = fn; },
 on(event, fn) { const set = hooks.get(event) || new Set(); set.add(fn); hooks.set(event, set); return () => set.delete(fn); },
 events: { on(name, fn) { bus.set(name, fn); return () => bus.delete(name); }, emit(name, data) { bus.get(name)?.(data); } },
};
const originalToolRender=ToolExecutionComponent.prototype.render;
{ const cleanup = installModernToolImages('1.5.0'); assert.equal(typeof cleanup, 'function'); cleanup(); }
assert.equal(ToolExecutionComponent.prototype.render,originalToolRender);
const mode = createDisplayMode(), dispose = registerModernTools(pi, mode);
const ctx = { hasUI: true, sessionManager: { getBranch: () => [] }, ui: { onTerminalInput(fn) { input = fn; return () => { input = undefined; }; } } };
const event = (name, data = {}) => { for (const fn of hooks.get(name) || []) fn(data, ctx); };
const create = (name, id, args, native, adjacent = false) => {
 // These fixtures inspect independent panes. Mixed adjacency has its own assertions below.
 if (!adjacent) event('message_end', { message: { role: 'assistant', content: [{ type: 'text', text: `Fixture ${id}` }] } });
 const component = new ToolExecutionComponent(name, id, args, { showImages: false, outputPad: 0 }, resolver(name, () => native), { requestRender() {} }, '/tmp'); component.setArgsComplete(); return component;
};
const result = text => ({ content: [{ type: 'text', text }] });
const paint = component => stripAnsi(component.render(140).join('\n'));
const mouse = (component, type, y, wheelDelta) => component.handleMouse({ type, button: type === 'wheel' ? 'none' : 'left', x: 2, y, screenX: 2, screenY: y, width: 140, height: component.render(140).length, shift: false, alt: false, ctrl: false, wheelDelta });
// Valid grayscale PNGs exercise native dimension parsing and protocol encoding.
const pngFixture = (width, height) => {
 const chunk = (name, data) => {
  const type = Buffer.from(name), crcData = Buffer.concat([type,data]);let crc=0xffffffff;
  for(const byte of crcData){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const size=Buffer.alloc(4), checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,type,data,checksum]);
 };
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width+1)*height))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
};
const kittySize = line => {
 const fields=Object.fromEntries(line.match(/\x1b_G([^;]+);/)[1].split(',').map(field=>field.split('=')));
 return {columns:Number(fields.c),rows:Number(fields.r)};
};
event('session_start');
try {
 assert.notEqual(resolver('codemode', () => codemodeRenderers), codemodeRenderers, 'code gets its own compact wrapper');
 const first = create('read', 'before-code', { path: '/fixture/before' }, readRenderers); first.updateResult(result('first'));
 event('message_end', { message: { role: 'assistant', content: [{ type: 'toolCall', id: 'code', name: 'codemode', arguments: { code: 'text(1);' } }] } });
 const code = create('codemode', 'code', { code: 'const value = await tools.read({path: "/fixture"});\ntext(value);' }, codemodeRenderers);
 const originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval, intervals = new Set();
 globalThis.setInterval = (...args) => { const handle = originalSetInterval(...args); intervals.add(handle); return handle; };
 globalThis.clearInterval = handle => { intervals.delete(handle); return originalClearInterval(handle); };
 try {
  code.markExecutionStarted();
  code.updateResult({ ...result(''), details: { calls: [{ name: 'read', args: '/fixture', status: 'running' }] } }, true);
  assert.equal(intervals.size, 1, 'collapsed execution retains one native timer');
  assert.match(paint(code), /▸ codemode · … Running · Read files · 1 nested call/);
  assert.equal(code.render(100).length, 2, 'native spacer plus one compact summary');
  assert.ok(code.render(100)[1].includes(themeModule.theme.getFgAnsi('syntaxVariable')), 'running codemode label uses native teal');
  assert.ok(code.render(100)[1].includes(themeModule.theme.getFgAnsi('muted')), 'counts and timing are secondary');
  assert.ok(backgroundCells(code.render(100)[1]).every(value => value === ''), 'running codemode leaves the terminal surface clear');
  assert.doesNotMatch(paint(code), /const value|… read/);
  mouse(code, 'click', 1);
  assert.match(paint(code), /const value/); assert.match(paint(code), /… read/);
  assert.equal(input('\r'), undefined, 'mouse does not take editor focus');
  mouse(code, 'click', 1);
  const final = { durationMs: 750, content: [{ type: 'text', text: 'Script completed\nWall time 0.75 seconds\nOutput:\n' }, { type: 'text', text: 'Recorded script output' }], details: { calls: [{ name: 'read', args: '/fixture', status: 'ok', durationMs: 250 }, { name: 'model', args: 'fixture', status: 'error', durationMs: 500, cost: 0.02, error: 'Recorded nested failure' }] } };
  const before = JSON.stringify(final);
  code.updateResult(final);
  assert.equal(intervals.size, 0, 'native completion stops its timer');
  assert.match(paint(code), /▸ codemode · .+ · 2 nested calls · 1 nested error · 0.75s/);
  assert.doesNotMatch(paint(code), /✓|Completed/, 'successful code-mode summary omits redundant status');
  assert.doesNotMatch(paint(code), /✗ Failed|Recorded script output|Recorded nested failure/);
  assert.equal(toolStatus('codemode', final).status, 'success', 'handled nested errors do not fail the script');
  const header = code.render(140).find(row => stripAnsi(row).includes('nested error'));
  assert.ok(header.includes(themeModule.theme.getFgAnsi('syntaxVariable')), 'handled nested failure retains codemode category');
  assert.ok(header.includes(themeModule.theme.getFgAnsi('muted')), 'normal counts stay muted beside warning');
  assert.ok(header.includes(themeModule.theme.getFgAnsi('warning')), 'nested failure warns on a completed script');
  assert.ok(backgroundCells(header).every(value => value === ''), 'collapsed summary uses neutral terminal surface');
  code.setExpanded(true);
  const pane = code.callRendererComponent.owner.code;
  assert.equal(pane.content.supported, true);
  assert.ok(code.render(140).some(row => row.includes(themeModule.theme.getFgAnsi('syntaxKeyword'))), 'native keyword colors remain');
  let visible = paint(code);
  assert.doesNotMatch(visible, /^\s*codemode\s*$/m, 'outer summary is the only codemode heading');
  for (let index = 0; index < 12; index++) { mouse(code, 'wheel', 2, 2); visible += '\n' + paint(code); }
  for (const pattern of [/const value/, /✓ read/, /250ms/, /✗ model/, /500ms/, /\$0\.02/, /Recorded nested failure/, /Recorded script output/, /0\.75s/]) assert.match(visible, pattern);
  assert.doesNotMatch(visible, /arguments\.code|successful action/);
  assert.equal(JSON.stringify(final), before, 'rendering leaves stored transcript exact');
  const choices = []; pi.events.emit('compact-renderer:inspect:v1', { add: entry => choices.push(entry) });
  const choice = choices.find(entry => entry.label.startsWith('codemode')); assert.ok(choice); choice.focus();
  assert.match(paint(code), /focused/);
  const focused = code.render(100).find(row => stripAnsi(row).includes('codemode'));
  assert.ok(focused.includes(themeModule.theme.getBgAnsi('selectedBg')), 'inspection visibly selects header');
  assert.equal(input('\x1b[A').consume, true); assert.equal(pane.offset >= 0, true);
  assert.equal(input('\x1b').consume, true); assert.doesNotMatch(paint(code), /focused/);
  choice.focus(); assert.equal(input('x'), undefined); assert.doesNotMatch(paint(code), /focused/); assert.equal(input('\r'), undefined, 'typing releases inspection before next Enter');
  code.setExpanded(false); assert.doesNotMatch(paint(code), /Recorded script output/);
  code.setExpanded(true); assert.match(paint(code), /const value/, 'native Ctrl+O expansion sync opens native details');
  mode.setEnabled(false);
  assert.match(paint(code), /Recorded script output/); assert.equal(code.callRendererComponent.constructor.name, 'Box');
  mode.setEnabled(true); code.setExpanded(false); assert.equal(code.render(100).length, 2);
  const failed = { ...final, isError: true }; code.updateResult(failed); assert.match(paint(code), /✗ Failed · .+ · 2 nested calls · 1 nested error/);
  assert.ok(code.render(100)[1].includes(themeModule.theme.getFgAnsi('error')), 'failed codemode summary uses native red');
  code.updateResult(final);
  code.updateArgs({ code: Array.from({ length: 100 }, (_, index) => `text(${index});`).join('\n') });
  code.setExpanded(true);
  for (const width of [1, 8, 40, 100]) {
   const rows = code.render(width); assert.ok(rows.length <= 21, 'expanded native content has bounded viewport');
   for (const row of rows) assert.ok(tui.visibleWidth(row) <= width);
  }
  assert.match(paint(code), /text\(0\)/);
  // Exercise native container routing, including the work group's horizontal inset.
  const workChild = new WorkChild(code), work = new tui.Container();
  work.addChild(new tui.Text('Work fixture', 0, 0)); work.addChild(workChild);
  const moreRows = work.render(140).map(stripAnsi), moreY = moreRows.findIndex(row => row.includes('more ↓'));
  assert.ok(moreY > 1); const moreX = moreRows[moreY].indexOf('more ↓'); assert.ok(moreX >= 3);
  const beforeMore = pane.offset;
  assert.equal(work.handleMouse({ type: 'click', button: 'left', x: moreX, y: moreY, screenX: moreX, screenY: moreY, width: 140, height: moreRows.length })?.handled, true);
  const afterMore = work.render(140).map(stripAnsi).join('\n');
  assert.ok(pane.offset > beforeMore, 'clicking overflow advances the rendered codemode viewport');
  assert.ok(pane.offset - beforeMore <= 20, 'one click advances at most one bounded viewport');
  assert.doesNotMatch(afterMore, /text\(0\)/); assert.equal(input('\r'), undefined, 'overflow click leaves Enter with the editor');
  const focusedMore = []; pi.events.emit('compact-renderer:inspect:v1', { add: entry => focusedMore.push(entry) });
  focusedMore.find(entry => entry.label.startsWith('codemode')).focus();
  const rows = code.render(140).map(stripAnsi), footerY = rows.findIndex(row => row.includes('more ↓'));
  assert.ok(footerY > 0); mouse(code, 'click', footerY);
  assert.doesNotMatch(paint(code), /focused/); assert.equal(input('\r'), undefined, 'overflow click releases inspection');
  for (let index = 0; index < 120; index++) { mouse(code, 'wheel', 2, 20); code.render(140); }
  assert.match(paint(code), /Recorded script output/, 'bounded viewport can reach full native output');
  assert.doesNotMatch(paint(code), /more ↓/, 'codemode stops offering downward paging at its final rows');
  const endRows = code.render(140).map(stripAnsi), endOffset = pane.offset;
  assert.match(endRows.at(-1), /more ↑/, 'the final footer retains its hit area');
  mouse(code, 'click', endRows.length - 1); code.render(140);
  assert.ok(pane.offset < endOffset, 'the upward footer pages back through the output');
  assert.equal(code.render(140).length, endRows.length, 'paging back keeps the pane height');
  assert.equal(JSON.stringify(final), before);
  const running = create('codemode', 'code-clear', { code: 'text(1);' }, codemodeRenderers); running.markExecutionStarted(); running.updateResult({ ...result(''), details: { calls: [] } }, true);
  assert.equal(intervals.size, 1); event('session_before_switch'); assert.equal(intervals.size, 0, 'session switch clears native owned timer');
  running.invalidate(); assert.equal(intervals.size, 0, 'stale renderer cannot restart owned timer'); event('session_start');
 } finally { for (const handle of intervals) originalClearInterval(handle); globalThis.setInterval = originalSetInterval; globalThis.clearInterval = originalClearInterval; }
 // Giant fixtures count actual formatted characters/calls, separately from revision aggregation.
 const hugeScript = 'const paths = ["/fixture/a", "/fixture/b"];\n'.repeat(250000);
 const hugeOutput = 'stdout value 中文🙂 '.repeat(400000);
 const hugeCalls = Array.from({length: 20000}, (_, index) => ({name:'read',args:`/fixture/${index}`,status:'ok',durationMs:1}));
 Object.defineProperty(hugeCalls[19999], 'irrelevant', {get(){throw new Error('unused metadata getter must not be visited');}});
 const huge = create('codemode', 'bounded-giant', {code:hugeScript}, codemodeRenderers);
 const hugeResult = {content:[{type:'text',text:hugeOutput}],details:{calls:hugeCalls},durationMs:81234};
 huge.updateResult(hugeResult);
 const giantPane = huge.callRendererComponent.owner.code;
 assert.equal(giantPane.content.sourceCharacters,0,'collapsed construction/update formats zero source characters');
 assert.equal(giantPane.content.paintedCalls,0,'collapsed construction/update formats zero nested calls');
 assert.equal(giantPane.content.aggregateEntries,20000,'one aggregate pass for the result revision');
 for(let i=0;i<3;i++){huge.invalidate();huge.render(100);}
 assert.equal(giantPane.content.aggregateEntries,20000,'redraw/invalidation does not rescan nested-call aggregate');
 huge.setExpanded(true);huge.render(100);
 assert.ok(giantPane.content.sourceCharacters<=2048,'first viewport formats only bounded source chunks, not the 10 MB script');
 assert.equal(giantPane.content.paintedCalls,0,'viewport does not visit later nested calls');
 const initialCharacters=giantPane.content.sourceCharacters;
 huge.render(100);huge.render(100);assert.equal(giantPane.content.sourceCharacters,initialCharacters,'repeated paint uses visited row cache');
 huge.invalidate();huge.render(100);assert.equal(giantPane.content.sourceCharacters,initialCharacters,'unchanged native invalidation preserves body cache');
 const beforeAggregate=giantPane.content.aggregateEntries;
 hugeCalls[0].status='error';hugeCalls[0].error='in-place recorded error';
 event('tool_execution_update',{toolCallId:'bounded-giant',toolName:'codemode',args:{code:hugeScript},partialResult:hugeResult});
 huge.updateResult(hugeResult,true);
 assert.equal(giantPane.content.errors,1,'explicit update revision detects in-place status mutation');
 assert.equal(giantPane.content.aggregateEntries-beforeAggregate,20000,'in-place update aggregates once, not once per renderer slot');
 hugeCalls.push({name:'read',args:'/fixture/new',status:'cancelled'});
 event('tool_execution_update',{toolCallId:'bounded-giant',toolName:'codemode',args:{code:hugeScript},partialResult:hugeResult});huge.updateResult(hugeResult,true);
 assert.equal(giantPane.content.calls.length,20001);assert.equal(giantPane.content.cancelled,1,'same array identity can gain a cancelled call');
 huge.updateResult(hugeResult); // No execution start, so this synthetic partial replay owns no clock.
 const stdoutOnly=create('codemode','bounded-stdout',{code:''},codemodeRenderers);stdoutOnly.updateResult({content:[{type:'text',text:hugeOutput}],details:{calls:[]}});stdoutOnly.setExpanded(true);stdoutOnly.render(100);
 assert.ok(stdoutOnly.callRendererComponent.owner.code.content.sourceCharacters<=2048,'giant stdout has bounded formatting');
 const hugeError=create('codemode','bounded-nested-error',{code:'text(1);'},codemodeRenderers);
 hugeError.updateResult({content:[],details:{calls:[{name:'read',args:'/fixture',status:'error',error:'recorded error '.repeat(500000)}]}});hugeError.setExpanded(true);hugeError.render(100);
 assert.ok(hugeError.callRendererComponent.owner.code.content.sourceCharacters<=4096,'giant nested errors are chunked too');
 const tailCalls=Array.from({length:80},(_,index)=>({name:'read',args:`tail-call-${index}`,status:'ok'}));
 const tailRecord={content:[{type:'text',text:'tail-output-start\n'+('recorded output row\n'.repeat(70))+'LAST-OUTPUT🙂'}],details:{calls:tailCalls,fullOutputPath:'/fixture/exact-full-output.log'}};
 const tailBefore=JSON.stringify(tailRecord);
 const tail=create('codemode','bounded-tail',{code:('const value = 1;\n'.repeat(80))+'// LAST-SOURCE🙂'},codemodeRenderers);tail.updateResult(tailRecord);tail.setExpanded(true);
 const tailPane=tail.callRendererComponent.owner.code;let visited=paint(tail);
 for(let i=0;i<100;i++){tailPane.offset+=10;visited+='\n'+paint(tail);}
 for(const text of ['LAST-SOURCE🙂','tail-call-79','LAST-OUTPUT🙂','/fixture/exact-full-output.log'])assert.ok(visited.includes(text),`all recorded sections remain reachable: ${text}`);
 assert.equal(JSON.stringify(tailRecord),tailBefore,'full traversal leaves original record unchanged');
 const safe=create('codemode','bounded-unicode',{code:'const 中文 = "🙂";\n// \u202e'},codemodeRenderers);safe.updateResult(result('exact\x1b[31m\u202e\u0000end'));safe.setExpanded(true);
 const safeText=paint(safe);assert.match(safeText,/\\u001b\[31m\\u202e\\u0000end/);assert.doesNotMatch(safeText,/\u202e/);
 for(const width of [1,2,8,40])for(const line of safe.render(width))assert.ok(tui.visibleWidth(line)<=width);
 const replay=create('codemode','bounded-duration-replay',{code:''},codemodeRenderers);replay.updateResult({content:[{type:'text',text:'Script completed\nWall time 73.25 seconds\nOutput:\n'},{type:'text',text:'replay output'}],details:{calls:[]}});replay.setExpanded(true);
 assert.match(paint(replay),/Wall time 73.25 seconds/,'replay without duration keeps its recorded envelope');
 replay.updateResult({...result('replay output'),durationMs:73250});assert.match(paint(replay),/73\.25s/,'recorded duration remains in the heading');assert.doesNotMatch(paint(replay),/Took /,'recorded duration is not repeated below');assert.match(stripAnsi(replay.render(24).join('\n')),/Took 1m 13s/,'a clipped heading retains duration in the footer');
 const themeFixture=create('codemode','bounded-theme',{code:'const themeValue = 1;'},codemodeRenderers);themeFixture.updateResult(result('theme output'));themeFixture.setExpanded(true);themeFixture.render(140);
 const themePane=themeFixture.callRendererComponent.owner.code, themed=themePane.content.sourceCharacters;
 const activeTheme=globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")], originalFg=activeTheme.fg;
 try{
  activeTheme.fg=function(token,text){return ['toolOutput','syntaxKeyword'].includes(token)?'\x1b[38;5;201m'+text+'\x1b[39m':originalFg.call(this,token,text);};
  themeFixture.invalidate();assert.ok(themeFixture.render(140).some(row=>row.includes('\x1b[38;5;201m')),'theme mutation invalidates cached ANSI');
  assert.ok(themePane.content.sourceCharacters>themed);
 }finally{activeTheme.fg=originalFg;themeFixture.invalidate();}
 const emptyBlocks=Array.from({length:100000},()=>({type:'text',text:''}));emptyBlocks.push({type:'text',text:'nonempty tail output'});
 const empties=create('codemode','bounded-empty-blocks',{code:''},codemodeRenderers);empties.updateResult({content:emptyBlocks,details:{calls:[]}});
 const emptyPane=empties.callRendererComponent.owner.code;
 assert.equal(emptyPane.content.aggregateBlocks,100001,'empty block indexing is once-per-update work');
 empties.setExpanded(true);assert.match(paint(empties),/nonempty tail output/);
 assert.equal(emptyPane.content.aggregateBlocks,100001,'paint does not rescan empty output blocks');
 assert.ok(emptyPane.content.sourceCharacters<100,'only the visible nonempty output is formatted');
 // Compact images follow their pane; native Pi keeps image ownership and sources.
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
 const imageRecord={content:[{type:'text',text:'Script completed\nWall time 0.75 seconds\nOutput:\n'},...Array.from({length:3},()=>({type:'image',mimeType:'image/png',data:png})),{type:'text',text:'Image saved to /var/tmp/pi-codemode-fixture.png\n'+hugeOutput}],details:{calls:[{name:'read',args:'/fixture/image.png',status:'ok'},{name:'read',args:'/fixture/record.json',status:'ok'}]}};
 const imageSnapshot=JSON.stringify(imageRecord);
 const imageCode=create('codemode','bounded-images',{code:'const images = await tools.read({path:"/fixture/image.png"});\ntext(images);'},codemodeRenderers);imageCode.updateResult(imageRecord);
 assert.match(paint(imageCode),/▸ codemode.*3 images/);
 assert.equal(imageCode.render(100).length,2,'image-bearing code has one collapsed text heading');
 assert.doesNotMatch(paint(imageCode),/Image saved|const images|image\/png/);
 const imagePane=imageCode.callRendererComponent.owner.code;
 assert.equal(imagePane.content.sourceCharacters,0,'collapsed images do not format script or giant JSON output');
 const imageChoices=[];pi.events.emit('compact-renderer:inspect:v1',{add:choice=>imageChoices.push(choice)});
 assert.ok(imageChoices.some(choice=>choice.label.includes('3 images')),'image-bearing code remains inspectable');
 imageCode.setExpanded(true);
 assert.doesNotMatch(paint(imageCode),/Recorded image:/,'image placeholders do not repeat the heading count');
 assert.ok(imageCode.render(100).length<=22,'expanded text and unavailable-preview fallback stay bounded');
 assert.ok(imagePane.content.sourceCharacters<=4096,'images do not bypass bounded formatting');
 for(const width of [1,8,40])for(const row of imageCode.render(width))assert.ok(tui.visibleWidth(row)<=width);
 assert.equal(JSON.stringify(imageRecord),imageSnapshot,'image and text records remain exact');
 const savedCapabilities=tui.getCapabilities();
 try {
  tui.setCapabilities({...savedCapabilities,images:'kitty'});
  imageCode.setShowImages(true);imageCode.setExpanded(false);
  assert.equal(imageCode.imageComponents.length,3,'native Pi retains all image components outside the text pane');
  const nativeImages=[...imageCode.imageComponents];
  assert.deepEqual(imageCode.imageSources.map(source=>source.data),[png,png,png]);
  assert.ok(!imageCode.render(100).some(row=>row.includes('\x1b_G')),'collapsed compact code emits no image protocol');
  imageCode.setExpanded(true);
  assert.equal(imageCode.render(100).filter(row=>row.includes('\x1b_G')).length,3,'expanded code renders all native inline images');
  assert.ok(imageCode.render(100).filter(row=>row.includes('\x1b_G')).every(row=>row.startsWith('   \x1b_G')),'codemode images align with its indented expanded body');
  mouse(imageCode,'click',1);assert.ok(!imageCode.render(100).some(row=>row.includes('\x1b_G')),'mouse collapse hides every image');
  const imageInspection=[];pi.events.emit('compact-renderer:inspect:v1',{add:choice=>imageInspection.push(choice)});
  imageInspection.find(choice=>choice.label.includes('3 images')).focus();
  assert.equal(imageCode.render(100).filter(row=>row.includes('\x1b_G')).length,3,'inspection expansion renders images');
  input('\r');assert.ok(!imageCode.render(100).some(row=>row.includes('\x1b_G')),'inspection Enter collapse hides images');input('\x1b');
  const readRecord={content:[{type:'text',text:'Exact native image-read output'},{type:'image',mimeType:'image/png',data:png}]};
  const protocolRead=create('read','protocol-image-read',{path:'/fixture/protocol-image.png'},readRenderers);protocolRead.setShowImages(true);protocolRead.updateResult(readRecord);
  assert.equal(protocolRead.imageComponents.length,1,'individual image reads retain native image ownership');
  assert.ok(!protocolRead.render(100).some(row=>row.includes('\x1b_G')),'collapsed direct read emits no image protocol');
  protocolRead.setExpanded(true);assert.ok(protocolRead.render(100).some(row=>row.includes('\x1b_G')),'expanded direct read renders a native image');
  const readRows=protocolRead.render(100), imageRow=readRows.find(row=>row.includes('\x1b_G'));
  const outputIndent=stripAnsi(readRows.find(row=>row.includes('Exact native image-read output'))).match(/^ */)[0];
  const detailsIndent=stripAnsi(readRows.find(row=>row.includes('▸ Details'))).match(/^ */)[0];
  assert.equal(imageRow.slice(0,imageRow.indexOf('\x1b_G')),outputIndent,'image aligns with expanded read text');
  assert.equal(outputIndent,detailsIndent,'image and Details share the expanded content column');
  protocolRead.setExpanded(false);assert.ok(!protocolRead.render(100).some(row=>row.includes('\x1b_G')),'native collapse hides a direct read image');
  assert.equal(paint(protocolRead).split('\n').filter(row=>row.includes('read · /fixture/protocol-image.png')).length,1);
  imageCode.setExpanded(true);imageCode.render(100);imageCode.invalidate();
  assert.deepEqual(imageCode.imageComponents,nativeImages,'expansion and redraw reuse native images');
  const savedCells=tui.getCellDimensions();
  try {
   tui.setCellDimensions({widthPx:9,heightPx:18});
   for(const [widthPx,heightPx] of [[640,320],[320,1600]]){
    const sized=create('read',`sized-${widthPx}`,{path:`/fixture/${widthPx}.png`},readRenderers);
    sized.setShowImages(true);sized.updateResult({content:[{type:'image',mimeType:'image/png',data:pngFixture(widthPx,heightPx)}]});sized.setExpanded(true);
    const image=sized.imageComponents[0],options=image.options;
    assert.deepEqual(image.dimensions,{widthPx,heightPx});
    for(const width of [1,8,40,100]){
     const line=sized.render(width).find(row=>row.includes('\x1b_G')),size=kittySize(line);
     assert.ok(size.columns>=1&&size.columns<=Math.min(60,Math.max(1,width-2)),'inline preview respects terminal width and 60-column limit');
     assert.ok(size.rows>=1&&size.rows<=12,'inline preview respects 12-row height limit');
     assert.ok(line.indexOf('\x1b_G')+size.columns<=width,'image and left indent fit the terminal together');
     assert.equal(image.options,options,'temporary compact dimensions never leak into native options');
    }
    sized.setImageWidthCells(18);assert.ok(kittySize(sized.render(100).find(row=>row.includes('\x1b_G'))).columns<=18,'native configured image width stays authoritative');
    const nativeImage=sized.imageComponents[0],nativeImageRender=nativeImage.render,nativeImageOptions=nativeImage.options;
    try{
     nativeImage.render=()=>{throw new Error('fixture image render failure');};
     assert.throws(()=>sized.render(100),/fixture image render failure/);
     assert.equal(nativeImage.options,nativeImageOptions,'image render failure restores native options');
     assert.equal(sized.imageComponents[0],nativeImage,'image render failure restores native image ownership');
    }finally{nativeImage.render=nativeImageRender;}
    sized.setImageWidthCells(60);sized.render(100);mode.setEnabled(false);
    const nativeRows=sized.imageComponents[0].render(100),stockSize=kittySize(nativeRows.find(row=>row.includes('\x1b_G')));
    assert.ok(stockSize.rows>12,'native render does not reuse compact height cache');
    assert.ok(sized.render(100).some(row=>row.includes('\x1b_G')),'native mode keeps image protocol output');
    mode.setEnabled(true);
   }
  } finally {tui.setCellDimensions(savedCells);}
  for(const Screen of [tui.TuiMainScreen,tui.TuiAltScreen]){
   const writes=[];
   const terminal={columns:100,rows:50,kittyProtocolActive:false,start(){},stop(){},write(value){writes.push(value);},hideCursor(){},showCursor(){},clearLine(){},clearFromCursor(){},clearScreen(){},moveBy(){},setTitle(){},setProgress(){},setProgramStatus(){}};
   const screen=new Screen(terminal,false,undefined,{mouse:false});
   protocolRead.setExpanded(true);screen.addChild(protocolRead);
   try{
    screen.start();screen.renderNow();assert.ok(writes.join('').includes('\x1b_G'),'native TUI emits expanded image protocol');
    writes.length=0;protocolRead.setExpanded(false);screen.renderNow();
    assert.match(writes.join(''),/\x1b_Ga=d,d=[IaA]/,'native TUI removes image placements after collapse');
   }finally{screen.stop();}
  }
  mode.setEnabled(false);
  const original=new ToolExecutionComponent('codemode','original-images',imageCode.args,{showImages:true,outputPad:0},codemodeRenderers,{requestRender(){}},'/tmp');original.setArgsComplete();original.updateResult(imageRecord);original.setExpanded(true);
  // Image IDs differ by owner; compare the exact native text surface and image sources.
  assert.deepEqual(imageCode.selfRenderContainer.render(100),original.contentBox.render(100),'native-off code text stays stock');
  assert.deepEqual(imageCode.imageSources,original.imageSources,'native-off image sources stay stock');
  const originalRead=new ToolExecutionComponent('read','original-read-images',protocolRead.args,{showImages:true,outputPad:0},readRenderers,{requestRender(){}},'/tmp');originalRead.setArgsComplete();originalRead.updateResult(readRecord);
  for(const expanded of [false,true]){
   protocolRead.setExpanded(expanded);originalRead.setExpanded(expanded);
   assert.deepEqual(protocolRead.selfRenderContainer.render(100),originalRead.contentBox.render(100),'native-off image read text stays stock');
   assert.deepEqual(protocolRead.imageSources,originalRead.imageSources,'native-off image read sources stay stock');
  }
  mode.setEnabled(true);imageCode.setExpanded(false);
  imageCode.setShowImages(false);assert.equal(imageCode.imageComponents.length,0,'native showImages preference stays authoritative');
  imageCode.setExpanded(true);assert.match(paint(imageCode),/Inline preview unavailable: images are disabled/);
  assert.doesNotMatch(paint(imageCode),/file:\/\//,'codemode fallback does not invent a source link');
  tui.setCapabilities({...savedCapabilities,images:null});imageCode.setShowImages(true);
  assert.equal(imageCode.imageComponents.length,0,'unsupported transport does not get synthetic image support');
  assert.match(paint(imageCode),/3 images/,'summary still identifies recorded images without transport support');
  assert.match(paint(imageCode),/Inline preview unavailable: terminal has no image protocol/);
  protocolRead.setExpanded(true);assert.match(paint(protocolRead),/protocol-image\.png/);
  tui.setCapabilities({...savedCapabilities,images:null,hyperlinks:true});
  const fallbackRows=protocolRead.render(140),sourceRow=fallbackRows.find(row=>row.includes('Inline preview unavailable'));
  assert.ok(stripAnsi(sourceRow).startsWith('   '),'fallback stays aligned with expanded content');
  // The OS-native absolute form: POSIX keeps /fixture, Windows prefixes the drive.
  const absoluteSource = pathToFileURL(path.resolve('/fixture/protocol-image.png')).href;
  assert.ok(sourceRow.includes(']8;;' + absoluteSource),'known absolute source uses native OSC 8 support');
  tui.setCapabilities({...savedCapabilities,images:null,hyperlinks:false});assert.ok(!protocolRead.render(140).some(row=>row.includes('\x1b]8;;')),'unsupported hyperlinks remain plain paths');
  protocolRead.setExpanded(false);assert.equal(protocolRead.render(100).length,2,'unsupported collapsed read stays one heading');
  tui.setCapabilities({...savedCapabilities,images:'iterm2'});protocolRead.setShowImages(true);protocolRead.setExpanded(true);
  assert.ok(protocolRead.render(100).some(row=>row.includes('\x1b]1337;File=')),'native iTerm2 protocol remains available');
  assert.ok(protocolRead.render(100).find(row=>row.includes('\x1b]1337;File=')).startsWith('   '),'iTerm2 image anchor retains the expanded indent');
  protocolRead.setExpanded(false);assert.ok(!protocolRead.render(100).some(row=>row.includes('\x1b]1337;File=')),'iTerm2 protocol also follows compact collapse');
  const stockRead=new ToolExecutionComponent('read','unwrapped-native-image',protocolRead.args,{showImages:true,outputPad:0},readRenderers,{requestRender(){}},'/tmp');stockRead.setArgsComplete();stockRead.updateResult(readRecord);
  assert.ok(stockRead.render(100).some(row=>row.includes('\x1b]1337;File=')),'unwrapped stock components keep native collapsed image behavior');
  const absent=create('codemode','absent-image-data',{code:'text("image");'},codemodeRenderers);absent.setShowImages(true);absent.updateResult({content:[{type:'image',mimeType:'image/png',data:''}],details:{calls:[]}});absent.setExpanded(true);
  assert.match(paint(absent),/Inline preview unavailable: image data is unavailable/);
  const unsafe=create('read','unsafe-image-source',{path:'/fixture/unsafe\x1b]8;;evil.png'},readRenderers);unsafe.updateResult(readRecord);unsafe.setExpanded(true);unsafe.setShowImages(false);
  assert.ok(!unsafe.render(140).some(row=>row.includes('\x1b]8;;evil')),'untrusted controls never enter fallback links');
  assert.equal(JSON.stringify(imageRecord),imageSnapshot,'all image controls preserve recorded content and payloads');
 } finally {tui.setCapabilities(savedCapabilities);}
 const beforeImage=create('read','before-image',{path:'/fixture/before-image.txt'},readRenderers);beforeImage.updateResult(result('before image'));
 const imageRead=create('read','individual-image',{path:'/fixture/direct-image.png'},readRenderers);
 const directImageRecord={content:[{type:'text',text:'Exact image read output'},{type:'image',mimeType:'image/png',data:png}]};imageRead.updateResult(directImageRecord,true);
 assert.equal(paint(imageRead).split('\n').filter(row=>row.includes('read · /fixture/direct-image.png')).length,1,'partial image read has one heading');
 assert.match(paint(imageRead),/Running/);imageRead.updateResult(directImageRecord);
 assert.equal(paint(imageRead).split('\n').filter(row=>row.includes('read · /fixture/direct-image.png')).length,1,'individual image read has one heading');
 assert.match(paint(imageRead),/▸ read · \/fixture\/direct-image.png/);
 mouse(imageRead,'click',1);assert.match(paint(imageRead),/Exact image read output/);assert.doesNotMatch(paint(imageRead),/Recorded image:/);
 imageRead.setExpanded(true);imageRead.setExpanded(false);assert.doesNotMatch(paint(imageRead),/Exact image read output/);
 const standardImage=create('read','standard-image',{path:'/fixture/standard.png'},readRenderers);
 const standardRecord={content:[{type:'text',text:'Read image file [image/png]'},{type:'image',mimeType:'image/png',data:png}]};
 const standardSnapshot=JSON.stringify(standardRecord);
 standardImage.updateResult(standardRecord);standardImage.setExpanded(true);
 assert.doesNotMatch(paint(standardImage),/Read image file|Recorded image:/,'standard image announcements do not crowd the preview');
 const standardPane=standardImage.callRendererComponent.owner.pane;
 standardPane.detailsExpanded.add('standard-image');standardPane.reset();
 assert.match(paint(standardImage),/Read image file \[image\/png\]/,'exact native acknowledgement remains in Details');
 assert.equal(JSON.stringify(standardRecord),standardSnapshot,'display cleanup leaves recorded image data unchanged');
 const afterImage=create('read','after-image',{path:'/fixture/after-image.txt'},readRenderers);afterImage.updateResult(result('after image'));
 for(const component of [beforeImage,imageRead,afterImage])assert.doesNotMatch(paint(component),/2 actions|3 actions/,'image reads stay standalone and split adjacent action groups');
 // Other nontext/new native shapes use stock rendering, including both native slots.
 const preFallbackChoices=[];pi.events.emit('compact-renderer:inspect:v1',{add:choice=>preFallbackChoices.push(choice)});
 const image=create('codemode','bounded-image-fallback',{code:'text("image");'},codemodeRenderers);image.updateResult({content:[{type:'image',mimeType:'image/png',data:''},{type:'unknown',text:'future native output'}],details:{calls:[]}});
 assert.doesNotMatch(paint(image),/▸ codemode/,'unsupported nontext result retains native fallback');
 assert.match(paint(image),/image\/png|image/);
 const fallbackChoices=[];pi.events.emit('compact-renderer:inspect:v1',{add:choice=>fallbackChoices.push(choice)});
 assert.equal(fallbackChoices.length,preFallbackChoices.length,'unsupported native fallback is absent from compact inspector');
 image.updateResult(result('supported again'));image.setExpanded(true);
 assert.match(paint(image),/supported again/,'fallback to supported is visible immediately');assert.doesNotMatch(paint(image),/image\/png/);
 image.updateResult({content:[{type:'image',mimeType:'image/png',data:''},{type:'unknown',text:'future native output'}],details:{calls:[]}});assert.match(paint(image),/image/,'supported to native fallback is visible immediately');
 image.updateResult(result('supported again'));
 const restoredChoices=[];pi.events.emit('compact-renderer:inspect:v1',{add:choice=>restoredChoices.push(choice)});
 assert.ok(restoredChoices.length>fallbackChoices.length,'supported result restores compact inspection');

 const unsupported=create('codemode','bounded-invalid-fallback',{code:42},codemodeRenderers);assert.match(paint(unsupported),/invalid arg/);
 // Adjacent successful code shares the outer action group with ordinary tools.
 const replayFirst = create('read', 'replay-before', { path: '/fixture/replay-before' }, readRenderers); replayFirst.updateResult(result('first'));
 event('message_end', { message: { role: 'assistant', content: [{ type: 'toolCall', id: 'replay-code', name: 'codemode', arguments: { code: 'text(1)' } }] } });
 const replayCode = create('codemode', 'replay-code', { code: 'text(1)' }, codemodeRenderers, true); replayCode.updateResult(result('done'));
 const last = create('read', 'after-code', { path: '/fixture/after' }, readRenderers, true); last.updateResult(result('last'));
 assert.equal(paint(last), '');
 assert.doesNotMatch(paint(replayCode), /successful action/);
 assert.match(paint(replayFirst), /3 actions/); assert.equal(paint(replayCode), '');
 console.log('codemode: collapsed summary, bounded details, native images, single image-read headings, nested outcome, timer, inspection/editor and transcript checks passed');
} finally { dispose(); assert.equal(ToolExecutionComponent.prototype.render,originalToolRender,'disposing restores the native render method'); }
