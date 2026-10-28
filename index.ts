import { inspectRuntime, type FoldFeature } from './src/runtime-compatibility.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createDisplayMode } from './src/display-mode.ts';
import { registerFoldCommand } from './src/fold-command.ts';
import type { WorkStripControls } from './src/work-strip.ts';

export default async function piFold(pi: ExtensionAPI): Promise<void> {
  const compatibility = inspectRuntime(pi);
  // The entrypoint itself must load even when optional native exports disappear.
  const clearDisplayLineCache = compatibility.state === 'unavailable' ? () => {} : (await import('./src/display-card.ts')).clearDisplayLineCache;
  clearDisplayLineCache();
  const mode = createDisplayMode();
  // Follow display state: the live action stays open until the next one starts.
  const follow = createDisplayMode();
  const featureMode = (feature: FoldFeature) => ({ isEnabled: () => mode.isEnabled() && compatibility.available(feature), onChange: mode.onChange });
  const disposers: Array<() => void> = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const errors: unknown[] = [];
    for (const cleanup of [...disposers].reverse()) {
      try { cleanup(); } catch (error) { errors.push(error); }
    }
    mode.dispose();
    follow.dispose();
    clearDisplayLineCache();
    if (errors.length) throw new AggregateError(errors, 'Pi Fold cleanup failed');
  };
  try {
    const reportOff = pi.events?.on('pi-fold:compatibility:v1', (request: any) => {
      if (!disposed && typeof request?.reply === 'function') request.reply({ version: 1, state: compatibility.state, description: compatibility.describe() });
    });
    if (typeof reportOff === 'function') disposers.push(reportOff);
    const sessionProbe = pi.on('session_start', (_event, ctx) => {
      if (!ctx.hasUI) return;
      if (typeof ctx.ui.onTerminalInput !== 'function') {
        for (const feature of ['tools', 'thinking', 'prompts', 'skills', 'workflows', 'subagents', 'work'] as FoldFeature[]) compatibility.disable(feature, 'ui.onTerminalInput missing');
      }
      if (typeof ctx.ui.setHiddenThinkingLabel !== 'function') compatibility.disable('thinking', 'ui.setHiddenThinkingLabel missing');
      if (typeof ctx.sessionManager?.getBranch !== 'function') compatibility.disable('work', 'session branch reader missing');
      if (typeof ctx.sessionManager?.getBranch !== 'function' && typeof ctx.sessionManager?.buildContextEntries !== 'function') compatibility.disable('thinking', 'session entries reader missing');
    });
    if (typeof sessionProbe === 'function') disposers.push(sessionProbe);
    // All display features share the cache; its lifetime belongs to the extension.
    for (const event of ['session_start', 'session_tree', 'session_compact', 'session_before_switch'] as const) {
      const off = pi.on(event, () => { if (!disposed) clearDisplayLineCache(); });
      if (typeof off === 'function') disposers.push(off);
    }
    if (compatibility.available('tools')) disposers.push((await import('./src/modern-tools.ts')).registerModernTools(pi, featureMode('tools'), { images: compatibility.available('images'), subagents: compatibility.available('subagents'), follow }));
    if (compatibility.available('thinking')) disposers.push((await import('./src/modern-thinking.ts')).registerModernThinking(pi, featureMode('thinking'), follow));
    if (compatibility.available('prompts')) disposers.push((await import('./src/modern-prompts.ts')).registerModernPrompts(pi, featureMode('prompts')));
    if (compatibility.available('skills')) disposers.push((await import('./src/modern-skill-prompts.ts')).registerModernSkillPrompts(pi, featureMode('skills')));
    if (compatibility.available('workflows')) disposers.push((await import('./src/modern-workflows.ts')).registerModernWorkflows(pi, featureMode('workflows')));
    if (compatibility.available('permissions')) disposers.push((await import('./src/permission-presentation.ts')).registerPermissionPresentation(pi, featureMode('permissions')));
    if (compatibility.available('subagents')) disposers.push((await import('./src/modern-subagent-messages.ts')).registerModernSubagentMessages(pi, featureMode('subagents')));
    const work: WorkStripControls = compatibility.available('work')
      ? (await import('./src/work-strip.ts')).registerWorkStrip(pi, featureMode('work'), undefined, reason => compatibility.disable('work', reason))
      : { dispose() {}, setExpanded: () => false, isShortcutEnabled: () => false, setShortcutEnabled() {} };
    disposers.push(work.dispose);
    disposers.push(registerFoldCommand(pi, mode, work, compatibility, follow));
    if (compatibility.available('inspection')) disposers.push((await import('./src/inspection.ts')).registerInspection(pi, mode, compatibility));
    const off = pi.on('session_start', (_event, ctx) => {
      if (ctx.hasUI && compatibility.state !== 'full') ctx.ui.notify?.(compatibility.describe(), 'warning');
    });
    if (typeof off === 'function') disposers.push(off);
  } catch (error) {
    dispose();
    throw error;
  }
  pi.on('session_shutdown', dispose);
}
