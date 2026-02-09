export function api(url, opts = {}) {
  return fetch(url, { credentials: "include", ...opts });
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

export function inlineToHtml(inline) {
  const segs = Array.isArray(inline) ? inline : [];
  return segs.map(seg => seg?.b
    ? `<strong>${escapeHtml(seg.t)}</strong>`
    : escapeHtml(seg.t)
  ).join("");
}

/** DOM -> inline[] preserving <strong> */
export function domToInline(el) {
  const segs = [];
  function walk(node, bold) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.nodeValue || "";
      if (t) segs.push({ t, b: !!bold });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const isStrong = node.tagName === "STRONG" || node.tagName === "B";
    const nextBold = bold || isStrong;
    for (const child of node.childNodes) walk(child, nextBold);
  }
  walk(el, false);

  // normalize NBSP + keep spacing between segments
  const out = [];
  for (const seg of segs) {
    let t = String(seg.t ?? "").replace(/\u00A0/g, " ");
    if (!t) continue;

    const prev = out[out.length - 1];
    if (prev) {
      const prevEndsSpace = /\s$/.test(prev.t);
      const curStartsSpace = /^\s/.test(t);
      const curStartsPunct = /^[,.;:!?)]/.test(t);
      if (!prevEndsSpace && !curStartsSpace && !curStartsPunct) prev.t += " ";
    }
    out.push({ t, b: !!seg.b });
  }

  // merge adjacent with same bold
  const merged = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && last.b === s.b) last.t += s.t;
    else merged.push({ t: s.t, b: s.b });
  }
  return merged.length ? merged : [{ t: "", b: false }];
}

export function deepClone(x) {
  return JSON.parse(JSON.stringify(x));
}

export function getFilenameFromDisposition(disposition) {
  if (!disposition) return null;
  const m1 = /filename="([^"]+)"/i.exec(disposition);
  if (m1 && m1[1]) return m1[1];
  const m2 = /filename=([^;]+)/i.exec(disposition);
  if (m2 && m2[1]) return m2[1].trim();
  return null;
}
