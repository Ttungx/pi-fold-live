#!/usr/bin/env node
// Actual Pi TUI with invented records and an isolated temporary home. No credentials or live services.
import fs from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
export async function createPreview() {
  const hostHome = os.homedir();
  // Prefer the Pi installed next to this package (npm install), then the state runtime.
  const localRuntime = path.resolve(source, 'node_modules/@earendil-works/pi-coding-agent');
  const runtimePath = path.resolve(process.env.PI_RUNTIME || (await fs.stat(localRuntime).then(stat => stat.isDirectory(), () => false) ? path.resolve(source) : path.join(hostHome, '.local/state/pi-config/current/runtime')));
  const agentRoot = path.resolve(process.env.PI_INSTALL_ROOT || path.join(runtimePath, 'node_modules/@earendil-works/pi-coding-agent'));
  const tuiPath = createRequire(path.join(agentRoot, 'package.json')).resolve('@earendil-works/pi-tui');
  const promptJump = process.env.PI_PROMPT_JUMP_PATH ? path.resolve(process.env.PI_PROMPT_JUMP_PATH) : undefined;
  const questionCandidates = process.env.PI_QUESTIONS_PATH ? [path.resolve(process.env.PI_QUESTIONS_PATH)] : [
    path.join(hostHome, '.local/state/pi-config/current/packages/pi-questions/index.ts'),
    path.join(runtimePath, 'node_modules/pi-questions/index.ts'),
    path.join(hostHome, 'Code/pi-config/packages/pi-questions/index.ts'),
  ];
  let questionsPath;
  for (const candidate of questionCandidates) {
    if (await fs.stat(candidate).then(stat => stat.isFile(), () => false)) { questionsPath = candidate; break; }
  }
  if (process.env.PI_QUESTIONS_PATH && !questionsPath) throw new Error('PI_QUESTIONS_PATH must point to an existing pi-questions/index.ts.');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-fold-preview-'));
  const agentDir = path.join(temporary, '.pi/agent'), cwd = path.join(temporary, 'fixture');
  const savedEnv = new Map();
  const setEnv = (key, value) => { savedEnv.set(key, process.env[key]); if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  const originalFetch = globalThis.fetch;
  let runtime;
  const cleanup = async () => {
    try { await runtime?.dispose(); }
    finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await fs.rm(temporary, { recursive: true, force: true });
    }
  };
  try {
    await fs.mkdir(agentDir, { recursive: true }); await fs.mkdir(cwd);
    setEnv('PI_PREVIEW_SUBAGENT_RENDERERS', pathToFileURL(path.join(runtimePath, 'node_modules/pi-subagents/src/tui/subagent-messages.js')).href);
    setEnv('HOME', temporary); setEnv('PI_CODING_AGENT_DIR', agentDir); setEnv('PI_OFFLINE', '1');
    for (const key of Object.keys(process.env)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN)$/.test(key)) setEnv(key, undefined);
    globalThis.fetch = async () => { throw new Error('Network disabled in renderer preview'); };
    const core = await import(pathToFileURL(path.join(agentRoot, 'dist/index.js')).href);
    const template = 'This is an invented long prompt template used only to inspect display behavior. Review the recorded examples, expand the tool groups, and compare native display. No commands should run and no services should be contacted.';
    await fs.mkdir(path.join(agentDir, 'prompts'));
    await fs.writeFile(path.join(agentDir, 'prompts/fixture.md'), `---\ndescription: Inspect synthetic tool, question, and skill display examples.\n---\n${template}`);
    const skillDir = path.join(agentDir, 'skills/fixture-review');
    const skillBody = '# Review the synthetic preview\n\nRead the invented sample identifiers and units. Expand the recorded tool outputs and retain missing-value warnings. This skill text is a display fixture; it performs no operation.';
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: fixture-review\ndescription: Review invented sample records for a display exercise.\n---\n${skillBody}\n`);
    await fs.writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
      packages: [source, ...(promptJump ? [promptJump] : [])],
      extensions: [path.join(source, 'tests/fixtures/preview-fixture.ts'), ...(questionsPath ? [questionsPath] : []), ...(process.env.PI_PREVIEW_STATUSLINE ? [path.resolve(process.env.PI_PREVIEW_STATUSLINE)] : [])],
      hideThinkingBlock: true, theme: 'dark', compaction: { enabled: false }, terminal: { showImages: true },
    }));
    const manager = core.SessionManager.inMemory(cwd);
    const now = Date.now(); let sequence = 0;
    const append = message => manager.appendMessage({ ...message, timestamp: now + sequence++ });
    const assistant = (content, stopReason = 'stop') => append({ role: 'assistant', content, api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-6-luna', stopReason,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const call = (id, name, args, output, details = {}, isError = false, thinking = '', durationMs) => {
      assistant([...(thinking ? [{ type: 'thinking', thinking }] : []), { type: 'toolCall', id, name, arguments: args }], 'toolUse');
      append({ role: 'toolResult', toolCallId: id, toolName: name, content: Array.isArray(output) ? output : [{ type: 'text', text: output }], details, isError, ...(durationMs === undefined ? {} : { durationMs }) });
    };
    append({ role: 'user', content: template });
    call('write-1', 'write', { path: '/fixture/sample-a.txt', content: 'alpha' }, 'Successfully wrote to /fixture/sample-a.txt', {}, false, '**Inspect the sample fields**\n\n' + Array.from({ length: 70 }, (_, i) => `Synthetic paragraph ${i + 1}: compare the sample identifier, recorded units, and required fields. This is invented preview text, not model reasoning.`).join('\n\n'));
    call('write-2', 'write', { path: '/fixture/sample-b.txt', content: 'beta' }, 'Successfully wrote to /fixture/sample-b.txt', {}, false, '# Compare the recorded output\n\n' + Array.from({ length: 70 }, (_, i) => `Synthetic paragraph ${i + 1}: inspect the fixture output and retain missing-value warnings. This is invented preview text for scrolling tests.`).join('\n\n'));
    call('read-1', 'read', { path: '/fixture/sample-a.txt', offset: null, limit: null }, 'alpha');
    call('read-density-2', 'read', { path: '/fixture/sample-b.txt', offset: null, limit: null }, 'beta');
    call('missing-density', 'read', { path: '/fixture/missing.txt', offset: null, limit: null }, "ENOENT: no such file or directory, access '/fixture/missing.txt'", {}, true);
    assistant([{ type: 'text', text: 'Visible reply: the four actions above form one group. The missing-file error stays separate. Expand an action for content, then its Details for exact arguments and diagnostics. /fixture above is a prompt template; the native [skill] example appears below.' }]);
    append({ role: 'user', content: 'Show the recorded native JavaScript, detailed questions, and failure examples.' });
    const code = [
      '// Synthetic recording only. This script is never executed.',
      'const reads = await Promise.allSettled([',
      '  tools.read({ path: "/fixture/sample-a.json" }),',
      '  tools.read({ path: "/fixture/missing.json" }),',
      ']);',
      'const classifier = { provider: "fixture", id: "synthetic-classifier" };',
      'const checks = await Promise.all(["sample-a", "sample-b"].map(sample =>',
      '  models.classify(classifier, {',
      '    state: { sample, units: "kg/L" },',
      '    questions: { complete: { type: "bool", instructions: "Are units recorded?",',
      '      criteria: { true: "Units present", false: "Units missing" } } },',
      '  })',
      '));',
      'text({ available: reads.filter(item => item.status === "fulfilled").length,',
      '  checks: checks.map(item => item.answers.complete) });',
    ].join('\n');
    call('code-1', 'codemode', { code }, [
      { type: 'text', text: 'Script completed\nWall time 1.48 seconds\nOutput:\n' },
      { type: 'text', text: 'Invented recording: 1 sample available; 2 checks retained. The missing-file error was handled.\nAll calls, durations, and costs shown here are synthetic. Nothing ran.' },
    ], { calls: [
      { name: 'read', args: '{"path":"/fixture/sample-a.json"}', status: 'ok', durationMs: 125 },
      { name: 'read', args: '{"path":"/fixture/missing.json"}', status: 'error', durationMs: 48, error: 'Invented missing file. No file was accessed.' },
      { name: 'models.classify', args: 'fixture/synthetic-classifier · sample-a', status: 'ok', durationMs: 690, cost: 0.0012 },
      { name: 'models.classify', args: 'fixture/synthetic-classifier · sample-b', status: 'ok', durationMs: 880, cost: 0.0018 },
    ] }, false, '', 1480);
    call('code-inspect', 'codemode', { code: 'text(await tools.bash({command: "jq .status /fixture/record.json"}));\ntext(await tools.bash({command: "gh pr checks 327"}));' }, 'Synthetic inspection only. No files or pull requests were accessed.', { calls: [
      { name: 'bash', args: '{"command":"jq .status /fixture/record.json"}', status: 'ok', durationMs: 12 },
      { name: 'bash', args: '{"command":"gh pr checks 327"}', status: 'ok', durationMs: 21 },
    ] }, false, '', 33);
    assistant([{ type: 'text', text: 'The next card is an ordinary Bash fallback carrying a long Node script. It is separate from native codemode above. Expand it to inspect the exact recorded command and JavaScript colors.' }]);
    const shellScript = [
      "node - <<'NODE'",
      '// Synthetic recording only. This script is never executed.',
      'const paths = ["/fixture/sample-a.json", "/fixture/sample-b.json"];',
      'const records = paths.map((path, index) => ({ path, index, available: true }));',
      'console.log(JSON.stringify({ records, count: records.length }, null, 2));',
      'NODE',
    ].join('\n');
    call('bash-node-singleton', 'bash', { command: shellScript }, 'Recorded JSON output: { "count": 2, "available": true }', { exitCode: 0 }, false,
      '**Inspect the recorded script**\n\nCompare **path fields** and `count`.\n\n```javascript\nconst count = 2;\n```');
    assistant([{ type: 'text', text: 'The previous script is one action. The next failure stays separate and keeps its exact long error inside the expanded card.' }]);
    const longPathError = `Error: ENAMETOOLONG: name too long, lstat '${'/fixture/invented-long-path/'.repeat(180)}'`;
    call('bash-node-path-failure', 'bash', { command: shellScript }, longPathError, { exitCode: 1, error: longPathError }, true);
    assistant([{ type: 'text', text: 'The following four ordinary actions form a group. Expand them to compare source, diff, Markdown, and interpreter arguments with native syntax colors.' }]);
    call('source-read', 'read', { path: '/fixture/source.js' }, 'const paths = ["/fixture/a", "/fixture/b"];\nexport const count = paths.length;');
    call('source-edit', 'edit', { path: '/fixture/source.js', oldText: 'const count = 1;', newText: 'const count = 2;' }, 'Synthetic edit recorded.', { diff: '-const count = 1;\n+const count = 2;' });
    call('markdown-read', 'read', { path: '/fixture/notes.md' }, '# Recorded notes\n\n**Complete:** both samples have `kg/L` units.\n\n- Keep the warning.\n- Compare the recorded count.\n\n```javascript\nconst count = 2;\n```');
    call('bash-node-inline', 'bash', { command: `node -e 'const paths = ["/fixture/a", "/fixture/b"]; console.log(paths.length);'` }, '2', { exitCode: 0 });
    const question = {
      question: 'Which synthetic sample should the preview compare?',
      details: 'Display exercise only. Your answer does not start an analysis or approve an operation.',
      options: [
        { label: 'Sample A (Recommended)', value: 'sample-a', description: 'Inspect a complete invented record with explicit units.' },
        { label: 'Sample B', value: 'sample-b', description: 'Inspect an invented record with a missing-value warning.' },
      ],
    };
    call('question-1', 'ask_user_question', question, 'User selected: 1. Sample A (Recommended)', {
      status: 'answered', question: question.question, context: question.details, mode: 'single-select',
      answers: [{ type: 'option', label: 'Sample A (Recommended)', value: 'sample-a', index: 1 }],
    });
    call('question-other', 'ask_user_question', question, 'User selected: Other: Compare both samples and keep the warning', {
      status: 'answered', question: question.question, context: question.details, mode: 'single-select',
      answers: [{ type: 'other', label: 'Compare both samples and keep the warning', value: 'Compare both samples and keep the warning' }],
    });
    const textQuestion = { question: 'What label should this invented comparison use?', details: 'Free-text display example. The label is not saved to a report.' };
    call('question-text', 'ask_user_question', textQuestion, 'User answered: Synthetic comparison · 中文', {
      status: 'answered', question: textQuestion.question, context: textQuestion.details, mode: 'text',
      answers: [{ type: 'text', label: 'Synthetic comparison · 中文', value: 'Synthetic comparison · 中文' }],
    });
    call('failed-1', 'bash', { command: 'fixture-failure' }, 'Invented failure: sample file not found. No command ran.', { exitCode: 1 }, true);
    call('question-2', 'ask_user_question', question, 'User cancelled the question', {
      status: 'cancelled', question: question.question, context: question.details, mode: 'single-select', answers: [], message: 'User cancelled the question',
    });
    if (process.env.PI_PREVIEW_WORK_STRIP === '1') assistant([{ type: 'text', text: 'Recorded preview decisions are shown above. The missing-input examples are preserved for inspection; no command ran.' }]);
    // This is the same envelope Pi writes for /skill:fixture-review, including its optional user message.
    append({ role: 'user', content: `<skill name="fixture-review" location="${path.join(skillDir, 'SKILL.md')}">\nReferences are relative to ${skillDir}.\n\n${skillBody}\n</skill>\n\nShow the native skill card and one final successful action.` });
    call('read-2', 'read', { path: '/fixture/last.txt' }, 'Recorded final output.');
    assistant([{ type: 'text', text: 'Preview controls: /inspect selects a compact block. Left/Right selects an action or thinking round; Enter expands it; Up/Down scrolls. Esc or typing returns to the editor. Ctrl+O expands native codemode and [skill] cards. /fixture-question opens the existing question UI; /fixture-question text opens free text. /fixture-permission opens a harmless approval dialog. /fold switches display. Ctrl+D exits. All records and prices are invented; no script or model ran.' }]);
    if (!questionsPath) assistant([{ type: 'text', text: 'Native question UI is unavailable on this host. Recorded question cards still show schema-shaped examples. Set PI_QUESTIONS_PATH to an existing pi-questions/index.ts to enable /fixture-question.' }]);
    if (promptJump) assistant([{ type: 'text', text: 'Prompt navigation: /prompt-jump list selects one of the three invented user prompts; /prompt-jump back returns; /prompt-jump end follows the latest output.' }]);
    assistant([{ type: 'text', text: 'Subagent display examples follow. These records are invented. No child or workflow was launched.' }]);
    for (const topic of ['tool-reference/parameter-reference', 'tool-reference/execution-parameters', 'tool-reference/fork-context-details']) {
      call(`guide-${topic}`, 'subagent', { action: 'guide', options: { topic } }, `# ${topic}\n\nSynthetic guide content for inspection. No guide was fetched and no task was started.`, { mode: 'management', results: [] });
    }
    const workflow = [
      '// Review the synthetic sample records',
      'const brief = `Read /fixture/AGENTS.md before inspecting the samples.',
      ...Array.from({ length: 70 }, (_, i) => `Synthetic instruction ${i + 1}: retain recorded units and missing-field warnings.`),
      '`;',
      'return await runs.all([',
      '  { agent: "scout", task: brief + " Inspect sample A." },',
      '  { agent: "scout", task: brief + " Inspect sample B." },',
      ']);',
    ].join('\n');
    assistant([{ type: 'text', text: 'The recorded workflow below is a display example. Nothing will execute.\n\n```js workflow\n' + workflow + '\n```\n\nThe following subagent records remain separate from this script.' }]);
    call('child-launch', 'subagent', { agent: 'worker', task: 'Review the synthetic sample', async: true }, 'Async: worker [fixture-worker]', { mode: 'single', asyncId: 'fixture-worker', runId: 'fixture-worker', results: [] });
    call('child-scout-launch', 'subagent', { agent: 'scout', task: 'Check the synthetic field names', async: true }, 'Async: scout [fixture-scout]', { mode: 'single', asyncId: 'fixture-scout', runId: 'fixture-scout', results: [] });
    call('child-status', 'subagent', { action: 'status', id: 'fixture-worker' }, 'Synthetic worker is running. This status does not establish completion.', { mode: 'management', agent: 'worker', results: [] });
    call('child-steer-error', 'subagent', { action: 'steer', id: 'fixture-workflow', message: 'Retain the units.' }, "Workflow 'fixture-workflow' has no live foreground child. Choose an exact child ID.", { mode: 'management', results: [] }, true);
    call('child-steer', 'subagent', { action: 'steer', id: 'fixture-worker', message: 'Retain the units.' }, 'Steering queued for async run fixture-worker. Queued does not mean consumed.', { mode: 'management', results: [], steering: { requestId: 'fixture-steer', state: 'pending', deliveryStatus: 'queued', sourceRunId: 'fixture-worker', targets: [{ index: 0, state: 'pending' }] } });
    manager.appendCustomMessageEntry('subagent_supervisor_request', 'Should the synthetic report retain records with missing units?\n\nKeep the warning visible. No business data is involved.', true, { id: 'fixture-request', requestId: 'fixture-request', reason: 'need_decision', expectsReply: true, runId: 'fixture-worker', agent: 'worker', childIndex: 0, requestBody: 'Should the synthetic report retain records with missing units?', replyHint: 'Reply to fixture-request.' });
    call('child-reply', 'subagent_supervisor', { action: 'reply', replyTo: 'fixture-request', message: 'Retain the record and its missing-unit warning.' }, 'Replied to supervisor request fixture-request.', { replyTo: 'fixture-request', runId: 'fixture-worker', agent: 'worker' });
    manager.appendCustomEntry('subagent_supervisor_reply', { requestId: 'fixture-request', runId: 'fixture-worker', agent: 'worker', childIndex: 0, message: 'Retain the record and its missing-unit warning.' });
    manager.appendCustomMessageEntry('subagent-notify', 'Synthetic worker completed. The report retains the missing-unit warning. Nothing was executed.', true, { runs: [{ agent: 'worker', status: 'completed' }] });
    manager.appendCustomMessageEntry('subagent-notify', 'Synthetic researcher failed because the fixture input is unavailable. No external source was accessed.', true, { runs: [{ agent: 'researcher', status: 'failed' }] });
    assistant([{ type: 'text', text: 'This visible reply separates the next activity. The decision below has no recorded reply and must stay pending.' }]);
    manager.appendCustomMessageEntry('subagent_supervisor_request', 'Which synthetic sample should the scout inspect next?', true, { id: 'fixture-pending', requestId: 'fixture-pending', reason: 'need_decision', expectsReply: true, runId: 'fixture-scout', agent: 'scout', childIndex: 1, requestBody: 'Which synthetic sample should the scout inspect next?', replyHint: 'Reply to fixture-pending.' });
    assistant([{ type: 'text', text: 'Image-output regression preview: the next codemode contains three recorded PNGs plus a long text result. It should keep one compact heading; the separate image read should also have only one heading. Expand to show the cyan, purple and green test chart; collapse to hide it. Native terminal support controls image display; tmux shows a fallback. No tools or scripts run.' }]);
    // Deterministic 640×320 test chart: cyan, purple and green bars on a checkerboard.
    const pixel = { type: 'image', mimeType: 'image/png', data: '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' };
    const sampleImagePath = path.join(cwd, 'sample-a.png');
    await fs.writeFile(sampleImagePath, Buffer.from(pixel.data, 'base64'));
    const imageCode = 'for (const name of ["sample-a.png", "sample-b.png", "sample-c.png"]) {\n  image(await tools.read({ path: "/fixture/" + name }));\n}\ntext(await tools.read({ path: "/fixture/result.json" }));';
    call('code-images', 'codemode', { code: imageCode }, [
      { type: 'text', text: 'Script completed\nWall time 1.9 seconds\nOutput:\n' },
      { ...pixel }, { ...pixel }, { ...pixel },
      { type: 'text', text: JSON.stringify({ outcome: 'ok', records: Array.from({ length: 90 }, (_, i) => ({ sample: i + 1, status: 'synthetic' })) }, null, 2) },
    ], { calls: ['sample-a.png', 'sample-b.png', 'sample-c.png', 'result.json'].map(name => ({ name: 'read', args: JSON.stringify({ path: '/fixture/' + name }), status: 'ok', durationMs: 1 })) }, false, '', 1900);
    assistant([{ type: 'text', text: 'Separate image read: expand this row to inspect the recorded content and Details. Esc should return to normal prompt typing.' }]);
    call('read-image', 'read', { path: sampleImagePath }, [{ type: 'text', text: 'Read image file [image/png]' }, { ...pixel }]);
    manager.appendSessionInfo('pi-fold-preview');
    const eventBus = core.createEventBus();
    assistant([
      { type: 'thinking', thinking: '**Compare the recorded samples**\n\nSynthetic preview only: compare the two recorded sample labels and retain their units. This text is invented, not model reasoning.' },
      { type: 'text', text: 'Single-round example: this reply stays outside the thinking block. Expand the summary above in one step; collapse it and check that the arrow aligns with the action rows.' },
    ]);
    call('single-thinking-read', 'read', { path: '/fixture/summary.txt' }, 'Recorded sample summary.', {}, false, '# Check the recorded units\n\nSynthetic preview only: the sample units are present in the fixture. This is invented text for the single-round tool-call example.');
    assistant([{ type: 'text', text: 'The single-round tool example above uses the same summary and disclosure. /inspect opens either thinking block; Esc or typing returns to the editor. No model or tool executed.' }]);
    const factory = async ({ sessionManager, sessionStartEvent }) => {
      const modelRuntime = await core.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
      const services = await core.createAgentSessionServices({ cwd, agentDir, modelRuntime,
        resourceLoaderOptions: { eventBus, disabledBuiltinExtensions: ['codemode', 'mcp', 'tool-search', 'llama.cpp'], noContextFiles: true } });
      for (const extension of services.resourceLoader.getExtensions().extensions) {
        const question = extension.tools.get('ask_user_question');
        if (question) {
          eventBus.emit('preview:question-ui:v1', question.definition);
          question.definition = { ...question.definition, execute: async () => { throw new Error('Tool execution is disabled in this preview.'); } };
        }
      }
      const result = await core.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, noTools: 'builtin', model: modelRuntime.getModel('openai-codex', 'gpt-6-luna') });
      result.session.setActiveToolsByName([]);
      result.session.agent.streamFn = () => { throw new Error('Model calls disabled in renderer preview'); };
      return { ...result, services, diagnostics: services.diagnostics };
    };
    runtime = await core.createAgentSessionRuntime(factory, { cwd, agentDir, sessionManager: manager });
    const diagnostics = runtime.services.resourceLoader.getExtensions().errors;
    if (runtime.diagnostics.some(item => item.type === 'error') || diagnostics.length) throw new Error(JSON.stringify([...runtime.diagnostics, ...diagnostics]));
    return { core, runtime, manager, temporary, agentDir, cwd, runtimePath, agentRoot, tuiPath, questionsPath, eventBus, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const preview = await createPreview();
  let ui;
  try {
    ui = new preview.core.InteractiveMode(preview.runtime, { tuiMode: 'fullscreen' });
    await ui.run();
  } finally { ui?.stop(); await preview.cleanup(); }
}
