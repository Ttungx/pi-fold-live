// Harmless controls for the isolated native preview. Never loaded by the package entry point.
import { createCodemodeExtension } from '@earendil-works/pi-coding-agent';

export const fixtureQuestion = {
  question: 'Which synthetic sample should the preview compare?',
  details: 'Display exercise only. Your answer does not start an analysis or approve an operation.',
  options: [
    { label: 'Sample A (Recommended)', value: 'sample-a', description: 'Inspect a complete invented record with explicit units.' },
    { label: 'Sample B', value: 'sample-b', description: 'Inspect an invented record with a missing-value warning.' },
  ],
};
export const fixtureTextQuestion = {
  question: 'What label should this invented comparison use?',
  details: 'Free-text display example. The label is not saved to a report.',
};

export default async function preview(pi: any) {
  if (process.env.PI_PREVIEW_WORK_STRIP === '1') pi.registerCommand('fixture-work', {
    description: 'Play an invented work-strip recording; no model or tool runs',
    handler(_args: string, ctx: any) {
      pi.events.emit('preview:work-strip-run:v1', { notify: (value: string) => ctx.ui.notify(value, 'info') });
    },
  });
  // Import only native presentation helpers; never initialize the subagent runtime.
  if (process.env.PI_PREVIEW_SUBAGENT_RENDERERS) {
    const native = await import(process.env.PI_PREVIEW_SUBAGENT_RENDERERS);
    for (const type of native.SUBAGENT_MESSAGE_TYPES) pi.registerMessageRenderer(type, native.renderSubagentMessage);
    for (const type of native.SUBAGENT_ENTRY_TYPES) pi.registerEntryRenderer(type, native.renderSubagentEntry);
  }
  // Keep Pi's exact native renderers and schema, but never retain its script executor.
  createCodemodeExtension()({
    ...pi,
    registerTool(definition: any) {
      pi.registerTool({ ...definition, execute: async () => { throw new Error('Code execution is disabled in this preview.'); } });
    },
  });
  let questionUI: any;
  // The launcher supplies the existing pi-questions UI definition before replacing its registered executor.
  pi.events.on('preview:question-ui:v1', (definition: any) => { questionUI = definition; });
  pi.on('input', (_event: any, ctx: any) => {
    ctx.ui.notify('Fixture prompt received. No model or tool was called.', 'info');
    return { action: 'handled' };
  });
  pi.on('tool_call', () => ({ block: true, reason: 'This preview never executes tools.' }));
  pi.on('user_bash', () => ({ result: { output: 'Shell execution is disabled in this preview.', exitCode: 1, cancelled: false, truncated: false } }));
  pi.on('session_start', (_event: any, ctx: any) => ctx.ui.setStatus('preview', 'FIXTURE · no model, shell, or database calls'));
  pi.registerCommand('fixture-question', {
    description: 'Open the existing question UI without running the agent or a tool',
    async handler(args: string, ctx: any) {
      if (!questionUI) {
        ctx.ui.notify('Native question UI unavailable. Set PI_QUESTIONS_PATH to pi-questions/index.ts and restart. Recorded question cards remain available.', 'warning');
        return;
      }
      if (args.trim() && args.trim() !== 'text') {
        ctx.ui.notify('Use /fixture-question for choices, or /fixture-question text for free text.', 'info');
        return;
      }
      // Call only the captured UI logic, directly. Do not use ctx.executeTool or the tool pipeline.
      const result = await questionUI.execute('fixture-ui-only', args.trim() === 'text' ? fixtureTextQuestion : fixtureQuestion, undefined, undefined, ctx);
      const details = result.details;
      const answer = details?.answers?.map((item: any) => item.type === 'other' ? `Other: ${item.label}` : item.label).join(', ');
      ctx.ui.notify(`Fixture question: ${details?.status || 'unavailable'}${answer ? ` · ${answer}` : ''}. Nothing was executed or approved.`, details?.status === 'answered' ? 'info' : 'warning');
    },
  });
  pi.registerCommand('fixture-permission', {
    description: 'Preview approval controls; no operation runs',
    async handler(_args: string, ctx: any) {
      let present: undefined | (() => Promise<boolean>), accepting = true;
      pi.events.emit('pi:permission-presentation:v1', {
        version: 1, mode: ctx.mode, ui: ctx.ui,
        action: 'Write a sample report', target: '/fixture/report.txt',
        reason: 'Preview only. Allow once and Deny both perform no operation.',
        details: JSON.stringify({ path: '/fixture/report.txt', content: Array.from({ length: 100 }, (_, i) => `Recorded example line ${i + 1} — 中文 and kg/L`).join('\n') }, null, 2),
        offer(callback: () => Promise<boolean>) { if (!accepting || present) return false; present = callback; return true; },
      });
      accepting = false;
      if (!present) { ctx.ui.notify('No compact permission presenter available.', 'warning'); return; }
      ctx.ui.notify(`Fixture decision: ${await present() ? 'Allow once' : 'Deny'}. Nothing was executed.`, 'info');
    },
  });
}
