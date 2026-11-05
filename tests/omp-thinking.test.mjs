import assert from 'node:assert/strict';

// Called by the OMP/Bun native smoke harness with OMP's actual class identities.
export function assertOmpThinkingBehavior(surface, installOmpThinkingAdapter) {
  const { AssistantMessageComponent } = surface;
  const proto = AssistantMessageComponent.prototype;
  const originals = Object.fromEntries(['render', 'describe', 'updateContent', 'dispose', 'setHideThinkingBlock', 'handleNativeEvent', 'markTranscriptBlockFinalized'].map(key => [key, proto[key]]));
  let enabled = true;
  const listeners = new Set();
  const mode = {
    isEnabled: () => enabled,
    onChange(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    setEnabled(value) { enabled = value; for (const callback of [...listeners]) callback(); },
  };
  const plain = rows => rows.map(row => row.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, '')).filter(row => row.trim());
  const message = content => ({ role: 'assistant', content, api: 'anthropic-messages', provider: 'anthropic', model: 'native-thinking-regression', stopReason: 'stop', timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoningTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const thinking = text => ({ type: 'thinking', thinking: text });
  const text = value => ({ type: 'text', text: value });
  const section = node => node.c.find(child => child.k === 'section' && /^k\d+$/.test(child.key || ''));
  const instances = [];
  let dispose = installOmpThinkingAdapter(surface, mode);
  assert.equal(typeof dispose, 'function', 'real OMP component seam is supported');
  try {
    for (const hidden of [true, false]) {
      const component = new AssistantMessageComponent(undefined, hidden);
      instances.push(component);
      const first = message([thinking('earlier line\nlatest recorded line')]);
      const serialized = JSON.stringify(first);
      component.updateContent(first, { transient: true });
      const firstRows = plain(component.render(80));
      assert.equal(firstRows.length, 1);
      assert.match(firstRows[0], /latest recorded line/);
      assert.doesNotMatch(firstRows[0], /earlier line/);
      assert.equal(section(component.describe()).p.collapsed, true, 'native streaming body is folded');
      assert.match(JSON.stringify(section(component.describe()).c[0]), /latest recorded line/);
      assert.equal(JSON.stringify(first), serialized, 'rendering does not mutate recorded content');
      const huge = message([thinking(`${'old text '.repeat(30000)}\n${'x'.repeat(400)} newest tail`)]);
      component.updateContent(huge, { transient: true });
      const latest = plain(component.render(80));
      assert.equal(latest.length, 1, 'streaming never accumulates old thinking rows');
      assert.match(latest[0], /newest tail/);
      assert.ok(latest[0].length <= 80);
      component.markTranscriptBlockFinalized();
      assert.equal(plain(component.render(80)).length, 1);
      assert.match(plain(component.render(80))[0], /Thought ·/);
      const folded = section(component.describe());
      assert.equal(folded.p.collapsed, true);
      component.handleNativeEvent({ type: 'toggle', key: folded.key, collapsed: false });
      assert.equal(section(component.describe()).p.collapsed, false, 'native section expansion survives');
      mode.setEnabled(false);
      assert.deepEqual(component.render(80), originals.render.call(component, 80), 'off is exact native ANSI');
      assert.strictEqual(component.describe(), originals.describe.call(component), 'off is exact native TSP');
      mode.setEnabled(true);
    }

    const mixed = new AssistantMessageComponent(undefined, false);
    instances.push(mixed);
    const reply = message([text('First native prose'), thinking('Recorded reasoning'), text('Last native prose')]);
    reply.stopReason = 'aborted';
    reply.errorMessage = 'Native failure remains visible';
    mixed.updateContent(reply);
    const recorded = JSON.stringify(reply);
    const stock = originals.describe.call(mixed);
    const compact = mixed.describe();
    const stockNonThinking = stock.c.filter(node => node.k !== 'section');
    assert.deepEqual(compact.c.filter(node => node.k !== 'section'), stockNonThinking, 'native prose/error nodes keep their order and identities');
    const painted = plain(mixed.render(80)).join('\n');
    assert.ok(painted.indexOf('First native prose') < painted.indexOf('Thought ·'));
    assert.ok(painted.indexOf('Thought ·') < painted.indexOf('Last native prose'));
    assert.equal(JSON.stringify(reply), recorded);

    const imageReply = message([text('Before image'), thinking('Image reasoning'), { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }, text('After image')]);
    mixed.updateContent(imageReply);
    const imageStock = originals.describe.call(mixed);
    const imageCompact = mixed.describe();
    assert.deepEqual(imageCompact.c.filter(node => node.k !== 'section'), imageStock.c.filter(node => node.k !== 'section'), 'native image/prose order remains untouched');
    assert.equal(section(imageCompact).p.collapsed, true);

    // A new registration owns the seam; an older disposer cannot detach it.
    const oldDispose = dispose;
    dispose = installOmpThinkingAdapter(surface, mode);
    oldDispose();
    const reloaded = new AssistantMessageComponent(undefined, true);
    instances.push(reloaded);
    reloaded.updateContent(message([thinking('After reload')]), { transient: true });
    assert.match(plain(reloaded.render(80))[0], /Thinking · After reload/);
    dispose();
    for (const [key, original] of Object.entries(originals)) assert.strictEqual(proto[key], original, `${key} is restored on disposal`);
    assert.equal(listeners.size, 0, 'reload/disposal leave no mode listeners');
    assert.deepEqual(reloaded.render(80), originals.render.call(reloaded, 80));
  } finally {
    dispose?.();
    for (const component of instances) component.dispose();
  }
}
