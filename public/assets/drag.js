/**
 * Enables drag & drop reordering for:
 * - sections: [data-kind="section"]
 * - roles inside experience: [data-kind="role"]
 *
 * Uses HTML5 DnD.
 */
export function enableDrag(outputEl, getState) {
  let draggingEl = null;

  outputEl.addEventListener("dragstart", (e) => {
    const st = getState();
    if (!st.editing) return;

    const handle = e.target.closest("[data-drag-handle]");
    if (!handle) return;

    // section drag
    const section = handle.closest('[data-kind="section"]');
    const role = handle.closest('[data-kind="role"]');

    if (handle.getAttribute("data-drag-handle") === "section" && section) {
      draggingEl = section;
      section.classList.add("dragging");
      section.setAttribute("draggable", "true");
      e.dataTransfer.effectAllowed = "move";
      return;
    }

    if (handle.getAttribute("data-drag-handle") === "role" && role) {
      draggingEl = role;
      role.classList.add("dragging");
      role.setAttribute("draggable", "true");
      e.dataTransfer.effectAllowed = "move";
      return;
    }
  });

  outputEl.addEventListener("dragend", () => {
    if (draggingEl) {
      draggingEl.classList.remove("dragging");
      draggingEl.setAttribute("draggable", "false");
      draggingEl = null;
    }
  });

  outputEl.addEventListener("dragover", (e) => {
    const st = getState();
    if (!st.editing) return;
    if (!draggingEl) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    // target based on type
    if (draggingEl.getAttribute("data-kind") === "section") {
      const over = e.target.closest('[data-kind="section"]');
      if (!over || over === draggingEl) return;
      swapByCursor(over, draggingEl, e.clientY);
      return;
    }

    if (draggingEl.getAttribute("data-kind") === "role") {
      const over = e.target.closest('[data-kind="role"]');
      if (!over || over === draggingEl) return;

      // must be within same experience section
      const overSec = over.getAttribute("data-sec");
      const dragSec = draggingEl.getAttribute("data-sec");
      if (overSec !== dragSec) return;

      swapByCursor(over, draggingEl, e.clientY);
    }
  });

  function swapByCursor(over, dragging, mouseY){
    const rect = over.getBoundingClientRect();
    const before = mouseY < rect.top + rect.height / 2;
    const parent = over.parentElement;
    if (before) parent.insertBefore(dragging, over);
    else parent.insertBefore(dragging, over.nextSibling);
  }
}
