// keyed DOM patch：只改需要改的节点，不做动画、不读布局。
// 动画由调用方把 entered/moved 交给 motion.js。

export function diffKeys(previousKeys, nextKeys) {
  const previousIndex = new Map(previousKeys.map((key, index) => [key, index]));
  const nextIndex = new Map(nextKeys.map((key, index) => [key, index]));
  const entered = [];
  const exited = [];
  const moved = [];
  const stable = [];

  for (const key of nextKeys) {
    if (!previousIndex.has(key)) {
      entered.push(key);
      continue;
    }
    if (previousIndex.get(key) !== nextIndex.get(key)) moved.push(key);
    else stable.push(key);
  }
  for (const key of previousKeys) {
    if (!nextIndex.has(key)) exited.push(key);
  }

  return { entered, exited, moved, stable, reordered: moved.length > 0 };
}

function keyedChildren(container) {
  const map = new Map();
  for (const child of Array.from(container.children)) {
    const key = child.dataset?.key;
    if (key !== undefined) map.set(key, child);
  }
  return map;
}

export function patchKeyed(container, items, options = {}) {
  const { keyOf = (item) => item.key ?? item.id, create, update, exit } = options;
  if (typeof create !== "function") throw new TypeError("patchKeyed needs create(item)");

  const list = Array.from(items ?? []);
  const nextKeys = list.map((item, index) => {
    const key = String(keyOf(item, index));
    if (!key) throw new Error("patchKeyed: empty key");
    return key;
  });
  if (new Set(nextKeys).size !== nextKeys.length) {
    throw new Error("patchKeyed: duplicate key");
  }

  const before = keyedChildren(container);
  const previousKeys = Array.from(before.keys());
  const diff = diffKeys(previousKeys, nextKeys);
  const entered = [];
  const exited = [];
  const moved = [];
  const updated = [];

  for (const key of diff.exited) {
    const el = before.get(key);
    if (!el) continue;
    if (typeof exit === "function") exit(el, key);
    else el.remove();
    exited.push(el);
  }

  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const key = nextKeys[index];
    let el = before.get(key);
    const isNew = !el;
    if (isNew) {
      el = create(item, index);
      if (!(el instanceof Element)) throw new TypeError("patchKeyed: create must return an Element");
      el.dataset.key = key;
      entered.push(el);
    } else if (el.dataset.key !== key) {
      el.dataset.key = key;
    }
    if (typeof update === "function") {
      update(el, item, index);
      updated.push(el);
    }
    const at = container.children[index] ?? null;
    if (at !== el) container.insertBefore(el, at);
  }

  for (const key of diff.moved) {
    const el = before.get(key);
    if (el) moved.push(el);
  }

  return { entered, exited, moved, updated, diff };
}

export function patchText(el, text) {
  const next = String(text ?? "");
  if (el && el.textContent !== next) el.textContent = next;
  return el;
}

export function patchClass(el, className, on) {
  if (!el || !className) return el;
  el.classList.toggle(className, Boolean(on));
  return el;
}

export function patchAttr(el, name, value) {
  if (!el) return el;
  if (value === null || value === undefined || value === false) el.removeAttribute(name);
  else el.setAttribute(name, String(value));
  return el;
}
