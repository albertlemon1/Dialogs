"use strict";

const VOICE_SETS_A = {
  "emma-george": "Emma (F) + George (M)",
  "isabella-lewis": "Isabella (F) + Lewis (M)",
};
const DEFAULT_MODEL = "eleven_turbo_v2_5";
const $ = (id) => document.getElementById(id);

/* ---------- settings (localStorage, per browser) ---------- */
const DEFAULTS = {
  ver: "a", set: "emma-george", speed: "1", showEs: true, showNotes: true,
  elKey: "", elModel: DEFAULT_MODEL, elVoiceR: "", elVoiceG: "",
  ghOn: false, ghRepo: "albertlemon1/dialogs", ghBranch: "main", ghToken: "",
};
let cfg = { ...DEFAULTS };
try { Object.assign(cfg, JSON.parse(localStorage.getItem("cfg") || "{}")); } catch (e) {}
const save = () => { try { localStorage.setItem("cfg", JSON.stringify(cfg)); } catch (e) {} };

/* ---------- IndexedDB: persistent audio cache for version B ---------- */
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open("hotel-dialogue", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("audio");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction("audio", mode);
    const req = fn(tx.objectStore("audio"));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}
const idbGet = (k) => idb("readonly", (s) => s.get(k)).catch(() => undefined);
const idbPut = (k, v) => idb("readwrite", (s) => s.put(v, k));

async function sha(text) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(b)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* ---------- data + rendering ---------- */
let D;
const nn = (id) => String(id).padStart(2, "0");

function setStatus(msg, err) { const s = $("status"); s.textContent = msg || ""; s.className = "status" + (err ? " err" : ""); }

function render() {
  const ol = $("lines");
  ol.innerHTML = "";
  for (const l of D.lines) {
    const li = document.createElement("li");
    li.className = "line " + l.s;
    li.id = "line-" + l.id;
    li.innerHTML = `
      <button class="play" aria-label="Play line ${l.id}">▶</button>
      <div>
        <div class="who">${D.speakers[l.s].name} · ${D.speakers[l.s].name_es}<span class="tag" id="tag-${l.id}"></span></div>
        <div class="en"></div><div class="es"></div><div class="note"></div>
        <div class="err" id="err-${l.id}"></div>
      </div>`;
    li.querySelector(".en").textContent = l.en;
    li.querySelector(".es").textContent = l.es;
    li.querySelector(".note").textContent = l.note ? "💡 " + l.note : "";
    li.querySelector(".play").onclick = () => playOne(l).catch(() => {});
    ol.appendChild(li);
  }
  refreshTags();
}

async function refreshTags() {
  if (cfg.ver !== "b") { D.lines.forEach((l) => ($("tag-" + l.id).textContent = "")); return; }
  for (const l of D.lines) {
    const k = bKey(l);
    const v = k && (await idbGet(k));
    $("tag-" + l.id).textContent = v ? "✓ saved" : "";
  }
}

function applyView() {
  document.body.classList.toggle("hide-es", !cfg.showEs);
  document.body.classList.toggle("hide-notes", !cfg.showNotes);
  document.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.ver === cfg.ver));
  $("voiceSetWrap").hidden = cfg.ver !== "a";
  $("settingsBtn").hidden = cfg.ver !== "b";
  $("showEs").checked = cfg.showEs;
  $("showNotes").checked = cfg.showNotes;
  $("speed").value = cfg.speed;
  $("voiceSet").value = cfg.set;
}

/* ---------- audio sources ---------- */
const bVoice = (l) => (l.s === "R" ? cfg.elVoiceR : cfg.elVoiceG);
const bKey = (l) => (cfg.elModel && bVoice(l) ? `${cfg.elModel}|${bVoice(l)}|${l.id}` : null);
const bPath = (l) => `audio/b/${cfg.elModel}/${bVoice(l)}/${nn(l.id)}.mp3`;

// Returns a Blob for version B (IndexedDB first, then the repo's audio/ folder) or null.
async function getB(l) {
  const k = bKey(l);
  if (!k) return null;
  const hash = await sha(l.en);
  const hit = await idbGet(k);
  if (hit && hit.hash === hash) return hit.blob;
  try {
    const r = await fetch(bPath(l), { cache: "no-cache" });
    if (r.ok && /audio|octet/.test(r.headers.get("content-type") || "")) {
      const blob = await r.blob();
      await idbPut(k, { blob, hash });
      return blob;
    }
  } catch (e) {}
  return null;
}

/* ---------- playback ---------- */
const audio = new Audio();
let stopFlag = false;

function mark(id) {
  document.querySelectorAll(".line.playing").forEach((e) => e.classList.remove("playing"));
  if (id) { const e = $("line-" + id); e.classList.add("playing"); e.scrollIntoView({ block: "center", behavior: "smooth" }); }
}

async function playOne(l) {
  audio.pause();
  $("err-" + l.id).textContent = "";
  let url, revoke = false;
  if (cfg.ver === "a") {
    url = `audio/a/${cfg.set}/${nn(l.id)}.mp3`;
  } else {
    if (!cfg.elModel || !bVoice(l)) { setStatus("No default voices found. Reload the page (Ctrl+Shift+R) or choose them in ElevenLabs settings.", true); throw new Error("missing"); }
    const blob = await getB(l);
    if (!blob) {
      $("err-" + l.id).textContent = "Audio not generated yet — open ElevenLabs settings → Generate.";
      throw new Error("missing");
    }
    url = URL.createObjectURL(blob); revoke = true;
  }
  mark(l.id);
  audio.src = url;
  audio.playbackRate = parseFloat(cfg.speed);
  try {
    await new Promise((res, rej) => {
      audio.onended = res;
      audio.onerror = () => rej(new Error("Audio file not found: " + url));
      audio.play().catch(rej);
    });
  } catch (e) {
    if (e.name !== "AbortError") $("err-" + l.id).textContent = e.message;
    throw e;
  } finally {
    if (revoke) URL.revokeObjectURL(url);
    mark(null);
  }
}

async function playAll() {
  if ($("playAll").dataset.run === "1") { stopFlag = true; audio.pause(); return; }
  stopFlag = false;
  $("playAll").dataset.run = "1"; $("playAll").textContent = "■ Stop";
  try {
    for (const l of D.lines) {
      if (stopFlag) break;
      await playOne(l);
      await new Promise((r) => setTimeout(r, 350));
    }
  } catch (e) { if (e.name !== "AbortError" && e.message !== "missing") setStatus(e.message, true); }
  $("playAll").dataset.run = "0"; $("playAll").textContent = "▶ Play all";
}

/* ---------- ElevenLabs ---------- */
const EL = "https://api.elevenlabs.io";
const elHeaders = () => ({ "xi-api-key": cfg.elKey });
const logEl = (m) => { const p = $("log"); p.textContent += m + "\n"; p.scrollTop = p.scrollHeight; };

function fillSelect(sel, items, current) {
  sel.innerHTML = "";
  for (const [v, t] of items) { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); }
  if (current && items.some(([v]) => v === current)) sel.value = current;
}

async function loadEl() {
  cfg.elKey = $("elKey").value.trim(); save();
  if (!cfg.elKey) return logEl("Enter your API key first.");
  logEl("Loading models and voices…");
  try {
    const [mr, vr] = await Promise.all([
      fetch(EL + "/v1/models", { headers: elHeaders() }),
      fetch(EL + "/v1/voices", { headers: elHeaders() }),
    ]);
    if (!mr.ok) throw new Error("Models: HTTP " + mr.status);
    if (!vr.ok) throw new Error("Voices: HTTP " + vr.status + " (the key may lack the voices_read permission)");
    const models = (await mr.json()).filter((m) => m.can_do_text_to_speech);
    const voices = (await vr.json()).voices;
    voices.sort((a, b) => (b.labels?.accent === "british") - (a.labels?.accent === "british") || a.name.localeCompare(b.name));
    fillSelect($("elModel"), models.map((m) => [m.model_id, `${m.name} (${m.model_id})`]), cfg.elModel || DEFAULT_MODEL);
    const vi = voices.map((v) => [v.voice_id, `${v.name}${v.labels?.accent ? " · " + v.labels.accent : ""}${v.labels?.gender ? " · " + v.labels.gender : ""}`]);
    const brit = voices.filter((v) => v.labels?.accent === "british");
    const pick = (g) => brit.find((v) => v.labels?.gender === g) || brit[0] || voices[0];
    fillSelect($("elVoiceR"), vi, cfg.elVoiceR || pick("female")?.voice_id);
    fillSelect($("elVoiceG"), vi, cfg.elVoiceG || pick("male")?.voice_id);
    syncElFromForm();
    logEl(`OK: ${models.length} models, ${voices.length} voices.`);
  } catch (e) { logEl("Error: " + e.message); }
}

function syncElFromForm() {
  cfg.elModel = $("elModel").value; cfg.elVoiceR = $("elVoiceR").value; cfg.elVoiceG = $("elVoiceG").value;
  cfg.ghOn = $("ghOn").checked; cfg.ghRepo = $("ghRepo").value.trim(); cfg.ghBranch = $("ghBranch").value.trim();
  cfg.ghToken = $("ghToken").value.trim(); cfg.elKey = $("elKey").value.trim();
  save();
}

const b64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(blob); });

async function commitToGitHub(path, blob, msg) {
  const api = `https://api.github.com/repos/${cfg.ghRepo}/contents/${path}`;
  const h = { Authorization: "Bearer " + cfg.ghToken, Accept: "application/vnd.github+json" };
  let sha;
  const g = await fetch(`${api}?ref=${encodeURIComponent(cfg.ghBranch)}`, { headers: h });
  if (g.ok) sha = (await g.json()).sha;
  else if (g.status !== 404) throw new Error("GitHub GET " + g.status);
  const r = await fetch(api, {
    method: "PUT", headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg, content: await b64(blob), branch: cfg.ghBranch, sha }),
  });
  if (!r.ok) throw new Error("GitHub PUT " + r.status + " " + (await r.text()).slice(0, 150));
}

async function generate() {
  syncElFromForm();
  if (!cfg.elKey || !cfg.elModel || !cfg.elVoiceR || !cfg.elVoiceG) return logEl("Load models & voices and choose them first.");
  if (cfg.ghOn && (!cfg.ghToken || !cfg.ghRepo || !cfg.ghBranch)) return logEl("GitHub saving is on but repo/branch/token is missing.");
  stopFlag = false;
  $("genBtn").disabled = true; $("stopBtn").disabled = false; $("prog").hidden = false;
  $("prog").max = D.lines.length; $("prog").value = 0;
  let done = 0, made = 0;
  try {
    for (const l of D.lines) {
      if (stopFlag) { logEl("Stopped."); break; }
      const hash = await sha(l.en);
      const existing = await getB(l);
      if (existing) {
        logEl(`#${l.id} already saved, skipped.`);
      } else {
        logEl(`#${l.id} generating…`);
        const r = await fetch(`${EL}/v1/text-to-speech/${bVoice(l)}?output_format=mp3_44100_128`, {
          method: "POST", headers: { ...elHeaders(), "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({ text: l.en, model_id: cfg.elModel }),
        });
        if (!r.ok) throw new Error(`ElevenLabs HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const blob = new Blob([await r.arrayBuffer()], { type: "audio/mpeg" });
        await idbPut(bKey(l), { blob, hash });
        made++;
        if (cfg.ghOn) {
          await commitToGitHub(bPath(l), blob, `Add ElevenLabs audio line ${nn(l.id)} (${cfg.elModel})`);
          logEl(`#${l.id} committed to ${cfg.ghBranch}.`);
        }
      }
      $("prog").value = ++done;
    }
    logEl(`Finished. ${made} new audio file(s).`);
  } catch (e) { logEl("Error: " + e.message + " — run again to resume."); }
  $("genBtn").disabled = false; $("stopBtn").disabled = true;
  refreshTags();
}

function openSettings() {
  $("elKey").value = cfg.elKey; $("ghOn").checked = cfg.ghOn; $("ghRepo").value = cfg.ghRepo;
  $("ghBranch").value = cfg.ghBranch; $("ghToken").value = cfg.ghToken;
  for (const [id, key] of [["elModel", "elModel"], ["elVoiceR", "elVoiceR"], ["elVoiceG", "elVoiceG"]]) {
    const s = $(id);
    if (cfg[key] && ![...s.options].some((o) => o.value === cfg[key])) fillSelect(s, [[cfg[key], cfg[key]]], cfg[key]);
  }
  $("settings").showModal();
}

/* ---------- init ---------- */
(async function init() {
  D = await (await fetch("data/dialogue.json", { cache: "no-cache" })).json();
  // Defaults for Version B shipped in the repo, so a fresh browser can play without a key.
  if (!cfg.elVoiceR || !cfg.elVoiceG) {
    try {
      const c = await (await fetch("audio/b/config.json", { cache: "no-cache" })).json();
      cfg.elModel = c.model; cfg.elVoiceR = c.voices.R; cfg.elVoiceG = c.voices.G;
    } catch (e) { setStatus("Could not load audio/b/config.json (" + e.message + "). Reload the page without cache.", true); }
  }
  $("title").textContent = D.title;
  $("subtitle").textContent = `${D.title_es} · Level ${D.level}`;
  fillSelect($("voiceSet"), Object.entries(VOICE_SETS_A), cfg.set);

  document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => { cfg.ver = b.dataset.ver; save(); applyView(); refreshTags(); }));
  $("voiceSet").onchange = (e) => { cfg.set = e.target.value; save(); };
  $("speed").onchange = (e) => { cfg.speed = e.target.value; save(); audio.playbackRate = parseFloat(cfg.speed); };
  $("showEs").onchange = (e) => { cfg.showEs = e.target.checked; save(); applyView(); };
  $("showNotes").onchange = (e) => { cfg.showNotes = e.target.checked; save(); applyView(); };
  $("playAll").onclick = playAll;
  $("settingsBtn").onclick = openSettings;
  $("closeBtn").onclick = () => { syncElFromForm(); $("settings").close(); refreshTags(); };
  $("loadEl").onclick = loadEl;
  $("genBtn").onclick = generate;
  $("stopBtn").onclick = () => { stopFlag = true; };
  ["elModel", "elVoiceR", "elVoiceG"].forEach((id) => ($(id).onchange = () => { syncElFromForm(); refreshTags(); }));

  applyView();
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
