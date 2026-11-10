"use strict";

const DEFAULT_MODEL = "eleven_turbo_v2_5";
const $ = (id) => document.getElementById(id);

/* ---------- settings (localStorage, per browser) ---------- */
const DEFAULTS = {
  ver: "a", speed: "1", showEs: true, showNotes: true, scenario: "",
  sets: {},   // Version A voice set per scenario
  b: {},      // Version B { model, voices: { speakerKey: voiceId } } per scenario
  elKey: "", ghOn: false, ghRepo: "albertlemon1/Dialogs", ghBranch: "main", ghToken: "",
};
let cfg = { ...DEFAULTS };
try { Object.assign(cfg, JSON.parse(localStorage.getItem("cfg") || "{}")); } catch (e) {}
// Drop keys from the single-scenario version of the app.
["set", "elModel", "elVoiceR", "elVoiceG"].forEach((k) => delete cfg[k]);
if (typeof cfg.sets !== "object") cfg.sets = {};
if (typeof cfg.b !== "object") cfg.b = {};
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

/* ---------- scenario state ---------- */
let INDEX;   // data/scenarios.json
let SC;      // current scenario entry from the index
let D;       // current dialogue
const nn = (id) => String(id).padStart(2, "0");
const B = () => (cfg.b[SC.id] ||= { model: "", voices: {} });

function setStatus(msg, err) { const s = $("status"); s.textContent = msg || ""; s.className = "status" + (err ? " err" : ""); }

async function loadScenario(id) {
  SC = INDEX.scenarios.find((s) => s.id === id) || INDEX.scenarios.find((s) => s.id === INDEX.default);
  cfg.scenario = SC.id; save();
  const url = new URL(location.href);
  url.searchParams.set("s", SC.id);
  history.replaceState(null, "", url);

  setStatus("");
  D = await (await fetch(`data/${SC.id}.json`, { cache: "no-cache" })).json();

  // Defaults for Version B shipped in the repo, so a fresh browser can play without a key.
  const b = B();
  const missing = !b.model || Object.keys(D.speakers).some((k) => !b.voices[k]);
  if (missing) {
    try {
      const r = await fetch(`audio/${SC.id}/b/config.json`, { cache: "no-cache" });
      if (r.ok) { const c = await r.json(); b.model = c.model; b.voices = { ...c.voices }; save(); }
    } catch (e) {}
  }

  if (!SC.voice_sets[cfg.sets[SC.id]]) cfg.sets[SC.id] = Object.keys(SC.voice_sets)[0];
  fillSelect($("voiceSet"), Object.entries(SC.voice_sets).map(([k, v]) => [k, v.label]), cfg.sets[SC.id]);

  $("title").textContent = D.title;
  $("subtitle").textContent = `${D.title_es} · Level ${D.level}`;
  document.title = D.title;
  applyView();
  render();
}

/* ---------- rendering ---------- */
function render() {
  const ol = $("lines");
  ol.innerHTML = "";
  for (const l of D.lines) {
    const scene = (D.scenes || []).find((s) => s.start === l.id);
    if (scene && D.scenes.length > 1) {
      const h = document.createElement("li");
      h.className = "scene";
      h.innerHTML = `<span class="en"></span><span class="es"></span>`;
      h.querySelector(".en").textContent = scene.title;
      h.querySelector(".es").textContent = scene.title_es;
      ol.appendChild(h);
    }
    const sp = D.speakers[l.s];
    const li = document.createElement("li");
    li.className = `line side-${sp.side || "left"} sp-${l.s}`;
    li.id = "line-" + l.id;
    li.innerHTML = `
      <button class="play" aria-label="Play line ${l.id}">▶</button>
      <div>
        <div class="who">${sp.name} · ${sp.name_es}<span class="tag" id="tag-${l.id}"></span></div>
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
  const scId = SC.id;
  for (const l of D.lines) {
    const k = cfg.ver === "b" ? bKey(l) : null;
    const v = k && (await idbGet(k));
    if (SC.id !== scId) return; // scenario changed meanwhile
    const t = $("tag-" + l.id);
    if (t) t.textContent = v ? "✓ saved" : "";
  }
}

function applyView() {
  document.body.classList.toggle("hide-es", !cfg.showEs);
  document.body.classList.toggle("hide-notes", !cfg.showNotes);
  document.querySelectorAll("#verSeg button").forEach((b) => b.classList.toggle("on", b.dataset.ver === cfg.ver));
  document.querySelectorAll("#scSeg button").forEach((b) => b.classList.toggle("on", b.dataset.sc === SC.id));
  $("voiceSetWrap").hidden = cfg.ver !== "a";
  $("settingsBtn").hidden = cfg.ver !== "b";
  $("showEs").checked = cfg.showEs;
  $("showNotes").checked = cfg.showNotes;
  $("speed").value = cfg.speed;
}

/* ---------- audio sources ---------- */
const bVoice = (l) => B().voices[l.s];
const bKey = (l) => (B().model && bVoice(l) ? `${SC.id}|${B().model}|${bVoice(l)}|${l.id}` : null);
const bPath = (l) => `audio/${SC.id}/b/${B().model}/${bVoice(l)}/${nn(l.id)}.mp3`;

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
let stopFlag = false;   // playback
let genStop = false;    // generation

function mark(id) {
  document.querySelectorAll(".line.playing").forEach((e) => e.classList.remove("playing"));
  if (id) { const e = $("line-" + id); e.classList.add("playing"); e.scrollIntoView({ block: "center", behavior: "smooth" }); }
}

// Ends the current clip and settles its pending promise, so "Play all" never hangs.
function cutCurrent() {
  const done = audio.onended;
  audio.onended = null;
  audio.pause();
  if (done) done();
}

async function playOne(l, fromAll = false) {
  if (!fromAll) stopFlag = true; // a manual click stops "Play all"
  cutCurrent();
  $("err-" + l.id).textContent = "";
  let url, revoke = false;
  if (cfg.ver === "a") {
    url = `audio/${SC.id}/a/${cfg.sets[SC.id]}/${nn(l.id)}.mp3`;
  } else {
    if (!B().model || !bVoice(l)) {
      $("err-" + l.id).textContent = "No ElevenLabs voices for this scenario yet — open ElevenLabs settings → Generate.";
      throw new Error("missing");
    }
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
    if (document.querySelector(".line.playing")?.id === "line-" + l.id) mark(null);
  }
}

function stopPlayback() { stopFlag = true; cutCurrent(); }

async function playAll() {
  if ($("playAll").dataset.run === "1") { stopPlayback(); return; }
  stopFlag = false;
  $("playAll").dataset.run = "1"; $("playAll").textContent = "■ Stop";
  try {
    for (const l of D.lines) {
      if (stopFlag) break;
      await playOne(l, true);
      await new Promise((r) => setTimeout(r, 350));
    }
  } catch (e) { if (e.name !== "AbortError" && e.message !== "missing") setStatus(e.message, true); }
  $("playAll").dataset.run = "0"; $("playAll").textContent = "▶ Play all";
}

/* ---------- ElevenLabs ---------- */
const EL = "https://api.elevenlabs.io";
const elHeaders = () => ({ "xi-api-key": cfg.elKey });
const logEl = (m) => { const p = $("log"); p.textContent += m + "\n"; p.scrollTop = p.scrollHeight; };
let voiceItems = null; // [[voice_id, label]] once loaded from the API

function fillSelect(sel, items, current) {
  sel.innerHTML = "";
  for (const [v, t] of items) { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); }
  if (current && items.some(([v]) => v === current)) sel.value = current;
}

// One voice selector per speaker of the current scenario.
function buildVoiceSelectors(defaults = {}) {
  const box = $("elVoices");
  box.innerHTML = "";
  for (const [k, sp] of Object.entries(D.speakers)) {
    const lab = document.createElement("label");
    lab.textContent = `${sp.name} voice`;
    const sel = document.createElement("select");
    sel.id = "elVoice-" + k;
    const cur = B().voices[k] || defaults[k];
    const items = voiceItems || (cur ? [[cur, cur]] : []);
    fillSelect(sel, items, cur);
    sel.onchange = () => { syncElFromForm(); refreshTags(); };
    lab.appendChild(sel);
    box.appendChild(lab);
  }
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
    fillSelect($("elModel"), models.map((m) => [m.model_id, `${m.name} (${m.model_id})`]), B().model || DEFAULT_MODEL);
    voiceItems = voices.map((v) => [v.voice_id, `${v.name}${v.labels?.accent ? " · " + v.labels.accent : ""}${v.labels?.gender ? " · " + v.labels.gender : ""}`]);
    // Suggest different British voices per speaker, alternating gender.
    const brit = voices.filter((v) => v.labels?.accent === "british");
    const pool = brit.length ? brit : voices;
    const defaults = {};
    Object.keys(D.speakers).forEach((k, i) => { defaults[k] = pool[i % pool.length]?.voice_id; });
    buildVoiceSelectors(defaults);
    syncElFromForm();
    logEl(`OK: ${models.length} models, ${voices.length} voices.`);
  } catch (e) { logEl("Error: " + e.message); }
}

function syncElFromForm() {
  const b = B();
  if ($("elModel").value) b.model = $("elModel").value;
  for (const k of Object.keys(D.speakers)) { const s = $("elVoice-" + k); if (s && s.value) b.voices[k] = s.value; }
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
  const b = B();
  const speakers = Object.keys(D.speakers);
  if (!cfg.elKey || !b.model || speakers.some((k) => !b.voices[k])) return logEl("Load models & voices and choose one voice per speaker first.");
  if (cfg.ghOn && (!cfg.ghToken || !cfg.ghRepo || !cfg.ghBranch)) return logEl("GitHub saving is on but repo/branch/token is missing.");
  genStop = false;
  $("genBtn").disabled = true; $("stopBtn").disabled = false; $("prog").hidden = false;
  $("prog").max = D.lines.length; $("prog").value = 0;
  let done = 0, made = 0;
  try {
    if (cfg.ghOn) {
      // Save the chosen model/voices first, so other browsers know which files to play.
      const conf = JSON.stringify({ model: b.model, voices: Object.fromEntries(speakers.map((k) => [k, b.voices[k]])) }, null, 2) + "\n";
      await commitToGitHub(`audio/${SC.id}/b/config.json`, new Blob([conf]), `Set ElevenLabs voices for ${SC.id} (${b.model})`);
      logEl(`config.json for ${SC.id} committed.`);
    }
    for (const l of D.lines) {
      if (genStop) { logEl("Stopped."); break; }
      const hash = await sha(l.en);
      const existing = await getB(l);
      if (existing) {
        logEl(`#${l.id} already saved, skipped.`);
      } else {
        logEl(`#${l.id} generating…`);
        const r = await fetch(`${EL}/v1/text-to-speech/${bVoice(l)}?output_format=mp3_44100_128`, {
          method: "POST", headers: { ...elHeaders(), "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({ text: l.en, model_id: b.model }),
        });
        if (!r.ok) throw new Error(`ElevenLabs HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const blob = new Blob([await r.arrayBuffer()], { type: "audio/mpeg" });
        await idbPut(bKey(l), { blob, hash });
        made++;
        if (cfg.ghOn) {
          await commitToGitHub(bPath(l), blob, `Add ElevenLabs audio ${SC.id} line ${nn(l.id)} (${b.model})`);
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
  $("dlgScenario").textContent = `Scenario: ${SC.label} (${SC.label_es})`;
  $("elKey").value = cfg.elKey; $("ghOn").checked = cfg.ghOn; $("ghRepo").value = cfg.ghRepo;
  $("ghBranch").value = cfg.ghBranch; $("ghToken").value = cfg.ghToken;
  const m = B().model;
  const s = $("elModel");
  if (m && ![...s.options].some((o) => o.value === m)) fillSelect(s, [[m, m]], m);
  else if (m) s.value = m;
  buildVoiceSelectors();
  $("settings").showModal();
}

/* ---------- init ---------- */
(async function init() {
  INDEX = await (await fetch("data/scenarios.json", { cache: "no-cache" })).json();

  const seg = $("scSeg");
  for (const s of INDEX.scenarios) {
    const b = document.createElement("button");
    b.dataset.sc = s.id;
    b.textContent = `${s.label} · ${s.label_es}`;
    b.onclick = () => { if (s.id !== SC.id) { stopPlayback(); loadScenario(s.id); } };
    seg.appendChild(b);
  }

  document.querySelectorAll("#verSeg button").forEach((b) => (b.onclick = () => { cfg.ver = b.dataset.ver; save(); applyView(); refreshTags(); }));
  $("voiceSet").onchange = (e) => { cfg.sets[SC.id] = e.target.value; save(); };
  $("speed").onchange = (e) => { cfg.speed = e.target.value; save(); audio.playbackRate = parseFloat(cfg.speed); };
  $("showEs").onchange = (e) => { cfg.showEs = e.target.checked; save(); applyView(); };
  $("showNotes").onchange = (e) => { cfg.showNotes = e.target.checked; save(); applyView(); };
  $("playAll").onclick = playAll;
  $("settingsBtn").onclick = openSettings;
  $("closeBtn").onclick = () => { syncElFromForm(); $("settings").close(); refreshTags(); };
  $("loadEl").onclick = loadEl;
  $("genBtn").onclick = generate;
  $("stopBtn").onclick = () => { genStop = true; };
  $("elModel").onchange = () => { syncElFromForm(); refreshTags(); };

  const wanted = new URLSearchParams(location.search).get("s") || cfg.scenario || INDEX.default;
  await loadScenario(wanted);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
