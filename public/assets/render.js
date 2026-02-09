import { escapeHtml, inlineToHtml } from "./utils.js";

export function renderResume(outputEl, resumeJson, { editing = false } = {}) {
  const h = resumeJson?.header || {};
  const sections = Array.isArray(resumeJson?.sections) ? resumeJson.sections : [];

  outputEl.innerHTML = `
    <div class="banner" id="banner"></div>

    <div class="paperWrap ${editing ? "editing" : ""}">
      <div class="paperToolbar">
        <button class="iconBtn" data-action="edit" title="Edit" aria-label="Edit">
          ${pencilSvg()}
        </button>
        <button class="iconBtn" data-action="save" title="Save" aria-label="Save" style="display:none;">
          ${checkSvg()}
        </button>
        <button class="iconBtn" data-action="cancel" title="Cancel" aria-label="Cancel" style="display:none;">
          ${xSvg()}
        </button>
      </div>

      <div class="paper" id="paper">
        <h1 class="hName">
          <span class="editable" data-path="header.name">${escapeHtml(h.name || "")}</span>
          <span> - </span>
          <span class="editable" data-path="header.title">${escapeHtml(h.title || "")}</span>
        </h1>

        <div class="hContact">
          <span class="editable" data-path="header.phone">${escapeHtml(h.phone || "")}</span>
          <span> | </span>
          <span class="editable" data-path="header.email">${escapeHtml(h.email || "")}</span>
          <span> | </span>
          <span class="editable" data-path="header.location">${escapeHtml(h.location || "")}</span>
        </div>

        <div id="sectionsRoot">
          ${sections.map((sec, sIdx) => renderSection(sec, sIdx)).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderSection(sec, sIdx) {
  const heading = escapeHtml(sec.heading || "");
  const type = sec.type || "custom";

  // section container is draggable in edit mode (enabled by drag.js)
  const headRow = `
    <div class="sectionRow">
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="dragHandle" data-drag-handle="section">⋮⋮</span>
        <div class="secHead">${heading}</div>
      </div>
      <div class="miniActions">
        <span class="dragHandle" data-drag-handle="section">Drag</span>
      </div>
    </div>
    <div class="rule"></div>
  `;

  if (type === "summary") {
    return `
      <section class="section" data-sec="${sIdx}" data-kind="section" data-type="summary" draggable="false">
        ${headRow}
        <div class="editable" data-path="sections.${sIdx}.inline" data-inline="1">${inlineToHtml(sec.inline)}</div>
      </section>
    `;
  }

  if (type === "skills") {
    const groups = Array.isArray(sec.groups) ? sec.groups : [];
    return `
      <section class="section" data-sec="${sIdx}" data-kind="section" data-type="skills" draggable="false">
        ${headRow}
        ${groups.map((g, gIdx) => `
          <div class="skillRow" data-group="${gIdx}">
            <strong class="editable" data-path="sections.${sIdx}.groups.${gIdx}.label">${escapeHtml(g.label || "")}</strong>:
            <span class="editable" data-path="sections.${sIdx}.groups.${gIdx}.items" data-items="1">${escapeHtml((g.items||[]).join(", "))}</span>
          </div>
        `).join("")}
      </section>
    `;
  }

  if (type === "experience") {
    const roles = Array.isArray(sec.roles) ? sec.roles : [];
    return `
      <section class="section" data-sec="${sIdx}" data-kind="section" data-type="experience" draggable="false">
        ${headRow}

        <div id="rolesRoot" data-sec="${sIdx}">
          ${roles.map((r, rIdx) => renderRole(sIdx, r, rIdx)).join("")}
        </div>

        <div class="addBar">
          <button class="miniBtn primary" data-action="add-role" data-sec="${sIdx}">+ Add Work Experience</button>
        </div>
      </section>
    `;
  }

  if (type === "education") {
    const items = Array.isArray(sec.items) ? sec.items : [];
    return `
      <section class="section" data-sec="${sIdx}" data-kind="section" data-type="education" draggable="false">
        ${headRow}
        ${items.map((it, iIdx) => `
          <div class="editable" data-path="sections.${sIdx}.items.${iIdx}.inline" data-inline="1">${inlineToHtml(it.inline)}</div>
        `).join("")}
      </section>
    `;
  }

  // generic fallback
  const lines = Array.isArray(sec.items) ? sec.items : [];
  return `
  <section class="sec" data-sec="${sIdx}" data-type="${sec.type}" draggable="true">
    <div class="secBar">
      <span class="secDrag" title="Drag section">⋮⋮</span>
      <div class="secHead">${heading}</div>
    </div>
    <div class="rule"></div>
    ... existing section content ...
  </section>
  `;
}

function renderRole(sIdx, r, rIdx) {
  const bullets = Array.isArray(r.bullets) ? r.bullets : [];
  return `
    <div class="roleCard" data-kind="role" data-sec="${sIdx}" data-role="${rIdx}" draggable="false">
      <div class="roleTop">
        <span class="roleDrag" data-drag-handle="role">⋮⋮ Drag</span>

        <div class="roleLine editable" data-path="sections.${sIdx}.roles.${rIdx}.roleLine" data-roleline="1">
          <strong class="editable" data-path="sections.${sIdx}.roles.${rIdx}.roleTitle">${escapeHtml(r.roleTitle || "")}</strong>
          <span> @ </span>
          <span class="editable" data-path="sections.${sIdx}.roles.${rIdx}.company">${escapeHtml(r.company || "")}</span>
          <span> | </span>
          <span class="editable" data-path="sections.${sIdx}.roles.${rIdx}.start">${escapeHtml(r.start || "")}</span>
          <span> – </span>
          <span class="editable" data-path="sections.${sIdx}.roles.${rIdx}.end">${escapeHtml(r.end || "")}</span>
        </div>

        <div class="miniActions">
          <button class="miniBtn" data-action="add-bullet" data-sec="${sIdx}" data-role="${rIdx}">+ Bullet</button>
          <button class="miniBtn danger" data-action="del-role" data-sec="${sIdx}" data-role="${rIdx}">✖</button>
        </div>
      </div>

      <ul class="bullets" data-bullets="1">
        ${bullets.map((b, bIdx) => `
          <li>
            <div class="editable" data-path="sections.${sIdx}.roles.${rIdx}.bullets.${bIdx}.inline" data-inline="1">
              ${inlineToHtml(b.inline)}
            </div>
            <button class="bulletX" data-action="del-bullet" data-sec="${sIdx}" data-role="${rIdx}" data-bullet="${bIdx}" title="Delete bullet">✖</button>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function pencilSvg(){return `<svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="#0b1324" stroke-width="2" stroke-linecap="round"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" stroke="#0b1324" stroke-width="2" stroke-linejoin="round"/></svg>`;}
function checkSvg(){return `<svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#0b1324" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;}
function xSvg(){return `<svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="#0b1324" stroke-width="2" stroke-linecap="round"/></svg>`;}
