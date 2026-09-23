// SPDX-License-Identifier: GPL-3.0-or-later
export function createViews(parts) {
  const groups = [], singles = [];
  parts.forEach((part, partIndex) => {
    const prefixes = new Map();
    const partLabel = parts.length > 1 ? `${part.name || `Part ${partIndex + 1}`} / ` : '';
    const labelFor = name => part.name && (name === part.name || name.startsWith(part.name + '.')) ? name : partLabel + name;
    part.channels.forEach((name, index) => {
      const dot = name.lastIndexOf('.');
      const prefix = dot < 0 ? '' : name.slice(0, dot);
      const suffix = name.slice(dot + 1).toUpperCase();
      if (!prefixes.has(prefix)) prefixes.set(prefix, new Map());
      prefixes.get(prefix).set(suffix, index);
      singles.push({ id: `p${partIndex}:c${index}`, part: partIndex, kind: 'channel', label: labelFor(name), components: [index, index, index], color: false });
    });
    for (const [prefix, channels] of prefixes) {
      const axes = ['R', 'G', 'B'].every(c => channels.has(c)) ? ['R', 'G', 'B']
        : ['X', 'Y', 'Z'].every(c => channels.has(c)) ? ['X', 'Y', 'Z'] : null;
      if (axes) groups.push({ id: `p${partIndex}:g${prefix}`, part: partIndex, kind: 'group', label: labelFor(prefix || (axes[0] === 'R' ? 'RGB' : 'XYZ')), components: axes.map(c => channels.get(c)), color: axes[0] === 'R' });
    }
  });
  const compare = (a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  const beauty = v => /(^|[. /])(combined|beauty|rgba?|rgb)$/i.test(v.label) ? 0 : 1;
  groups.sort((a, b) => beauty(a) - beauty(b) || compare(a, b));
  singles.sort(compare);
  return [...groups, ...singles];
}

export function nextView(selected, count) { return count > 0 ? (selected + 1) % count : 0; }

export function handleViewerKey(state, event, count) {
  if (!count || event.repeat || event.editable || event.ctrlKey || event.metaKey || event.altKey) return state;
  switch (event.key.toLowerCase()) {
    case 's': return { ...state, selected: nextView(state.selected, count) };
    case 'a': return { ...state, grid: !state.grid };
    default: return state;
  }
}

// The layer list keeps RGB/XYZ together; independent data channels remain available.
export function createLayerViews(parts) {
  const all = createViews(parts), covered = new Set();
  const groups = all.filter(view => view.kind === 'group').map(view => {
    const prefix = view.id.slice(view.id.indexOf(':g') + 2);
    const channels = {};
    parts[view.part].channels.forEach((name, index) => {
      const dot = name.lastIndexOf('.');
      if ((dot < 0 ? '' : name.slice(0, dot)) === prefix) channels[name.slice(dot + 1).toUpperCase()] = index;
    });
    for (const index of [...view.components, ...(view.color && channels.A !== undefined ? [channels.A] : [])]) covered.add(`p${view.part}:c${index}`);
    return { ...view, channels };
  });
  return [...groups, ...all.filter(view => view.kind === 'channel' && !covered.has(view.id))];
}

export function componentView(layer, component) {
  if (component === 'RGBA' || !layer.color || layer.channels?.[component] === undefined) return layer;
  const index = layer.channels[component];
  return { ...layer, components: [index,index,index], color: false, component };
}
