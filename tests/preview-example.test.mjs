import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPreview } from '../scripts/preview.mjs';

const hostHome = process.env.HOME, hostFetch = globalThis.fetch;
const preview = await createPreview();
const { core, runtime, manager, temporary, runtimePath, agentRoot, cwd } = preview;
const load = file => import(pathToFileURL(path.join(agentRoot, 'dist', file)).href);
const { initTheme, theme } = await load('modes/interactive/theme/theme.js');
const { codemodeRenderers } = await load('extensions/codemode/renderer.js');
const { Text } = await import(pathToFileURL(preview.tuiPath).href);
const strip = value => value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, '');
const paint = (component, width = 100) => strip(component.render(width).join('\n'));
initTheme('dark', false);
try {
  assert.equal(process.env.HOME, temporary);
  assert.equal(process.env.PI_CODING_AGENT_DIR, preview.agentDir);
  await assert.rejects(fetch('https://invalid.example/'), /Network disabled/);
  assert.throws(() => runtime.session.agent.streamFn(), /Model calls disabled/);
  assert.deepEqual(runtime.session.getActiveToolNames(), [], 'no executable tools are enabled');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(preview.agentDir, 'auth.json'), 'utf8')), {}, 'temporary auth store contains no credentials');
  const messages = manager.buildSessionContext().messages;
  const previewSettings = JSON.parse(await fs.readFile(path.join(preview.agentDir, 'settings.json'), 'utf8'));
  assert.equal(previewSettings.terminal.showImages, true, 'visual preview enables native images');
  const imageResult = messages.find(message => message.role === 'toolResult' && message.toolCallId === 'read-image');
  const imageCall = messages.flatMap(message => Array.isArray(message.content) ? message.content : []).find(block => block.type === 'toolCall' && block.id === 'read-image');
  const imageBytes = Buffer.from(imageResult.content.find(block => block.type === 'image').data, 'base64');
  assert.equal(imageBytes.readUInt32BE(16), 640, 'fixture has a visible width');
  assert.equal(imageBytes.readUInt32BE(20), 320, 'fixture has a visible height');
  assert.equal(imageCall.arguments.path, path.join(cwd, 'sample-a.png'));
  assert.deepEqual(await fs.readFile(imageCall.arguments.path), imageBytes, 'fallback points to the actual isolated test image');
  const users = messages.filter(message => message.role === 'user');
  assert.equal(users.length, 3, 'prompt-jump still has exactly three recorded user prompts');
  const templateFile = await fs.readFile(path.join(preview.agentDir, 'prompts/fixture.md'), 'utf8');
  assert.match(templateFile, /description: Inspect synthetic tool, question, and skill display examples\./);
  assert.equal(templateFile.split('---\n').at(-1), users[0].content, 'recorded template body matches its actual prompt file');
  const registered = runtime.session.extensionRunner.getToolDefinition('codemode');
  assert.equal(registered.renderCall, codemodeRenderers.renderCall, 'the actual native call renderer is registered');
  assert.equal(registered.renderResult, codemodeRenderers.renderResult, 'the actual native result renderer is registered');
  await assert.rejects(registered.execute(), /Code execution is disabled/);
  const renderers = runtime.session.extensionRunner.resolveToolRenderers('codemode', () => registered);
  assert.notEqual(renderers, registered, 'compact mode adds collapse around the native definition');

  // Replay the saved transcript through the real InteractiveMode, including its native skill parser.
  const runner = runtime.session.extensionRunner;
  const rendererErrors = [];
  runner.onError(error => rendererErrors.push(error));
  runner.setUIContext({ theme, onTerminalInput() { return () => {}; }, setHiddenThinkingLabel() {}, setStatus() {}, setWidget() {}, notify() {} }, 'tui');
  await runner.emit({ type: 'session_start', reason: 'resume' });
  const ui = new core.InteractiveMode(runtime, { tuiMode: 'fullscreen' });
  ui.updateTerminalTitle = () => {};
  ui.renderSessionEntries(manager.getBranch());
  const workflow = ui.chatContainer.children.find(item => item.lastMessage?.content?.some(block => block.type === 'text' && block.text.includes('```js workflow')));
  assert.ok(workflow, 'preview includes an assistant workflow, not a tool result');
  const workflowSource = JSON.stringify(workflow.lastMessage);
  const workflowRows = paint(workflow);
  assert.match(workflowRows, /Subagent workflow/);
  assert.doesNotMatch(workflowRows, /Synthetic instruction 70|const brief/);
  assert.match(workflowRows, /Nothing will execute/);
  assert.match(workflowRows, /following subagent records remain separate/);
  assert.equal(JSON.stringify(workflow.lastMessage), workflowSource, 'workflow display preserves the execution source');
  assert.deepEqual(rendererErrors, []);
  const code = ui.chatContainer.children.find(item => item instanceof core.ToolExecutionComponent && item.toolName === 'codemode');
  assert.ok(code, 'actual transcript replay creates a native codemode component');
  const collapsed = paint(code);
  assert.match(collapsed, /▸ codemode/);
  assert.match(collapsed, /nested error/);
  assert.doesNotMatch(collapsed, /const reads|Invented missing file|Script completed/);
  assert.ok(code.render(100).length <= 2, 'code mode closes to one summary plus native spacing');
  const pane = code.callRendererComponent.owner.code;
  assert.equal(pane.content.supported, true);
  code.setExpanded(true);
  assert.match(paint(code), /▾ codemode/);
  assert.ok(code.render(100).some(row => row.includes(theme.getFgAnsi('syntaxKeyword'))), 'bounded JavaScript uses native syntax colors');
  assert.ok(code.render(100).length <= 22, 'expanded content uses a bounded viewport');
  let expanded = paint(code);
  for (let index = 0; index < 40; index++) { pane.offset += 8; expanded += '\n' + paint(code); }
  for (const text of ['Invented missing file. No file was accessed.', 'models.classify', 'All calls, durations, and costs shown here are synthetic. Nothing ran.']) assert.ok(expanded.includes(text));
  assert.match(expanded, /✓ read/); assert.match(expanded, /✗ read/);
  assert.match(expanded, /125ms/); assert.match(expanded, /1\.48s/);
  assert.match(expanded, /Model calls: \$0\.0030/);
  assert.match(expanded, /\$0\.0012/); assert.match(expanded, /\$0\.0018/);
  code.setExpanded(false);
  assert.doesNotMatch(paint(code), /const reads/);
  // Find by recorded arguments as native component IDs are internal to Pi.
  const scripts = ui.chatContainer.children.filter(item => item instanceof core.ToolExecutionComponent && item.toolName === 'bash' && item.args?.command?.startsWith("node - <<"));
  assert.equal(scripts.length, 2, 'singleton and separate error use ordinary Bash renderers');
  assert.equal(paint(scripts[0]).trim(), '▸ bash · Run Node.js script');
  assert.match(paint(scripts[1]), /Path too long/);
  assert.doesNotMatch(paint(scripts[1]), /ENAMETOOLONG|lstat|invented-long-path/);
  scripts[0].setExpanded(true);
  assert.match(paint(scripts[0]), /count/);
  scripts[1].setExpanded(true);
  assert.doesNotMatch(paint(scripts[1]), /name too long, lstat/);
  const exactErrorRow = scripts[1].render(100).findIndex(row => strip(row).includes('▸ Details'));
  scripts[1].handleMouse({ type: 'click', button: 'left', x: 3, y: exactErrorRow, width: 100, height: scripts[1].render(100).length });
  assert.match(paint(scripts[1]), /ENAMETOOLONG: name too long, lstat/);
  const fourGroup = ui.chatContainer.children.find(item => item instanceof core.ToolExecutionComponent && item.toolName === 'read' && item.args?.path === '/fixture/source.js');
  assert.match(paint(fourGroup), /4 actions · Read files and edit files; and other actions/);
  assert.doesNotMatch(paint(fourGroup), /successful|Completed|✓/);
  const densityGroup = ui.chatContainer.children.find(item => item instanceof core.ToolExecutionComponent && item.toolName === 'write' && item.args?.path === '/fixture/sample-a.txt');
  assert.match(paint(densityGroup), /4 actions · Edit files and read files/);
  densityGroup.setExpanded(true);
  assert.equal(densityGroup.render(100).length, 6, 'four tight sibling headings plus header and native spacer');
  const densityPane = densityGroup.resultRendererComponent.owner.group.pane;
  densityPane.expanded.add('write-1'); densityPane.reset();
  assert.match(paint(densityGroup), /Content alpha/);
  assert.doesNotMatch(paint(densityGroup), /Successfully wrote|Arguments/);
  const densityFailure = ui.chatContainer.children.find(item => item instanceof core.ToolExecutionComponent && item.toolName === 'read' && item.args?.path === '/fixture/missing.txt');
  densityFailure.setExpanded(true);
  assert.match(paint(densityFailure), /ENOENT · File not found/);
  assert.doesNotMatch(paint(densityFailure), /access '/);
  const skill = ui.chatContainer.children.find(item => item instanceof core.SkillInvocationMessageComponent);
  assert.ok(skill, 'actual transcript replay uses the native skill component');
  assert.match(paint(skill), /▸ \/skill:fixture-review/);
  assert.match(paint(skill), /Show the native skill card and one final successful action\./);
  assert.doesNotMatch(paint(skill), /\[skill\]|Ctrl\+O/);
  assert.doesNotMatch(paint(skill), /Review the synthetic preview|Review invented sample/);
  skill.setExpanded(true);
  assert.match(paint(skill), /Review the synthetic preview/);
  const parsed = core.parseSkillBlock(users[2].content);
  assert.equal(parsed.name, 'fixture-review');
  assert.equal(parsed.location, path.join(preview.agentDir, 'skills/fixture-review/SKILL.md'));
  assert.equal(parsed.userMessage, 'Show the native skill card and one final successful action.');

  const questionRecords = messages.filter(message => message.role === 'toolResult' && message.toolName === 'ask_user_question');
  assert.deepEqual(questionRecords.map(message => message.details.status), ['answered', 'answered', 'answered', 'cancelled']);
  assert.deepEqual(questionRecords.slice(0, 3).map(message => message.details.answers[0].type), ['option', 'other', 'text']);
  assert.deepEqual(questionRecords.at(-1).details.answers, [], 'cancellation records no answer');
  const command = runtime.session.extensionRunner.getCommand('fixture-question');
  const notifications = [];
  const ctx = { hasUI: true, cwd, ui: { notify: (...args) => notifications.push(args), input: async () => 'Synthetic comparison · 中文' } };
  if (preview.questionsPath) {
    const question = runtime.session.extensionRunner.getToolDefinition('ask_user_question');
    await assert.rejects(question.execute(), /Tool execution is disabled/);
    for (const [keys, expected] of [
      [['\r'], /answered · Sample A/],
      [['\x1b[B', '\x1b[B', '\r', 'Custom fixture answer', '\r'], /answered · Other: Custom fixture answer/],
      [['\x1b'], /cancelled/],
    ]) {
      ctx.ui.custom = factory => new Promise(resolve => {
        const component = factory({ requestRender() {} }, theme, {}, resolve);
        try {
          const wide = paint(component), narrow = paint(component, 35);
          assert.match(wide, /Sample A \(Recommended\)/); assert.match(wide, /missing-value warning/);
          assert.match(wide, /Other/); assert.match(narrow, /Sample A/);
          assert.equal(component.constructor.name, 'Object', 'the original pi-questions component is returned');
          for (const key of keys) component.handleInput(key);
        } finally { component.dispose?.(); }
      });
      await command.handler('', ctx);
      assert.match(notifications.at(-1)[0], expected);
    }
    await command.handler('text', ctx);
    assert.match(notifications.at(-1)[0], /answered · Synthetic comparison · 中文/);
    ctx.ui.input = async () => undefined;
    await command.handler('text', ctx);
    assert.match(notifications.at(-1)[0], /cancelled/);
    const nativeCall = question.renderCall({ question: 'Which sample?', options: [{ label: 'A', description: 'detail' }] }, theme);
    assert.ok(nativeCall instanceof Text, 'the loaded package supplies its real native renderer');
  } else {
    await command.handler('', ctx);
    assert.match(notifications.at(-1)[0], /Native question UI unavailable/);
  }
  console.log(`preview examples: real runtime, native code/skill replay, 3 prompts, blocked execution, and ${preview.questionsPath ? 'native question selection/Other/text/cancellation' : 'explicit question UI fallback'} passed`);
} finally { await preview.cleanup(); }
assert.equal(process.env.HOME, hostHome);
assert.equal(globalThis.fetch, hostFetch);
assert.equal(await fs.stat(temporary).then(() => true, () => false), false, 'temporary home was removed');
