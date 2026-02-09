import { deepClone, domToInline } from "./utils.js";
import { renderResume } from "./render.js";

/**
 * Wires edit mode to the rendered paper.
 * - contenteditable only when editing
 * - Save reads DOM -> updates resumeJson (including order)
 */
export function attachEditor({
  outputEl,
  getState,
  setState,
}) {
  outputEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const action = btn.getAttribute("data-action");
    if (action === "edit") return enterEdit(outputEl, getState, setState);
    if (action === "cancel") return cancelEdit(outputEl, getState, setState);
    if (action === "save") return saveEdit(outputEl, getState, setState);

    // role/bullet actions only in edit mode
    const st = getState();
    if (!st.editing) return;

    if (action === "add-role") return addRoleBottom(outputEl, btn);
    if (action === "del-role") return deleteRole(outputEl, btn);
    if (action === "add-bullet") return addBullet(outputEl, btn);
    if (action === "del-bullet") return deleteBullet(outputEl, btn);
  });

  // Enter in bullet creates next bullet immediately
  outputEl.addEventListener("keydown", (e) => {
    const st = getState();
    if (!st.editing) return;

    const inline = e.target.closest('[data-inline="1"]');
    if (!inline) return;

    // only bullets: inside <li>
    const li = inline.closest("li");
    if (!li) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const ul = li.closest("ul[data-bullets]");
      const newLi = document.createElement("li");

      newLi.innerHTML = `
        <div class="editable" data-inline="1"></div>
        <button class="bulletX" data-action="del-bullet" title="Delete bullet">✖</button>
      `;

      ul.insertBefore(newLi, li.nextSibling);

      // ensure new inline becomes editable
      const newInline = newLi.querySelector('[data-inline="1"]');
      newInline.setAttribute("contenteditable", "true");
      newInline.classList.add("editable");
      newInline.focus();
    }

    // Backspace on empty bullet deletes it
    if (e.key === "Backspace") {
      const txt = (inline.textContent || "").trim();
      if (!txt) {
        e.preventDefault();
        const prev = li.previousElementSibling?.querySelector('[data-inline="1"]')
          || li.nextElementSibling?.querySelector('[data-inline="1"]');
        li.remove();
        if (prev) prev.focus();
      }
    }
  });
}

function enterEdit(outputEl, getState, setState) {
  const st = getState();
  if (!st.resumeJson) return;

  // snapshot DOM
  const paper = outputEl.querySelector("#paper");
  setState({ ...st, editing: true, snapshotHtml: paper?.innerHTML || "" });

  // re-render in editing mode (shows drag handles + buttons)
  renderResume(outputEl, st.resumeJson, { editing: true });

  // enable contenteditable
  outputEl.querySelectorAll(".editable").forEach(el => {
    el.setAttribute("contenteditable", "true");
  });

  // show/hide toolbar buttons
  const editBtn = outputEl.querySelector('[data-action="edit"]');
  const saveBtn = outputEl.querySelector('[data-action="save"]');
  const cancelBtn = outputEl.querySelector('[data-action="cancel"]');
  if (editBtn) editBtn.style.display = "none";
  if (saveBtn) saveBtn.style.display = "grid";
  if (cancelBtn) cancelBtn.style.display = "grid";

  // mark wrap as editing for css
  outputEl.querySelector(".paperWrap")?.classList.add("editing");
}

function cancelEdit(outputEl, getState, setState) {
  const st = getState();
  if (!st.editing) return;

  // restore from snapshot by re-rendering non-edit state
  setState({ ...st, editing: false, snapshotHtml: "" });
  renderResume(outputEl, st.resumeJson, { editing: false });
  wireToolbarViewMode(outputEl);
}

function wireToolbarViewMode(outputEl){
  const editBtn = outputEl.querySelector('[data-action="edit"]');
  const saveBtn = outputEl.querySelector('[data-action="save"]');
  const cancelBtn = outputEl.querySelector('[data-action="cancel"]');
  if (editBtn) editBtn.style.display = "grid";
  if (saveBtn) saveBtn.style.display = "none";
  if (cancelBtn) cancelBtn.style.display = "none";
  outputEl.querySelector(".paperWrap")?.classList.remove("editing");
}

function saveEdit(outputEl, getState, setState) {
  const st = getState();
  const src = st.resumeJson;
  if (!src) return;

  const clone = deepClone(src);

  // 1) Update header from data-path
  writeByPath(clone, "header.name", getTextByPath(outputEl, "header.name"));
  writeByPath(clone, "header.title", getTextByPath(outputEl, "header.title"));
  writeByPath(clone, "header.phone", getTextByPath(outputEl, "header.phone"));
  writeByPath(clone, "header.email", getTextByPath(outputEl, "header.email"));
  writeByPath(clone, "header.location", getTextByPath(outputEl, "header.location"));

  // 2) Sections order (DOM order wins)
  const secEls = Array.from(outputEl.querySelectorAll('[data-kind="section"]'));
  const newSections = [];

  for (const secEl of secEls) {
    const oldIdx = Number(secEl.getAttribute("data-sec"));
    const oldSec = src.sections?.[oldIdx];
    if (!oldSec) continue;

    const sec = deepClone(oldSec);

    if (sec.type === "summary") {
      const inlineEl = secEl.querySelector('[data-inline="1"]');
      sec.inline = domToInline(inlineEl);
    }

    if (sec.type === "skills") {
      const groupEls = Array.from(secEl.querySelectorAll("[data-group]"));
      sec.groups = groupEls.map((gEl) => {
        const labelEl = gEl.querySelector('[data-path$=".label"]');
        const itemsEl = gEl.querySelector('[data-items="1"]');
        const label = (labelEl?.textContent || "").trim();
        const itemsText = (itemsEl?.textContent || "").trim();
        const items = itemsText
          ? itemsText.split(",").map(x => x.trim()).filter(Boolean)
          : [];
        return { label, items };
      });
    }

    if (sec.type === "education" || sec.type === "custom") {
      const lineEls = Array.from(secEl.querySelectorAll('[data-path*=".items."][data-inline="1"]'));
      // rebuild items in DOM order
      sec.items = lineEls.map(el => ({ inline: domToInline(el) }))
        .filter(it => it.inline.some(s => (s.t||"").trim()));
    }

    if (sec.type === "experience") {
      // roles order (DOM order wins)
      const roleEls = Array.from(secEl.querySelectorAll('[data-kind="role"]'));
      sec.roles = roleEls.map((roleEl) => {
        const roleTitle = (roleEl.querySelector('[data-path$=".roleTitle"]')?.textContent || "").trim();
        const company = (roleEl.querySelector('[data-path$=".company"]')?.textContent || "").trim();
        const start = (roleEl.querySelector('[data-path$=".start"]')?.textContent || "").trim();
        const end = (roleEl.querySelector('[data-path$=".end"]')?.textContent || "").trim();

        const bulletInlineEls = Array.from(roleEl.querySelectorAll('ul[data-bullets] [data-inline="1"]'));
        const bullets = bulletInlineEls
          .map(el => ({ inline: domToInline(el) }))
          .filter(b => b.inline.some(s => (s.t||"").trim()));

        return { roleTitle, company, start, end, bullets };
      });
    }

    newSections.push(sec);
  }

  clone.sections = newSections;

  // done
  setState({ ...st, resumeJson: clone, editing: false, snapshotHtml: "" });
  renderResume(outputEl, clone, { editing: false });
  wireToolbarViewMode(outputEl);
}

/* ---------- role/bullet DOM helpers ---------- */

function addRoleBottom(outputEl, btn) {
  const secIdx = Number(btn.getAttribute("data-sec"));
  const rolesRoot = outputEl.querySelector(`#rolesRoot[data-sec="${secIdx}"]`);
  if (!rolesRoot) return;

  const rIdx = rolesRoot.querySelectorAll('[data-kind="role"]').length;

  const roleEl = document.createElement("div");
  roleEl.className = "roleCard";
  roleEl.setAttribute("data-kind", "role");
  roleEl.setAttribute("data-sec", String(secIdx));
  roleEl.setAttribute("data-role", String(rIdx));

  roleEl.innerHTML = `
    <div class="roleTop">
      <span class="roleDrag" data-drag-handle="role">⋮⋮ Drag</span>

      <div class="roleLine">
        <strong class="editable" data-path="sections.${secIdx}.roles.${rIdx}.roleTitle" contenteditable="true">Position Title</strong>
        <span> @ </span>
        <span class="editable" data-path="sections.${secIdx}.roles.${rIdx}.company" contenteditable="true">Company Name</span>
        <span> | </span>
        <span class="editable" data-path="sections.${secIdx}.roles.${rIdx}.start" contenteditable="true">Month YYYY</span>
        <span> – </span>
        <span class="editable" data-path="sections.${secIdx}.roles.${rIdx}.end" contenteditable="true">Present</span>
      </div>

      <div class="miniActions">
        <button class="miniBtn" data-action="add-bullet" data-sec="${secIdx}" data-role="${rIdx}">+ Bullet</button>
        <button class="miniBtn danger" data-action="del-role" data-sec="${secIdx}" data-role="${rIdx}">✖</button>
      </div>
    </div>

    <ul class="bullets" data-bullets="1">
      <li>
        <div class="editable" data-inline="1" contenteditable="true">Add your first impact bullet (Ctrl/Cmd+B to bold tech/metrics).</div>
        <button class="bulletX" data-action="del-bullet" data-sec="${secIdx}" data-role="${rIdx}" data-bullet="0">✖</button>
      </li>
    </ul>
  `;

  rolesRoot.appendChild(roleEl); // ✅ bottom
}

function deleteRole(outputEl, btn) {
  const secIdx = Number(btn.getAttribute("data-sec"));
  const roleIdx = Number(btn.getAttribute("data-role"));
  const roleEl = outputEl.querySelector(`[data-kind="role"][data-sec="${secIdx}"][data-role="${roleIdx}"]`);
  roleEl?.remove();
}

function addBullet(outputEl, btn) {
  const secIdx = Number(btn.getAttribute("data-sec"));
  const roleIdx = Number(btn.getAttribute("data-role"));

  const roleEl = outputEl.querySelector(`[data-kind="role"][data-sec="${secIdx}"][data-role="${roleIdx}"]`);
  const ul = roleEl?.querySelector('ul[data-bullets]');
  if (!ul) return;

  const li = document.createElement("li");
  li.innerHTML = `
    <div class="editable" data-inline="1" contenteditable="true"></div>
    <button class="bulletX" data-action="del-bullet" data-sec="${secIdx}" data-role="${roleIdx}" title="Delete bullet">✖</button>
  `;
  ul.appendChild(li);
  li.querySelector('[data-inline="1"]')?.focus();
}

function deleteBullet(outputEl, btn) {
  const li = btn.closest("li");
  li?.remove();
}

/* ---------- generic path helpers ---------- */
function getTextByPath(root, path) {
  const el = root.querySelector(`[data-path="${cssEscape(path)}"]`);
  return (el?.textContent || "").trim();
}
function writeByPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!(p in cur)) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}
function cssEscape(s){
  // minimal for dots in attribute selector already quoted, just return original
  return s;
}
