import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { DisplayMode } from './display-mode.ts';
import type { WorkStripControls } from './work-strip.ts';

import type { RuntimeCompatibility } from './runtime-compatibility.ts';

type FoldMode = DisplayMode & { setEnabled(enabled: boolean): boolean };

/** One session-local command owns display mode, follow display, work expansion, and its shortcut. */
export function registerFoldCommand(pi: ExtensionAPI, mode: FoldMode, work: WorkStripControls, compatibility?: RuntimeCompatibility, follow?: FoldMode): () => void {
  let disposed = false;
  pi.registerCommand('fold', {
    description: 'Choose Pi Fold display, collapse or expand work, or set its shortcut',
    async handler(args, ctx) {
      if (disposed) return;
      let choice = args.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
      if (!choice && ctx.hasUI) {
        const current = mode.isEnabled() ? 'on' : 'off';
        const choices = [
          `on${current === 'on' ? ' (current)' : ''} — fold work and recorded thinking`,
          `off${current === 'off' ? ' (current)' : ''} — native display`,
          'collapse — collapse completed work sections',
          'expand — expand all work sections',
          'shortcut — choose Ctrl+Alt+W shortcut',
          'status — show compatibility details',
          ...(follow ? [`follow${follow.isEnabled() ? ' (current)' : ''} — keep the running action open`] : []),
        ];
        const selected = await ctx.ui.select('Pi Fold — this session', choices);
        if (disposed || selected === undefined) return;
        const index = choices.indexOf(selected);
        if (index < 0) return;
        choice = ['on', 'off', 'collapse', 'expand', 'shortcut', 'status', 'follow'][index];
        if (choice === current) return;
      }
      if (['', 'status', 'on', 'off', 'toggle'].includes(choice)) {
        if (compatibility?.state === 'unavailable') { ctx.ui.notify(compatibility.describe() + '\nNative display remains active.', 'warning'); return; }
        if (choice === 'on' || choice === 'off' || choice === 'toggle') {
          mode.setEnabled(choice === 'toggle' ? !mode.isEnabled() : choice === 'on');
        }
        ctx.ui.notify(`Pi Fold ${mode.isEnabled() ? 'on' : 'off'}` + (compatibility ? `\n${compatibility.describe()}` : ''), compatibility && compatibility.state !== 'full' ? 'warning' : 'info');
      } else if (choice === 'collapse' || choice === 'expand') {
        if (!mode.isEnabled()) {
          ctx.ui.notify(`Turn Pi Fold on with /fold on before you ${choice} work sections.`, 'info');
          return;
        }
        const changed = work.setExpanded(choice === 'expand');
        ctx.ui.notify(changed ? `Work sections ${choice === 'expand' ? 'expanded' : 'collapsed'}` : 'Work sections are unavailable in this session.', 'info');
      } else if (['shortcut', 'shortcut on', 'shortcut off'].includes(choice)) {
        let enabled = choice === 'shortcut' ? undefined : choice === 'shortcut on';
        if (enabled === undefined && ctx.hasUI) {
          const current = work.isShortcutEnabled() ? 'on' : 'off';
          const choices = ['on', 'off'].map(value => `${value}${value === current ? ' (current)' : ''}`);
          const selected = await ctx.ui.select('Toggle work shortcut — Ctrl+Alt+W', choices);
          if (disposed || selected === undefined || !choices.includes(selected)) return;
          enabled = selected === choices[0];
          if (enabled === work.isShortcutEnabled()) return;
        }
        if (enabled !== undefined) work.setShortcutEnabled(enabled);
        ctx.ui.notify(`Toggle work shortcut: ${work.isShortcutEnabled() ? 'on' : 'off'}`, 'info');
      } else if (['follow', 'follow on', 'follow off'].includes(choice)) {
        if (!follow) { ctx.ui.notify('Follow display is unavailable in this session.', 'info'); return; }
        let enabled: boolean | undefined = choice === 'follow' ? undefined : choice === 'follow on';
        if (enabled === undefined && ctx.hasUI) {
          const choices = ['on', 'off'].map(value => `${value}${(value === 'on') === follow.isEnabled() ? ' (current)' : ''}`);
          const selected = await ctx.ui.select('Keep the running action open — follow', choices);
          if (disposed || selected === undefined || !choices.includes(selected)) return;
          enabled = selected === choices[0];
        }
        if (enabled !== undefined) follow.setEnabled(enabled);
        ctx.ui.notify(`Follow the running action: ${follow.isEnabled() ? 'on' : 'off'}`, 'info');
      } else {
        ctx.ui.notify('Use /fold [on|off|toggle|status|collapse|expand|follow [on|off]|shortcut [on|off]]', 'info');
      }
    },
  });
  return () => { disposed = true; };
}
