import * as core from '@earendil-works/pi-coding-agent';
import * as tui from '@earendil-works/pi-tui';

/** Versions are evidence from CI, never a condition for enabling display features. */
export const testedPiVersions = ['1.3.0', '1.4.0'] as const;
const rendering = ['Markdown', 'matchesKey', 'truncateToWidth', 'visibleWidth', 'wrapTextWithAnsi'];
const richText = ['getMarkdownTheme', 'highlightCode'];
const panes = [...rendering, 'MouseRegion', 'Spacer', 'Text'];
const requirements = {
  tools: { api: ['registerToolRenderer', 'events.on', 'events.emit'], core: richText, tui: [...rendering, 'Box', 'Box.prototype.setBgFn', 'Box.prototype.setPaddingX', 'Box.prototype.clear', 'Box.prototype.addChild', 'Box.prototype.render', 'Container', 'Container.prototype.clear', 'Container.prototype.render', 'Text', 'stripTerminalSequences'] },
  images: { core: ['ToolExecutionComponent.prototype.render', 'ToolExecutionComponent.prototype.updateDisplay'], tui: ['Image', 'getCapabilities', 'imageFallback'] },
  thinking: { core: [...richText, 'AssistantMessageComponent.prototype.render', 'AssistantMessageComponent.prototype.updateContent', 'AssistantMessageComponent.prototype.setHideThinkingBlock'], tui: panes },
  prompts: { api: ['registerMarkdownTransformer', 'getCommands'], core: ['UserMessageComponent.prototype.render', 'UserMessageComponent.prototype.rebuild'], tui: ['Markdown', 'matchesKey', 'stripTerminalSequences', 'truncateToWidth'] },
  skills: { core: ['InteractiveMode.prototype.addMessageToChat', 'SkillInvocationMessageComponent.prototype.setExpanded', 'SkillInvocationMessageComponent.prototype.render', 'UserMessageComponent.prototype.render'], tui: [...panes, 'Box', 'Container', 'stripTerminalSequences'] },
  workflows: { core: [...richText, 'AssistantMessageComponent.prototype.render', 'AssistantMessageComponent.prototype.updateContent'], tui: [...panes, 'Container'] },
  subagents: { core: [...richText, 'ExtensionRunner.prototype.getMessageRenderer', 'ExtensionRunner.prototype.getEntryRenderer', 'CustomMessageComponent'], tui: [...rendering, 'Container.prototype.render'] },
  work: { api: ['appendEntry'], core: [...richText, 'InteractiveMode.prototype.addMessageToChat', 'InteractiveMode.prototype.handleEvent', 'InteractiveMode.prototype.renderSessionItems', 'AssistantMessageComponent', 'CustomMessageComponent', 'SkillInvocationMessageComponent', 'ToolExecutionComponent', 'UserMessageComponent'], tui: [...panes, 'Container', 'Box'] },
  inspection: { api: ['events.on', 'events.emit'], tui: ['Box', 'Container', 'Markdown', 'truncateToWidth', 'visibleWidth'] },
  reveal: { tui: ['ScrollView.prototype.scrollTo', 'ScrollView.prototype.getContentWidth', 'isViewportTUI'] },
  overlays: { tui: ['TuiAltScreen.prototype.compositeOverlays', 'TuiAltScreen.prototype.prepareKittyScreen'] },
  permissions: { api: ['events.on'], tui: ['getKeybindings', 'matchesKey', 'truncateToWidth', 'visibleWidth', 'wrapTextWithAnsi'] },
} as const;
export type FoldFeature = keyof typeof requirements;
const labels: Record<FoldFeature, string> = { tools: 'Tool cards', images: 'Tool images', thinking: 'Thinking', prompts: 'Prompt folding', skills: 'Skill prompts', workflows: 'Workflow panes', subagents: 'Subagent groups', work: 'Work sections', inspection: 'Inspection picker', reveal: 'Inspection scrolling', overlays: 'Overlay protection', permissions: 'Permission presentation' };
const method = (object: any, path: string) => typeof path.split('.').reduce((value, key) => value?.[key], object) === 'function';

/** Probe once before loading feature modules. Instance guards still protect each native row. */
export function inspectRuntime(api: any, agent: any = core, terminal: any = tui) {
  const failures = new Map<FoldFeature, string[]>();
  for (const [feature, needs] of Object.entries(requirements)) {
    const missing: string[] = [];
    for (const [source, paths] of Object.entries(needs)) {
      const object = source === 'api' ? api : source === 'core' ? agent : terminal;
      for (const path of paths) if (!method(object, path)) missing.push(`${source}.${path}`);
    }
    for (const path of ['on', 'registerCommand', 'events.on', 'events.emit']) if (!method(api, path)) missing.push(`api.${path}`);
    failures.set(feature as FoldFeature, missing);
  }
  const dependencies: Partial<Record<FoldFeature, FoldFeature>> = { images: 'tools', reveal: 'inspection', overlays: 'inspection' };
  const available = (feature: FoldFeature): boolean => !failures.get(feature)?.length && (!dependencies[feature] || available(dependencies[feature]!));
  return {
    version: typeof agent.VERSION === 'string' ? agent.VERSION : 'unknown',
    available,
    disable(feature: FoldFeature, reason: string) { const reasons = failures.get(feature)!; if (!reasons.includes(reason)) reasons.push(reason); },
    get state(): 'full' | 'partial' | 'unavailable' {
      const features = Object.keys(requirements) as FoldFeature[];
      const count = features.filter(available).length;
      return count === features.length ? 'full' : count ? 'partial' : 'unavailable';
    },
    describe() {
      const disabled = (Object.keys(requirements) as FoldFeature[]).filter(feature => !available(feature));
      return `Compatibility: ${this.state} (Pi ${this.version})` + disabled.map(feature => `\n${labels[feature]} unavailable: ${failures.get(feature)?.join(', ') || `${labels[dependencies[feature]!]} unavailable`}`).join('');
    },
  };
}
export type RuntimeCompatibility = ReturnType<typeof inspectRuntime>;
