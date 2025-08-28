import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

/**
 * Tournament Maker — Cloud (GitHub via Cloudflare Worker) + 4 Seeds + Printable Bracket + Safe Delete
 * Tabs: SCHEDULE (admin), FIXTURES, STANDINGS, WINNERS, DELETED (admin-only)
 *
 * Cloud save/load is proxied through a Worker (see worker code below).
 * Set CLOUD_STORE_URL and CLOUD_APP_KEY before building.
 */

// ----------------------------- Theme -----------------------------
const TM_BLUE = "#0f4aa1"; // Tata Motors blue

// ----------------------------- Constants & Helpers -----------------------------
const STORAGE_KEY = "tourney_multi_dark_v2_cloud"; // local fallback
const NEW_TOURNEY_SENTINEL = "__NEW__";
const uid = () => Math.random().toString(36).slice(2, 9);

// ⚠️ Admin credentials (change before sharing)
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "gameport123";

// ⚠️ Cloud storage (GitHub via Cloudflare Worker proxy)
const CLOUD_STORE_URL = "https://YOUR_WORKER_SUBDOMAIN.workers.dev"; // e.g., https://gp-store.yourname.workers.dev
const CLOUD_APP_KEY = "PASTE_A_SHARED_APP_KEY"; // same as Worker ENV APP_KEY

function normalizeHeader(h) { return String(h || "").trim().toLowerCase(); }
function uniqueNames(arr) {
  const seen = new Set(); const out = [];
  for (const n of arr.map(s => String(s || "").trim()).filter(Boolean)) {
    const k = n.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(n); }
  }
  return out;
}

// CSV: supports comma / tab / semicolon
function parseCSVPlayers(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const sep = /,|\t|;/;
  const headers = lines[0].split(sep).map(s => s.trim());
  const idx = headers.findIndex(h => normalizeHeader(h) === "players");
  if (idx === -1) return [];
  const names = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep);
    names.push((cols[idx] || "").trim());
  }
  return uniqueNames(names);
}

async function parseExcelPlayers(arrayBuffer) {
  try {
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows || rows.length === 0) return [];
    const keys = Object.keys(rows[0] || {});
    const key = keys.find(k => normalizeHeader(k) === "players");
    if (!key) return [];
    const names = rows.map(r => r[key]).filter(Boolean);
    return uniqueNames(names);
  } catch {
    return [];
  }
}

function stageLabelByCount(count) {
  if (count === 1) return "Finals";
  if (count === 2) return "Semi Finals";
  if (count === 4) return "Quarter Finals";
  if (count === 8) return "Pre quarters";
  return null;
}

// ----------------------------- Cloud I/O (Worker proxy) -----------------------------
async function cloudLoad() {
  if (!CLOUD_STORE_URL || CLOUD_STORE_URL.includes("YOUR_WORKER_SUBDOMAIN")) return null;
  try {
    const res = await fetch(`${CLOUD_STORE_URL}/load`, { headers: { "X-App-Key": CLOUD_APP_KEY } });
    if (!res.ok) throw new Error("load failed");
    const json = await res.json();
    if (json && json.ok) return json.data;
    return null;
  } catch {
    return null;
  }
}

async function cloudSave({ tournaments, deleted }) {
  if (!CLOUD_STORE_URL || CLOUD_STORE_URL.includes("YOUR_WORKER_SUBDOMAIN")) return false;
  try {
    const res = await fetch(`${CLOUD_STORE_URL}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-App-Key": CLOUD_APP_KEY },
      body: JSON.stringify({ tournaments, deleted }),
    });
    const json = await res.json();
    return !!(json && json.ok);
  } catch {
    return false;
  }
}

// ----------------------------- UI Subcomponents -----------------------------
function TabButton({ id, label, tab, setTab }) {
  const active = tab === id;
  const baseStyle = { borderColor: TM_BLUE, backgroundColor: active ? TM_BLUE : "transparent", color: "white" };
  return (
    <button onClick={() => setTab(id)} className="px-3 py-2 rounded-xl border transition hover:opacity-90" style={baseStyle}>
      {label}
    </button>
  );
}

function Collapsible({ title, subtitle, right, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-700 rounded-2xl mb-3 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 glass-header" style={{ borderColor: TM_BLUE }}>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(o => !o)} className="w-6 h-6 border border-white rounded text-xs hover:bg-white hover:text-black">
            {open ? "−" : "+"}
          </button>
          <div>
            <div className="font-semibold">{title}</div>
            {subtitle && <div className="text-xs text-zinc-400">{subtitle}</div>}
          </div>
        </div>
        {right}
      </div>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
}

function MatchRow({ idx, m, teamMap, onPickWinner, stageText, canEdit }) {
  const aName = teamMap[m.aId] || (m.aId ? "Unknown" : "BYE/TBD");
  const bName = teamMap[m.bId] || (m.bId ? "Unknown" : "BYE/TBD");
  const bothEmpty = !m.aId && !m.bId;
  const singleBye = (!!m.aId && !m.bId) || (!m.aId && !!m.bId);

  return (
    <div className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <span className="w-40 text-zinc-400">{stageText}{stageText === "Finals" ? "" : ` • M${idx}`}</span>
      <span className="flex-1">{aName}</span>
      {!bothEmpty && !singleBye && <span>vs</span>}
      <span className="flex-1">{bName}</span>

      {!canEdit ? (
        <span className="text-xs">
          {bothEmpty ? (
            <span className="text-white/60">(empty pairing)</span>
          ) : singleBye ? (
            <span className="text-white/70">Auto-advance available</span>
          ) : m.winnerId ? (
            <>Winner: <b>{teamMap[m.winnerId] || "TBD"}</b></>
          ) : (
            <span className="text-white/60">Winner: TBD</span>
          )}
        </span>
      ) : (
        bothEmpty ? (
          <span className="text-xs text-white/60">(empty pairing)</span>
        ) : singleBye ? (
          <button
            className={`px-2 py-1 rounded border ${m.winnerId ? "border-emerald-400 text-emerald-300" : "border-white hover:bg-white hover:text-black"}`}
            onClick={() => { const winnerId = m.aId || m.bId || null; if (winnerId) onPickWinner(m.id, winnerId); }}
          >{m.winnerId ? "Advanced" : "Auto-advance"}</button>
        ) : (
          <select
            className="field border rounded p-1 focus:border-white outline-none" style={{ borderColor: TM_BLUE }}
            value={m.winnerId || ""}
            onChange={e => onPickWinner(m.id, e.target.value || null)}
          >
            <option value="">Winner — pick</option>
            {m.aId && <option value={m.aId}>{aName}</option>}
            {m.bId && <option value={m.bId}>{bName}</option>}
          </select>
        )
      )}
    </div>
  );
}

// ----------------------------- Bracket (Printable) -----------------------------
function Bracket({ tournament }) {
  const rounds = useMemo(() => {
    const mp = new Map();
    for (const m of tournament.matches) { if (!mp.has(m.round)) mp.set(m.round, []); mp.get(m.round).push(m); }
    return Array.from(mp.entries()).sort((a, b) => a[0] - b[0]);
  }, [tournament.matches]);

  const teamMap = Object.fromEntries(tournament.teams.map(t => [t.id, t.name]));

  return (
    <div className="bracket">
      {rounds.map(([round, arr]) => (
        <div key={round} className="bracket-col">
          <div className="bracket-col-title">{stageLabelByCount(arr.length) || `Round ${round}`}</div>
          {arr.map((m) => (
            <div key={m.id} className="bracket-card">
              <div className="line team">{teamMap[m.aId] || "BYE/TBD"}</div>
              <div className="line team">{teamMap[m.bId] || "BYE/TBD"}</div>
              {m.winnerId && <div className="winner">Winner: {teamMap[m.winnerId]}</div>}
            </div>
          ))}
        </div>
      ))}
      <style>{`
        .bracket{ display:grid; grid-auto-flow:column; gap:16px; align-items:start; }
        .bracket-col{ min-width:220px; }
        .bracket-col-title{ font-weight:600; margin-bottom:8px; }
        .bracket-card{ border:1px solid rgba(255,255,255,0.15); border-radius:14px; padding:10px; margin-bottom:14px; }
        .line.team{ padding:4px 6px; }
        .winner{ margin-top:6px; font-size:12px; opacity:.85; }
        @media print{
          body{ background:#fff !important; color:#000 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          .no-print{ display:none !important; }
          .bracket-card{ border-color:#000; }
        }
      `}</style>
    </div>
  );
}

// ----------------------------- Main -----------------------------
export default function TournamentMaker() {
  const [tab, setTab] = useState("fixtures");

  // Admin auth
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem("gp_is_admin") === "1");
  const [showLogin, setShowLogin] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");

  // Builder state
  const [tName, setTName] = useState("");
  const [targetTournamentId, setTargetTournamentId] = useState(NEW_TOURNEY_SENTINEL);
  const [namesText, setNamesText] = useState("");
  const [builderTeams, setBuilderTeams] = useState([]); // [{id,name}]
  const [seed1, setSeed1] = useState("");
  const [seed2, setSeed2] = useState("");
  const [seed3, setSeed3] = useState("");
  const [seed4, setSeed4] = useState("");

  const uploadRef = useRef(null);

  // Data
  const [tournaments, setTournaments] = useState(() => []);
  const [deletedTournaments, setDeletedTournaments] = useState(() => []);

  // Initial load: prefer cloud, fallback to local
  useEffect(() => {
    (async () => {
      const cloud = await cloudLoad();
      if (cloud && (Array.isArray(cloud.tournaments) || Array.isArray(cloud.deleted))) {
        setTournaments(cloud.tournaments || []);
        setDeletedTournaments(cloud.deleted || []);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournaments: cloud.tournaments || [], deleted: cloud.deleted || [] }));
        return;
      }
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const data = JSON.parse(stored);
          if (data && Array.isArray(data.tournaments)) setTournaments(data.tournaments);
          if (data && Array.isArray(data.deleted)) setDeletedTournaments(data.deleted);
        } catch {}
      }
    })();
  }, []);

  const persistAll = async () => {
    const payload = { tournaments, deleted: deletedTournaments };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    const ok = await cloudSave(payload);
    alert(ok ? "Saved to cloud (GitHub)." : "Saved locally (cloud unavailable).");
  };

  // ------- Auth -------
  function handleLogin(e) {
    e?.preventDefault?.();
    if (loginId === ADMIN_USERNAME && loginPw === ADMIN_PASSWORD) {
      setIsAdmin(true);
      localStorage.setItem("gp_is_admin", "1");
      setShowLogin(false);
      setLoginId(""); setLoginPw("");
    } else {
      alert("Invalid credentials");
    }
  }
  function handleLogout() {
    setIsAdmin(false);
    localStorage.removeItem("gp_is_admin");
    if (tab === "schedule" || tab === "deleted") setTab("fixtures");
  }

  // ------- Builder helpers -------
  const builderTeamMap = useMemo(() => Object.fromEntries(builderTeams.map(tm => [tm.name, tm.id])), [builderTeams]);

  function loadTeamsFromText() {
    if (!isAdmin) { alert("Admin only."); return; }
    const lines = namesText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const uniq = Array.from(new Set(lines));
    const teams = uniq.map(n => ({ id: uid(), name: n }));
    setBuilderTeams(teams);
    if (targetTournamentId === NEW_TOURNEY_SENTINEL) {
      setSeed1(uniq[0] || ""); setSeed2(uniq[1] || ""); setSeed3(uniq[2] || ""); setSeed4(uniq[3] || "");
    }
  }

  async function handlePlayersUpload(file) {
    if (!isAdmin) { alert("Admin only."); return; }
    if (!file) return;
    const ext = (file.name.split('.').pop() || "").toLowerCase();
    let names = [];
    if (ext === 'csv') {
      const text = await file.text(); names = parseCSVPlayers(text);
    } else if (ext === 'xlsx' || ext === 'xls') {
      const buf = await file.arrayBuffer(); names = await parseExcelPlayers(buf);
    } else {
      alert("Unsupported file type. Please upload .csv, .xlsx, or .xls"); return;
    }
    if (names.length === 0) { alert("Could not find a 'Players' column in the file."); return; }
    const teams = names.map(n => ({ id: uid(), name: n }));
    setBuilderTeams(teams);
    if (targetTournamentId === NEW_TOURNEY_SENTINEL) {
      setSeed1(names[0] || ""); setSeed2(names[1] || ""); setSeed3(names[2] || ""); setSeed4(names[3] || "");
    }
  }

  // ---- Seeding (up to 4 seeds; require >=2) & Round-1 generation ----
  function placeSeeds(size, seedNames) {
    // #1 top (0), #2 bottom (size-1), #3 end of upper half (size/2 - 1), #4 start of lower half (size/2)
    const slots = Array(size).fill(null);
    if (seedNames[0]) slots[0] = seedNames[0];
    if (seedNames[1]) slots[size - 1] = seedNames[1];
    if (seedNames[2] && size >= 4) slots[Math.floor(size / 2) - 1] = seedNames[2];
    if (seedNames[3] && size >= 4) slots[Math.floor(size / 2)] = seedNames[3];
    return slots;
  }

  function generateRound1Matches(teams, seedNames) {
    const names = teams.map(x => x.name);
    let size = 1; while (size < names.length) size *= 2;

    let slots = placeSeeds(size, seedNames);
    const seededSet = new Set(seedNames.filter(Boolean).map(s => s.toLowerCase()));
    const others = names.filter(n => !seededSet.has(n.toLowerCase()));

    // shuffle others
    const shuffled = (() => { const a = others.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; })();

    // fill remaining alternating top/bottom, then inward
    const half = size / 2, topAvail = [], botAvail = [];
    for (let i = 0; i < half; i++) topAvail.push(i);
    for (let i = half; i < size; i++) botAvail.push(i);
    const occupied = new Set(slots.map((v, i) => (v ? i : null)).filter(x => x !== null));
    const topFree = topAvail.filter(i => !occupied.has(i));
    const botFree = botAvail.filter(i => !occupied.has(i));
    const order = []; const L = Math.max(topFree.length, botFree.length);
    for (let i = 0; i < L; i++) { if (i < topFree.length) order.push(topFree[i]); if (i < botFree.length) order.push(botFree[i]); }
    let oi = 0; for (const name of shuffled) { while (oi < order.length && slots[order[oi]] !== null) oi++; if (oi >= order.length) break; slots[order[oi]] = name; oi++; }

    const nameToId = Object.fromEntries(teams.map(tm => [tm.name, tm.id]));
    const matches = [];
    for (let i = 0; i < size; i += 2) {
      const aId = slots[i] ? nameToId[slots[i]] : null;
      const bId = slots[i + 1] ? nameToId[slots[i + 1]] : null;
      if (!aId && !bId) continue;
      const bye = !aId || !bId;
      const winnerId = bye ? (aId || bId || null) : null;
      matches.push({ id: uid(), round: 1, aId, bId, status: bye ? "BYE" : "Scheduled", winnerId });
    }
    return matches;
  }

  function createTournament() {
    if (!isAdmin) { alert("Admin only."); return; }

    if (targetTournamentId !== NEW_TOURNEY_SENTINEL) {
      const names = builderTeams.length ? builderTeams.map(b => b.name) : namesText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      applyEntriesToTournament(targetTournamentId, names);
      return;
    }
    if (!tName.trim()) { alert("Please enter a Tournament Name."); return; }
    if (builderTeams.length < 2) { alert("Please add at least 2 entries."); return; }

    const chosenSeeds = [seed1, seed2, seed3, seed4].map(s => s && s.trim()).filter(Boolean);
    const uniqSeeds = uniqueNames(chosenSeeds);
    if (uniqSeeds.length < 2) { alert("Pick at least 2 different seeds."); return; }
    if (uniqSeeds.some(s => !builderTeamMap[s])) { alert("Seeds must be from the added entries."); return; }

    const matches = generateRound1Matches(builderTeams, uniqSeeds.slice(0, 4));
    const idsByName = Object.fromEntries(builderTeams.map(tm => [tm.name, tm.id]));
    const seedTopId = idsByName[uniqSeeds[0]] || null; // #1
    const seedBottomId = idsByName[uniqSeeds[1]] || null; // #2

    const tourney = {
      id: uid(),
      name: tName.trim(),
      createdAt: Date.now(),
      teams: builderTeams,
      matches,
      status: "active",
      seedTopId,
      seedBottomId,
      extraSeeds: uniqSeeds.slice(2).map(name => idsByName[name]), // #3, #4 ids
      championId: null,
    };
    setTournaments(prev => [tourney, ...prev]);
    setTName(""); setNamesText(""); setSeed1(""); setSeed2(""); setSeed3(""); setSeed4(""); setBuilderTeams([]);
    setTargetTournamentId(NEW_TOURNEY_SENTINEL);
    setTab("fixtures");
  }

  // ------- Per-tournament derived helpers -------
  function roundCounts(tn) { const mp = new Map(); for (const m of tn.matches) { if (!(m.aId || m.bId)) continue; mp.set(m.round, (mp.get(m.round) || 0) + 1); } return mp; }
  function maxRound(tn) { return tn.matches.length ? Math.max(...tn.matches.map(m => m.round)) : 0; }
  function currentRoundMatches(tn) { const mr = maxRound(tn); return tn.matches.filter(m => m.round === mr); }
  function canGenerateNext(tn) {
    const cur = currentRoundMatches(tn);
    if (!cur.length) return false;
    const valid = cur.filter(m => m.aId || m.bId);
    return valid.length > 0 && valid.every(m => !!m.winnerId);
  }

  function pickWinner(tournamentId, matchId, winnerId) {
    if (!isAdmin) { alert("Admin only."); return; }
    setTournaments(prev => prev.map(tn => {
      if (tn.id !== tournamentId) return tn;
      const matches = tn.matches.map(m => m.id === matchId ? { ...m, winnerId, status: winnerId ? "Final" : m.status } : m);
      return { ...tn, matches };
    }));
  }

  function generateNextRound(tournamentId) {
    if (!isAdmin) { alert("Admin only."); return; }
    setTournaments(prev => prev.map(tn => {
      if (tn.id !== tournamentId) return tn;
      if (!canGenerateNext(tn)) return tn;
      const cur = currentRoundMatches(tn).filter(m => m.aId || m.bId);
      const winners = cur.map(m => m.winnerId).filter(Boolean);
      if (winners.length <= 1) {
        return { ...tn, status: "completed", championId: winners[0] || null };
      }
      const nextRoundNo = maxRound(tn) + 1;
      const next = [];
      for (let i = 0; i < winners.length; i += 2) {
        const aId = winners[i] || null; const bId = winners[i + 1] || null;
        if (!aId && !bId) continue;
        const bye = !aId || !bId; const winnerId = bye ? (aId || bId || null) : null;
        next.push({ id: uid(), round: nextRoundNo, aId, bId, status: bye ? "BYE" : "Scheduled", winnerId });
      }
      return { ...tn, matches: [...tn.matches, ...next] };
    }));
  }

  // Add new entries to an existing tournament: fill BYEs in Round 1 first, then create new Round 1 matches
  function applyEntriesToTournament(tournamentId, newNames) {
    if (!isAdmin) { alert("Admin only."); return; }
    setTournaments(prev => prev.map(tn => {
      if (tn.id !== tournamentId) return tn;

      const maxR = maxRound(tn);
      if (maxR > 1) { alert("Cannot add entries after the tournament has advanced beyond Round 1."); return tn; }

      const existingNamesSet = new Set(tn.teams.map(t => t.name.toLowerCase()));
      const toAddNames = uniqueNames(newNames).filter(n => !existingNamesSet.has(n.toLowerCase()));
      if (toAddNames.length === 0) return tn;

      const newTeams = toAddNames.map(n => ({ id: uid(), name: n }));
      const allTeams = [...tn.teams, ...newTeams];
      const idByName = Object.fromEntries(allTeams.map(t => [t.name, t.id]));

      let matches = tn.matches.map(m => ({ ...m }));

      // 1) Fill BYE/TBD slots in Round 1
      const r1_before = matches.filter(m => m.round === 1);
      const byeSlots = [];
      for (const m of r1_before) {
        if (!m.aId) byeSlots.push({ mid: m.id, side: "a" });
        if (!m.bId) byeSlots.push({ mid: m.id, side: "b" });
      }
      const nameQueue = [...toAddNames];
      for (const slot of byeSlots) {
        if (nameQueue.length === 0) break;
        const name = nameQueue.shift();
        const id = idByName[name];
        const mi = matches.findIndex(x => x.id === slot.mid);
        if (mi >= 0) {
          if (slot.side === "a") matches[mi].aId = id; else matches[mi].bId = id;
          if (matches[mi].aId && matches[mi].bId) { matches[mi].status = "Scheduled"; matches[mi].winnerId = null; }
        }
      }

      // 2) Remaining → new Round 1 matches
      const newR1Matches = [];
      while (nameQueue.length > 0) {
        const aName = nameQueue.shift();
        const bName = nameQueue.shift() || null;
        const aId = idByName[aName];
        const bId = bName ? idByName[bName] : null;
        const bye = !aId || !bId;
        const winnerId = bye ? (aId || bId || null) : null;
        newR1Matches.push({ id: uid(), round: 1, aId, bId, status: bye ? "BYE" : "Scheduled", winnerId });
      }

      const nonR1 = matches.filter(m => m.round !== 1);
      const existingR1 = matches.filter(m => m.round === 1);

      // Keep legacy top/bottom seed positions (if available)
      const seedTopId = tn.seedTopId || null; const seedBottomId = tn.seedBottomId || null;
      if (seedTopId && seedBottomId) {
        const r1Matches = existingR1;
        const topIdx = r1Matches.findIndex(m => m.aId === seedTopId || m.bId === seedTopId);
        const bottomIdx = r1Matches.findIndex(m => m.aId === seedBottomId || m.bId === seedBottomId);
        if (topIdx !== -1 && bottomIdx !== -1) {
          const topMatch = r1Matches[topIdx];
          const bottomMatch = r1Matches[bottomIdx];
          const between = r1Matches.filter((_, i) => i !== topIdx && i !== bottomIdx);
          let frontInserts = 0, backInserts = 0;
          newR1Matches.forEach((nm, idx) => {
            if (idx % 2 === 0) between.splice(frontInserts++, 0, nm);
            else between.splice(between.length - backInserts++, 0, nm);
          });
          const newR1 = [topMatch, ...between, bottomMatch];
          matches = [...newR1, ...nonR1];
        } else {
          matches = [...existingR1, ...newR1Matches, ...nonR1];
        }
      } else {
        matches = [...existingR1, ...newR1Matches, ...nonR1];
      }

      return { ...tn, teams: allTeams, matches };
    }));
  }

  // Partition
  const activeTournaments = tournaments.filter(tn => tn.status === "active");
  const completedTournaments = tournaments.filter(tn => tn.status === "completed");

  // Safe Delete modal
  const [deleteModal, setDeleteModal] = useState({ open: false, tournamentId: null, name: "", pw: "" });
  const openDelete = (tn) => setDeleteModal({ open: true, tournamentId: tn.id, name: tn.name, pw: "" });
  const closeDelete = () => setDeleteModal({ open: false, tournamentId: null, name: "", pw: "" });
  const confirmDelete = async () => {
    if (deleteModal.pw !== ADMIN_PASSWORD) { alert("Wrong password."); return; }
    const tn = tournaments.find(t => t.id === deleteModal.tournamentId);
    if (!tn) { closeDelete(); return; }
    const delEntry = { ...tn, deletedAt: Date.now() };
    const newDeleted = [delEntry, ...deletedTournaments];
    const newActive = tournaments.filter(t => t.id !== tn.id);
    setDeletedTournaments(newDeleted);
    setTournaments(newActive);
    closeDelete();
    await cloudSave({ tournaments: newActive, deleted: newDeleted });
  };

  // ----------------------------- Render -----------------------------
  const gpStyles = `
    .glass { background: rgba(255,255,255,0.04); backdrop-filter: blur(10px); }
    .glass-header { background: rgba(255,255,255,0.06); backdrop-filter: blur(6px); }
    .field { background: rgba(255,255,255,0.05); color: #fff; }
  `;

  return (
    <div className="p-4 text-white min-h-screen pageBg" style={{ position: "relative", zIndex: 1, background: "#0a1020" }}>
      <style>{gpStyles}</style>

      {/* HERO HEADER */}
      <section className="relative rounded-2xl overflow-hidden border mb-4 min-h-[20vh] flex items-center" style={{ borderColor: TM_BLUE }}>
        <div className="relative p-6 md:p-8 w-full">
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-widest text-center select-none">
            <span style={{ color: "#ffffff" }}>GAME</span>
            <span className="ml-2" style={{ color: "#ffffff" }}>PORT</span>
          </h1>
        </div>
      </section>

      {/* Tabs / Actions */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {isAdmin && <TabButton id="schedule" label="SCHEDULE" tab={tab} setTab={setTab} />}
          <TabButton id="fixtures" label="FIXTURES" tab={tab} setTab={setTab} />
          <TabButton id="standings" label="STANDINGS" tab={tab} setTab={setTab} />
          <TabButton id="winners" label="WINNERS" tab={tab} setTab={setTab} />
          {isAdmin && <TabButton id="deleted" label="DELETED" tab={tab} setTab={setTab} />}
        </div>
        <div className="flex gap-2 items-center">
          {tab === "fixtures" && isAdmin && (
            <button className="px-3 py-2 border rounded hover:opacity-90" style={{ borderColor: TM_BLUE }} onClick={persistAll}>Save</button>
          )}
          {!isAdmin ? (
            <button className="px-3 py-2 border rounded hover:bg-white hover:text-black" style={{ borderColor: TM_BLUE }} onClick={() => setShowLogin(true)}>Admin Login</button>
          ) : (
            <button className="px-3 py-2 border rounded border-red-400 text-red-300 hover:bg-red-400 hover:text-black" onClick={handleLogout}>Logout</button>
          )}
        </div>
      </div>

      {/* Admin Login Modal */}
      {showLogin && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="w-[90vw] max-w-sm border rounded-2xl p-4 glass" style={{ borderColor: TM_BLUE }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Admin Login</h3>
              <button className="w-6 h-6 border border-white rounded text-xs hover:bg-white hover:text-black" onClick={() => setShowLogin(false)}>×</button>
            </div>
            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <label className="text-xs">Admin ID</label>
                <input className="w-full field border rounded-xl p-2 focus:border-white outline-none" style={{ borderColor: TM_BLUE }} value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="enter admin id" />
              </div>
              <div>
                <label className="text-xs">Password</label>
                <input type="password" className="w-full field border rounded-xl p-2 focus:border-white outline-none" style={{ borderColor: TM_BLUE }} value={loginPw} onChange={e => setLoginPw(e.target.value)} placeholder="password" />
              </div>
              <button type="submit" className="w-full px-4 py-2 border border-emerald-400 text-emerald-300 rounded hover:bg-emerald-400 hover:text-black">Login</button>
              <p className="text-xs text-white/60">(Change admin ID & password in code before publishing.)</p>
            </form>
          </div>
        </div>
      )}

      {/* Safe Delete Modal */}
      {deleteModal.open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="w-[90vw] max-w-sm border rounded-2xl p-4 glass" style={{ borderColor: TM_BLUE }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Delete “{deleteModal.name}”</h3>
              <button className="w-6 h-6 border border-white rounded text-xs hover:bg-white hover:text-black" onClick={closeDelete}>×</button>
            </div>
            <p className="text-sm mb-3">Re-enter admin password to confirm deletion. The tournament will move to <b>DELETED</b> (admin-only).</p>
            <input type="password" className="w-full field border rounded-xl p-2 focus:border-white outline-none mb-3" style={{ borderColor: TM_BLUE }} value={deleteModal.pw} onChange={e => setDeleteModal(d => ({ ...d, pw: e.target.value }))} placeholder="admin password" />
            <div className="flex justify-end gap-2">
              <button className="px-3 py-2 border rounded" onClick={closeDelete}>Cancel</button>
              <button className="px-3 py-2 border rounded border-red-400 text-red-300 hover:bg-red-400 hover:text-black" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* SCHEDULE (Admin-only) */}
      {tab === "schedule" && (isAdmin ? (
        <section className="grid md:grid-cols-2 gap-4">
          <div className="border rounded-2xl p-4 glass" style={{ borderColor: TM_BLUE }}>
            <h2 className="font-semibold mb-3">Tournament Setup</h2>
            <label className="text-xs block mb-3">Tournament
              <select
                className="w-full field border rounded-xl p-2 focus:border-white outline-none" style={{ borderColor: TM_BLUE }}
                value={targetTournamentId} onChange={e => setTargetTournamentId(e.target.value)}
              >
                <option value={NEW_TOURNEY_SENTINEL}>➕ Create New Tournament</option>
                {tournaments.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
            </label>
            {targetTournamentId === NEW_TOURNEY_SENTINEL && (
              <label className="text-xs block mb-3">Tournament Name
                <input className="w-full field border rounded-xl p-2 focus:border-white outline-none" style={{ borderColor: TM_BLUE }} value={tName} onChange={e => setTName(e.target.value)} placeholder="e.g., Office TT Cup — Aug 2025" />
              </label>
            )}

            <label className="text-xs block mb-2">Players (one per line)</label>
            <textarea
              className="w-full h-40 field border rounded p-2 mb-2" style={{ borderColor: TM_BLUE }}
              placeholder={`Enter player names, one per line\nExample:\nAkhil\nDevi\nRahul\nMeera`}
              value={namesText}
              onChange={e => setNamesText(e.target.value)}
            />

            <div className="flex items-center justify-between mb-2">
              <div>
                <input
                  ref={uploadRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    await handlePlayersUpload(f);
                    if (uploadRef.current) uploadRef.current.value = "";
                  }}
                />
                <button
                  className={`px-3 py-2 border rounded inline-flex items-center gap-2 ${targetTournamentId !== NEW_TOURNEY_SENTINEL ? 'border-zinc-700 text-zinc-500 cursor-not-allowed' : 'border-white hover:bg-white hover:text-black'}`}
                  title="Upload Entry"
                  onClick={() => { if (targetTournamentId === NEW_TOURNEY_SENTINEL && uploadRef.current) uploadRef.current.click(); }}
                  disabled={targetTournamentId !== NEW_TOURNEY_SENTINEL}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path d="M12 3a1 1 0 0 1 1 1v8.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4A1 1 0 1 1 8.707 10.293L11 12.586V4a1 1 0 0 1 1-1z"/>
                    <path d="M4 15a1 1 0 0 1 1-1h2a1 1 0 1 1 0 2H6v2h12v-2h-1a1 1 0 1 1 0-2h2a1 1 0 0 1 1 1v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4z"/>
                  </svg>
                  <span>Upload Entry</span>
                </button>
              </div>

              <button
                className={`px-3 py-2 border rounded border-white hover:bg-white hover:text-black`}
                onClick={targetTournamentId === NEW_TOURNEY_SENTINEL ? loadTeamsFromText : () =>
                  applyEntriesToTournament(
                    targetTournamentId,
                    builderTeams.length ? builderTeams.map(b => b.name) : namesText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
                  )
                }
              >
                Add Entries
              </button>
            </div>

            {targetTournamentId === NEW_TOURNEY_SENTINEL && builderTeams.length > 0 && (
              <div className="my-3 grid grid-cols-2 md:grid-cols-4 gap-4 items-center">
                {[{ label: "Seed 1", v: seed1, set: setSeed1 }, { label: "Seed 2", v: seed2, set: setSeed2 }, { label: "Seed 3", v: seed3, set: setSeed3 }, { label: "Seed 4", v: seed4, set: setSeed4 }].map((s) => (
                  <label key={s.label} className="text-xs">{s.label}
                    <select className="field border rounded p-1 ml-1 w-full" style={{ borderColor: TM_BLUE }} value={s.v} onChange={(e) => s.set(e.target.value)}>
                      <option value="">—</option>
                      {builderTeams.map((tm) => (<option key={tm.id} value={tm.name}>{tm.name}</option>))}
                    </select>
                  </label>
                ))}
              </div>
            )}

            <div className="mt-6 text-center">
              <button className="px-4 py-2 border border-emerald-400 text-emerald-300 rounded hover:bg-emerald-400 hover:text-black" onClick={createTournament}>
                {targetTournamentId === NEW_TOURNEY_SENTINEL ? 'Create Tournament' : 'Apply Entries to Selected'}
              </button>
            </div>
          </div>

          <div className="border rounded-2xl p-4 glass" style={{ borderColor: TM_BLUE }}>
            <h2 className="font-semibold mb-3">Tips</h2>
            <ul className="list-disc ml-5 text-sm text-white/90 space-y-1">
              <li>Cloud sync uses a Worker proxy to GitHub (configure URL + APP_KEY).</li>
              <li>Seeds: up to 4; minimum 2 required.</li>
              <li>Use Bracket View + Print in FIXTURES for a clean printable layout.</li>
              <li>Delete requires password; moved to admin-only DELETED tab.</li>
            </ul>
          </div>
        </section>
      ) : (
        <section className="border rounded-2xl p-6 text-sm glass" style={{ borderColor: TM_BLUE }}>
          Viewer mode. Please <button className="underline" onClick={() => setShowLogin(true)}>login as Admin</button> to access SCHEDULE.
        </section>
      ))}

      {/* FIXTURES */}
      {tab === "fixtures" && (
        <section>
          {activeTournaments.length === 0 && (
            <p className="text-white/80 text-sm">No active tournaments. {isAdmin ? <>Create one from <b>SCHEDULE</b>.</> : <>Ask an admin to create one.</>}</p>
          )}

          {activeTournaments.map(tn => {
            const mr = maxRound(tn);
            const counts = roundCounts(tn);
            const canNext = canGenerateNext(tn);
            const teamMap = Object.fromEntries(tn.teams.map(tm => [tm.id, tm.name]));

            const [showBracket, setShowBracket] = useState(false);

            return (
              <Collapsible key={tn.id} title={tn.name} subtitle={`Active • ${tn.teams.length} players`} right={
                <div className="flex items-center gap-2">
                  {isAdmin && <button className="px-2 py-1 rounded border border-red-400 text-red-300 hover:bg-red-400 hover:text-black" onClick={() => openDelete(tn)} title="Delete tournament">Delete</button>}
                  <span className="text-xs text-white/70">Current: {stageLabelByCount(counts.get(mr)) || `Round ${mr}`}</span>
                  <button className="px-3 py-2 rounded-xl border transition border-white hover:bg-white hover:text-black" onClick={() => { setShowBracket(v => !v); }}>{showBracket ? 'List View' : 'Bracket View'}</button>
                  {isAdmin && (
                    <button className={`px-3 py-2 rounded-xl border transition ${canNext ? "border-white hover:bg-white hover:text-black" : "border-zinc-700 text-zinc-500 cursor-not-allowed"}`} disabled={!canNext} onClick={() => generateNextRound(tn.id)}>Generate Next Round</button>
                  )}
                  <button className="px-3 py-2 rounded-xl border transition border-white hover:bg-white hover:text-black no-print" onClick={() => window.print()}>Print</button>
                </div>
              } defaultOpen={true}>
                {!showBracket ? (
                  <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                    {tn.matches.map((m, i) => (
                      <MatchRow
                        key={m.id}
                        idx={i + 1}
                        m={m}
                        teamMap={teamMap}
                        stageText={stageLabelByCount(roundCounts(tn).get(m.round)) || `Round ${m.round}`}
                        onPickWinner={(mid, wid) => isAdmin ? pickWinner(tn.id, mid, wid) : null}
                        canEdit={isAdmin}
                      />
                    ))}
                  </div>
                ) : (
                  <Bracket tournament={tn} />
                )}
              </Collapsible>
            );
          })}
        </section>
      )}

      {/* STANDINGS */}
      {tab === "standings" && (
        <section>
          {tournaments.length === 0 && (
            <p className="text-white/80 text-sm">No tournaments yet. {isAdmin ? <>Create one from <b>SCHEDULE</b>.</> : <>Ask an admin to create one.</>}</p>
          )}

          {tournaments.map(tn => {
            const teamMap = Object.fromEntries(tn.teams.map(tm => [tm.id, tm.name]));
            const byRound = new Map();
            for (const m of tn.matches) { if (!byRound.has(m.round)) byRound.set(m.round, []); byRound.get(m.round).push(m); }
            const ordered = Array.from(byRound.entries()).sort((a, b) => a[0] - b[0]);
            const mr = tn.matches.length ? Math.max(...tn.matches.map(m => m.round)) : 1;
            const subtitle = tn.status === "completed"
              ? `Completed • Champion: ${tn.championId ? (teamMap[tn.championId] || 'TBD') : 'TBD'}`
              : `Active • Current: ${stageLabelByCount(ordered.find(([r]) => r === mr)?.[1].length || 0) || `Round ${mr}`}`;
            return (
              <Collapsible key={tn.id} title={tn.name} subtitle={subtitle} defaultOpen={false}>
                {ordered.map(([round, arr]) => (
                  <div key={round} className="mb-3">
                    <h3 className="font-semibold mb-1">{stageLabelByCount(arr.length) || `Round ${round}`}</h3>
                    <ul className="space-y-1 text-sm">
                      {arr.map((m, i) => {
                        const a = teamMap[m.aId] || "BYE/TBD";
                        const b = teamMap[m.bId] || "BYE/TBD";
                        const w = m.winnerId ? (teamMap[m.winnerId] || "TBD") : null;
                        const isFinals = (stageLabelByCount(arr.length) === 'Finals');
                        return (
                          <li key={m.id}>
                            {isFinals ? (
                              <>{a} vs {b} — {w ? <b>{w}</b> : <span className="text-zinc-400">TBD</span>}</>
                            ) : (
                              <>Match {i + 1}: {a} vs {b} — {w ? <b>{w}</b> : <span className="text-zinc-400">TBD</span>}</>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </Collapsible>
            );
          })}
        </section>
      )}

      {/* WINNERS */}
      {tab === "winners" && (
        <section>
          {completedTournaments.length === 0 && (
            <p className="text-white/80 text-sm">No completed tournaments yet. Finish one in <b>FIXTURES</b>.</p>
          )}

          {completedTournaments.map(tn => {
            const teamMap = Object.fromEntries(tn.teams.map(tm => [tm.id, tm.name]));
            const byRound = new Map();
            for (const m of tn.matches) { if (!m.winnerId) continue; if (!byRound.has(m.round)) byRound.set(m.round, []); byRound.get(m.round).push(m); }
            const ordered = Array.from(byRound.entries()).sort((a, b) => a[0] - b[0]).filter(([_, arr]) => {
              const label = stageLabelByCount(arr.length);
              return label === 'Finals' || label === 'Semi Finals';
            });
            const championName = tn.championId ? (teamMap[tn.championId] || "TBD") : "TBD";

            return (
              <Collapsible key={tn.id} title={tn.name} subtitle={`Champion: ${championName}`} defaultOpen={false}>
                {ordered.length === 0 ? (
                  <p className="text-white/80 text-sm">No Semi Finals/Finals recorded yet.</p>
                ) : ordered.map(([round, arr]) => (
                  <div key={round} className="mb-3">
                    <h3 className="font-semibold mb-1">{stageLabelByCount(arr.length)}</h3>
                    <ul className="space-y-1 text-sm">
                      {arr.map((m, i) => {
                        const a = teamMap[m.aId] || "BYE/TBD";
                        const b = teamMap[m.bId] || "BYE/TBD";
                        const w = teamMap[m.winnerId] || "TBD";
                        return (
                          <li key={m.id}>
                            {arr.length === 1 ? (
                              <>{a} vs {b} — <b>{w}</b></>
                            ) : (
                              <>Match {i + 1}: {a} vs {b} — <b>{w}</b></>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </Collapsible>
            );
          })}
        </section>
      )}

      {/* DELETED (Admin-only) */}
      {tab === "deleted" && isAdmin && (
        <section>
          {deletedTournaments.length === 0 ? (
            <p className="text-white/80 text-sm">No deleted tournaments.</p>
          ) : (
            deletedTournaments.map((tn) => (
              <Collapsible key={tn.id} title={tn.name} subtitle={`Deleted on ${new Date(tn.deletedAt).toLocaleString()}`} defaultOpen={false}>
                <p className="text-sm text-white/70">Players: {tn.teams.length}</p>
                <p className="text-sm text-white/70">Matches: {tn.matches.length}</p>
              </Collapsible>
            ))
          )}
        </section>
      )}

      {/* FOOTER */}
      <footer className="fixed bottom-4 right-6 text-2xl font-bold text-white/80">CV ENGG TML</footer>
    </div>
  );
}
