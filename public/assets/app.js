import { api, getFilenameFromDisposition } from "./utils.js";
import { renderResume } from "./render.js";
import { attachEditor } from "./edit.js";
import { enableDrag } from "./drag.js";


const welcome = document.getElementById("welcome");
const logoutBtn = document.getElementById("logoutBtn");
const generateBtn = document.getElementById("generateBtn");
const copyBtn = document.getElementById("copyBtn");
const wordBtn = document.getElementById("wordBtn");
const pdfBtn = document.getElementById("pdfBtn");
const output = document.getElementById("output");
const banner = document.getElementById("banner");
const hint = document.getElementById("hint");
const jdEl = document.getElementById("jd");
const companyEl = document.getElementById("companyName");


const state = {
  resumeJson: null,
  editing: false,
  snapshotHtml: "",
};
const getState = () => state;
const setState = (next) => {
  state.resumeJson = next.resumeJson ?? state.resumeJson;
  state.editing = next.editing ?? state.editing;
  state.snapshotHtml = next.snapshotHtml ?? state.snapshotHtml;
};

function isUrl(text) {
  return /^https?:\/\//i.test(text.trim());
}

function showError(msg) {
  const b = document.getElementById("banner") || banner;
  if (!b) return;
  b.style.display = "block";
  b.textContent = msg;
}
function clearError() {
  const b = document.getElementById("banner") || banner;
  if (!b) return;
  b.style.display = "none";
  b.textContent = "";
}
function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

attachEditor({ outputEl: output, getState, setState });
enableDrag(output, getState);

async function loadMe() {
  const res = await api("/me");
  if (!res.ok) { window.location.href = "/login"; return; }
  const data = await res.json().catch(() => ({}));
  const name = data?.user?.firstname || data?.user?.username || "";
  welcome.textContent = `Welcome ${name}`;
}

logoutBtn.addEventListener("click", async () => {
  await api("/logout", { method: "POST" });
  window.location.href = "/login";
});

// Optional: if user types company manually, don't overwrite from URL later
companyEl.dataset.userLocked = "0";

companyEl.addEventListener("input", () => {
  companyEl.dataset.userLocked = "1";
});


copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.resumeJson || {}, null, 2));
    copyBtn.textContent = "Copied";
    setTimeout(() => copyBtn.textContent = "Copy JSON", 900);
  } catch {
    alert("Copy failed. Please copy manually.");
  }
});

wordBtn.addEventListener("click", async () => {
  try {
    wordBtn.disabled = true;
    const companyName = (companyEl.value || "").trim();

    const res = await api("/download-word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeJson: state.resumeJson, companyName })
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(e.error || "Failed to generate Word.");
      return;
    }

    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition");
    const filename = getFilenameFromDisposition(disposition) || "resume.docx";

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } finally {
    wordBtn.disabled = false;
  }
});

pdfBtn.addEventListener("click", async () => {
  try {
    pdfBtn.disabled = true;
    const companyName = (companyEl.value || "").trim();

    const res = await api("/download-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeJson: state.resumeJson, companyName })
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(e.error || "Failed to generate PDF");
      return;
    }

    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition");
    const filename = getFilenameFromDisposition(disposition) || "resume.pdf";

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } finally {
    pdfBtn.disabled = false;
  }
});

// async function generate() {
//   clearError();
//   copyBtn.disabled = true;
//   wordBtn.disabled = true;
//   pdfBtn.disabled = true;

//   const jd = jdEl.value;
//   if (!jd.trim()) { setStatus("Please paste a job description."); return; }

//   setStatus("Generating…");
//   hint.textContent = "Working…";
//   generateBtn.disabled = true;

//   try {
//     const res = await api("/generate-resume-json", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ jobDescription: jd })
//     });

//     const data = await res.json().catch(() => ({}));

//     if (!res.ok) {
//       if (res.status === 401) window.location.href = "/login";
//       showError(data.error || "Something went wrong.");
//       hint.textContent = "Error";
//       return;
//     }

//     setState({ resumeJson: data.resumeJson, editing: false, snapshotHtml: "" });
//     renderResume(output, state.resumeJson, { editing: false });

//     hint.textContent = "Ready";
//     copyBtn.disabled = false;
//     wordBtn.disabled = false;
//     pdfBtn.disabled = false;
//   } catch (e) {
//     console.error(e);
//     showError("Network error. Is the server running?");
//     hint.textContent = "Error";
//   } finally {
//     generateBtn.disabled = false;
//   }
// }

async function generate() {
  clearError();
  copyBtn.disabled = true;
  wordBtn.disabled = true;
  pdfBtn.disabled = true;

  const input = (jdEl.value || "").trim();
  if (!input) {
    setStatus("Please paste a job description or job URL.");
    return;
  }

  setStatus("Generating…");
  hint.textContent = "Working…";
  generateBtn.disabled = true;

  try {
    // 1) Decide JD source
    let jobDescription = "";
    let companyName = (companyEl?.value || "").trim();
    

    if (isUrl(input)) {
      setStatus("Extracting job description from URL…");
      if(companyEl) {
        companyEl.value=""
      }
      const res1 = await api("/extract-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: input }),
      });

      // IMPORTANT: parse JSON exactly once
      const data1 = await res1.json().catch(() => ({}));

      if (!res1.ok) {
        if (res1.status === 401) window.location.href = "/login";
        showError(data1.error || "Failed to extract job description.");
        hint.textContent = "Error";
        return;
      }

      jobDescription = (data1.jobDescription || "").trim();
      if (!jobDescription) {
        showError("No job description found at this URL.");
        hint.textContent = "Error";
        return;
      }
        console.log(data1.companyName)
      // auto-fill company if backend found it
      if (!companyName && data1.companyName) {
        companyName = data1.companyName;
        if (companyEl) companyEl.value = companyName;
      }
      companyEl.value = data1.companyName;
    } else {
      jobDescription = input;
    }

    // 2) Generate resume JSON
    setStatus("Generating resume…");

    const res2 = await api("/generate-resume-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobDescription }),
    });

    // IMPORTANT: parse JSON exactly once
    const data2 = await res2.json().catch(() => ({}));

    if (!res2.ok) {
      if (res2.status === 401) window.location.href = "/login";
      showError(data2.error || "Something went wrong.");
      hint.textContent = "Error";
      return;
    }

    // ✅ sanity checks to avoid silent render crashes
    if (!data2 || !data2.resumeJson) {
      console.error("Missing resumeJson in response:", data2);
      showError("Server returned no resume JSON.");
      hint.textContent = "Error";
      return;
    }

    // 3) Render (use your old working render path)
    setState({ resumeJson: data2.resumeJson, editing: false, snapshotHtml: "" });
    renderResume(output, state.resumeJson, { editing: false });

    hint.textContent = "Ready";
    copyBtn.disabled = false;
    wordBtn.disabled = false;
    pdfBtn.disabled = false;
  } catch (e) {
    // This catch is for frontend exceptions (render/api wrapper/etc)
    console.error("Generate crashed:", e);
    showError("Network error. Please try again.");
    setStatus("Something is Wrong");
    hint.textContent = "Error";
  } finally {
    generateBtn.disabled = false;
  }
}


generateBtn.addEventListener("click", generate);
jdEl.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") generate();
});

loadMe();
