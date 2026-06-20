/* ==========================================================================
 NUTRITION LOGGER
 ==========================================================================
 Storage priority:
 1. File System Access API (Chrome/Edge): writes to disk on every change
 2. localStorage: always-on backup
 3. Manual import/export: universal fallback

 Companion file: nutrition_data.json (used for autocomplete)
 Log file:       nutrition_log.json (user picks location via Connect file)
 ========================================================================== */

const LOG_KEY = 'nutrition_log_v1';
const HANDLE_KEY = 'nutrition_log_handle_v1';
const DATA_URL = 'nutrition_data.json';

const DEFAULT_TARGETS = { cal: 2000, pro: 100, fib: 40 };
const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];
const MEAL_LABELS = {
breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', other: 'Other'
};

// Stable per-person accent palette (used for charts + dropdown chips)
const PERSON_COLORS = [
'#E8A03E',  // saffron (Sri default)
'#7CB47A',  // sage
'#6FAFC4',  // sky
'#D4AF6A',  // gold
'#C4729E',  // mauve
'#E0A0A0',  // rose
'#9A9CE0',  // periwinkle
'#E8C56F'   // pale gold
];

// Mifflin–St Jeor activity multipliers (TDEE = BMR × multiplier)
const ACTIVITY_LEVELS = {
sedentary:   { mult: 1.2,   label: 'Sedentary',   sub: 'desk job, little exercise' },
light:       { mult: 1.375, label: 'Light',       sub: '1–3 workouts / week' },
moderate:    { mult: 1.55,  label: 'Moderate',    sub: '3–5 workouts / week' },
active:      { mult: 1.725, label: 'Active',      sub: '6–7 workouts / week' },
very_active: { mult: 1.9,   label: 'Very active', sub: 'twice-daily or physical job' }
};

// Fat energy density — used for deficit-to-weight predictions and milestones
const KCAL_PER_KG_FAT = 7700;
const KCAL_PER_LB_FAT = 3500;

/* ============ STATE ============ */
const state = {
log: null,
fileHandle: null,
foodIndex: [],          // built from nutrition_data.json
view: 'today',
activePersonId: null,   // which person we're viewing/editing
selectedDate: new Date(),
selectedWeek: new Date(),
selectedMonth: new Date(),
weightPeriod: 30,       // days shown in weight chart
exercisePeriod: 30,     // days shown in exercise chart
autocompleteIdx: -1,
lastSeenMilestone: 0    // for cumulative-deficit milestone celebration (1 kg = 7700 kcal)
};

/* ============ DOM HELPERS ============ */
const $  = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

/* ============ DATE HELPERS ============ */
const startOfDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = d => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const sameDay    = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
const addDays    = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = d => {
// Week starts Monday
const x = startOfDay(d);
const day = x.getDay();
const diff = (day === 0 ? -6 : 1 - day);
return addDays(x, diff);
};
const startOfMonth = d => { const x = startOfDay(d); x.setDate(1); return x; };
const endOfMonth   = d => { const x = startOfMonth(d); x.setMonth(x.getMonth() + 1); return addDays(x, -1); };

const fmtDate = d => d.toLocaleDateString('en-US', {
weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});
const fmtDateShort = d => d.toLocaleDateString('en-US', {
month: 'short', day: 'numeric'
});
const fmtTime = d => d.toLocaleTimeString('en-US', {
hour: 'numeric', minute: '2-digit'
});
const fmtMonth = d => d.toLocaleDateString('en-US', {
year: 'numeric', month: 'long'
});

const toLocalDatetimeInput = d => {
// datetime-local needs YYYY-MM-DDTHH:MM in local time
const pad = n => String(n).padStart(2, '0');
return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const uid = () =>
(crypto && crypto.randomUUID) ? crypto.randomUUID() :
Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ============ PERSON HELPERS ============ */
function activePerson() {
if (!state.log || !Array.isArray(state.log.people) || state.log.people.length === 0) return null;
return state.log.people.find(p => p.id === state.activePersonId) || state.log.people[0];
}

function entriesForPerson(personId) {
return (state.log.entries || []).filter(e => e.personId === personId);
}

function weightsForPerson(personId) {
return (state.log.weights || []).filter(w => w.personId === personId);
}

function exercisesForPerson(personId) {
return (state.log.exercises || []).filter(x => x.personId === personId);
}

function activeEntries()    { const p = activePerson(); return p ? entriesForPerson(p.id) : []; }
function activeWeights()    { const p = activePerson(); return p ? weightsForPerson(p.id) : []; }
function activeExercises()  { const p = activePerson(); return p ? exercisesForPerson(p.id) : []; }
function activeTargets()    { const p = activePerson(); return p ? p.targets : { ...DEFAULT_TARGETS }; }
function activeWS()         { const p = activePerson(); return p ? p.weightSettings : { unit: 'lbs', goal: null }; }

function addPerson(name) {
name = (name || '').trim();
if (!name) return null;
const id = uid();
const colorIndex = state.log.people.length;
const person = Storage.makePerson(id, name, colorIndex);
state.log.people.push(person);
state.activePersonId = id;
state.log.activePersonId = id;
Storage.saveAll(state.log);
syncPersonUI();
renderAll();
toast(`Added person: ${name}`, 'success');
return id;
}

function removePerson(id) {
if (!id) return;
if (state.log.people.length <= 1) {
  toast('Cannot remove the last person', 'error');
  return;
}
const person = state.log.people.find(p => p.id === id);
if (!person) return;
const entryCount = entriesForPerson(id).length;
const weightCount = weightsForPerson(id).length;
const exerciseCount = exercisesForPerson(id).length;
const confirmMsg = `Remove "${person.name}" and delete ${entryCount} meal${entryCount === 1 ? '' : 's'}, ${weightCount} weight entr${weightCount === 1 ? 'y' : 'ies'}, and ${exerciseCount} exercise session${exerciseCount === 1 ? '' : 's'}? This cannot be undone.`;
if (!confirm(confirmMsg)) return;
state.log.people = state.log.people.filter(p => p.id !== id);
state.log.entries = state.log.entries.filter(e => e.personId !== id);
state.log.weights = state.log.weights.filter(w => w.personId !== id);
state.log.exercises = (state.log.exercises || []).filter(x => x.personId !== id);
if (state.activePersonId === id) {
  state.activePersonId = state.log.people[0].id;
  state.log.activePersonId = state.activePersonId;
}
Storage.saveAll(state.log);
syncPersonUI();
renderAll();
toast(`Removed ${person.name}`, 'success');
}

function switchPerson(id) {
if (!id || id === state.activePersonId) return;
if (!state.log.people.find(p => p.id === id)) return;
state.activePersonId = id;
state.log.activePersonId = id;
// Reset milestone tracker — recompute on next render against the new person's history
state.lastSeenMilestone = Math.floor(cumulativeDeficit() / KCAL_PER_KG_FAT) || 0;
Storage.saveAll(state.log);
syncPersonUI();
renderAll();
}

/* ============ CALORIE CALCULATIONS (Mifflin–St Jeor) ============ */
function calcBMR(profile, weightKg) {
if (!profile || !profile.gender || !profile.age || !profile.heightCm || !weightKg) return null;
const w = Number(weightKg);
const h = Number(profile.heightCm);
const a = Number(profile.age);
if (!w || !h || !a) return null;
if (profile.gender === 'male')   return 10 * w + 6.25 * h - 5 * a + 5;
if (profile.gender === 'female') return 10 * w + 6.25 * h - 5 * a - 161;
return null;
}

function calcTDEE(bmr, activityLevel) {
if (bmr == null) return null;
const a = ACTIVITY_LEVELS[activityLevel] || ACTIVITY_LEVELS.moderate;
return bmr * a.mult;
}

// Latest weight in lbs for active person (returns null if none)
function latestWeightLbs(personId) {
const id = personId || (activePerson() && activePerson().id);
if (!id) return null;
const ws = weightsForPerson(id).slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
return ws[0] ? ws[0].value : null;
}

// TDEE for the active person, using their profile + latest weight
function activeTDEE() {
const p = activePerson();
if (!p) return null;
const lbs = latestWeightLbs(p.id);
if (lbs == null) return null;
const kg = lbs * 0.45359237;
const bmr = calcBMR(p.profile, kg);
return calcTDEE(bmr, p.profile.activityLevel);
}

function activeBMR() {
const p = activePerson();
if (!p) return null;
const lbs = latestWeightLbs(p.id);
if (lbs == null) return null;
return calcBMR(p.profile, lbs * 0.45359237);
}

// Daily deficit for a specific date (TDEE - calories consumed). Null if TDEE unknown.
function exerciseKcalForDay(date) {
return activeExercises()
  .filter(x => sameDay(new Date(x.timestamp), date))
  .reduce((sum, x) => sum + (Number(x.kcal) || 0), 0);
}

function deficitForDay(date) {
const tdee = activeTDEE();
if (tdee == null) return null;
const consumed = sumMacros(entriesForDay(date)).cal;
const burned   = exerciseKcalForDay(date);
// Exercise burn ADDS to the deficit (you burned more than your sedentary TDEE assumed)
return (tdee - consumed) + burned;
}

// Cumulative deficit across all days that have entries OR exercises for active person
function cumulativeDeficit() {
const tdee = activeTDEE();
if (tdee == null) return null;
const byDayConsumed = {};
const byDayBurned   = {};
activeEntries().forEach(e => {
  const day = startOfDay(new Date(e.timestamp)).toISOString();
  byDayConsumed[day] = (byDayConsumed[day] || 0) + (e.cal || 0);
});
activeExercises().forEach(x => {
  const day = startOfDay(new Date(x.timestamp)).toISOString();
  byDayBurned[day] = (byDayBurned[day] || 0) + (Number(x.kcal) || 0);
});
// Union of days that have either entries or exercises
const allDays = new Set([...Object.keys(byDayConsumed), ...Object.keys(byDayBurned)]);
let cum = 0;
allDays.forEach(day => {
  const cal    = byDayConsumed[day] || 0;
  const burned = byDayBurned[day] || 0;
  cum += (tdee - cal) + burned;
});
return cum;
}

/* ============ STORAGE LAYER ============ */
const Storage = {
emptyLog() {
  const defaultPersonId = uid();
  return {
    version: '6.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    people: [ Storage.makePerson(defaultPersonId, 'Person 01', 0) ],
    activePersonId: defaultPersonId,
    entries: [],
    weights: [],
    exercises: []
  };
},

makePerson(id, name, colorIndex) {
  return {
    id: id || uid(),
    name: name || 'New person',
    color: PERSON_COLORS[colorIndex % PERSON_COLORS.length],
    profile: { gender: null, age: null, heightCm: null, activityLevel: 'moderate' },
    targets: { ...DEFAULT_TARGETS },
    weightSettings: { unit: 'lbs', goal: null }
  };
},

// Strict schema validation. Only v6.0 is accepted.
// No backward-compatible migration paths — old logs must be edited by hand.
// Throws an Error with a specific message identifying what's wrong.
validateSchema(log) {
  if (!log || typeof log !== 'object' || Array.isArray(log)) {
    throw new Error('Log must be a JSON object');
  }
  if (log.version !== '6.0') {
    throw new Error(
      'Unsupported schema version: ' + JSON.stringify(log.version) +
      '. This app requires version "6.0". ' +
      'If you have an older log, set "version": "6.0" at the top of the JSON ' +
      '(structure is identical to the prior v2.1 schema).'
    );
  }
  if (!Array.isArray(log.people) || log.people.length === 0) {
    throw new Error('Schema v6.0 requires a non-empty "people" array');
  }
  if (!Array.isArray(log.entries))   throw new Error('Schema v6.0 requires an "entries" array');
  if (!Array.isArray(log.weights))   throw new Error('Schema v6.0 requires a "weights" array');
  if (!Array.isArray(log.exercises)) throw new Error('Schema v6.0 requires an "exercises" array');
  if (!log.activePersonId)           throw new Error('Schema v6.0 requires an "activePersonId" field');
  return log;
},

loadLocal() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      try {
        return Storage.validateSchema(parsed);
      } catch (schemaErr) {
        console.error('[loadLocal] Schema validation failed:', schemaErr.message);
        // Preserve the invalid data under a backup key so user can recover/fix it
        try {
          localStorage.setItem(LOG_KEY + '_invalid_backup', raw);
          console.warn('[loadLocal] Invalid log backed up to ' + LOG_KEY + '_invalid_backup');
        } catch (_) {}
        // Notify the user once the toast system is available (after DOM ready)
        setTimeout(() => {
          if (typeof toast === 'function') {
            toast('Saved log rejected: ' + schemaErr.message + ' · Use Import to load a v6.0 file', 'error');
          }
        }, 500);
        return null;  // Falls back to emptyLog() in caller
      }
    }
  } catch (e) { console.warn('localStorage load failed:', e); }
  return null;
},

saveLocal(log) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch (e) { console.warn('localStorage save failed:', e); }
},

async saveAll(log) {
  log.updatedAt = new Date().toISOString();
  this.saveLocal(log);
  if (state.fileHandle) {
    try {
      const writable = await state.fileHandle.createWritable();
      await writable.write(JSON.stringify(log, null, 2));
      await writable.close();
    } catch (e) {
      console.warn('File save failed:', e);
      toast('File write failed — falling back to browser storage', 'error');
      state.fileHandle = null;
      updateStorageStatus();
    }
  }
},

// File System Access API support
fsaSupported() {
  return 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
},

async connectExistingFile() {
  if (!this.fsaSupported()) {
    toast('File System Access not supported in this browser — use Export/Import', 'error');
    return false;
  }
  try {
    // showOpenFilePicker — picks an existing file, no overwrite warning
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON log file', accept: { 'application/json': ['.json'] } }],
      multiple: false
    });

    // showOpenFilePicker grants read-only by default — request readwrite
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        toast('Write permission denied — file would be read-only', 'error');
        return false;
      }
    }

    // Read what's already in the file
    const file = await handle.getFile();
    let text = (await file.text());
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    text = text.trim();

    let fileLog = null;
    let schemaError = null;
    if (text) {
      try {
        const parsed = JSON.parse(text);
        try {
          fileLog = Storage.validateSchema(parsed);
        } catch (schemaErr) {
          schemaError = schemaErr.message;
          console.warn('[Connect] schema validation failed:', schemaError);
        }
      } catch (e) {
        console.warn('[Connect] file is not valid JSON:', e.message);
        schemaError = 'File is not valid JSON';
      }
    }

    // If the file exists but its schema is wrong, refuse to connect
    // (don't clobber the user's existing data on disk)
    if (text && schemaError) {
      toast('Connect aborted · ' + schemaError, 'error');
      return false;
    }

    // Merge: file is source of truth, browser-only items get appended
    if (fileLog) {
      // ----- People merge -----
      const filePeopleById = new Map(fileLog.people.map(p => [p.id, p]));
      const stateOnly = (state.log.people || []).filter(p => !filePeopleById.has(p.id));
      const mergedPeople = [...fileLog.people, ...stateOnly];

      // ----- Entries merge by id -----
      const seenE = new Set(fileLog.entries.map(e => e.id).filter(Boolean));
      const stateEntries = state.log.entries || [];
      const addE = stateEntries.filter(e => e.id && !seenE.has(e.id));

      // ----- Weights merge by id -----
      const fileWeights = Array.isArray(fileLog.weights) ? fileLog.weights : [];
      const seenW = new Set(fileWeights.map(w => w.id).filter(Boolean));
      const stateWeights = Array.isArray(state.log.weights) ? state.log.weights : [];
      const addW = stateWeights.filter(w => w.id && !seenW.has(w.id));

      // ----- Exercises merge by id -----
      const fileExercises = Array.isArray(fileLog.exercises) ? fileLog.exercises : [];
      const seenX = new Set(fileExercises.map(x => x.id).filter(Boolean));
      const stateExercises = Array.isArray(state.log.exercises) ? state.log.exercises : [];
      const addX = stateExercises.filter(x => x.id && !seenX.has(x.id));

      const validIds = new Set(mergedPeople.map(p => p.id));
      const fallbackId = mergedPeople[0].id;
      const normalizeEntry = e => ({
        id:        e.id || uid(),
        personId:  validIds.has(e.personId) ? e.personId : fallbackId,
        timestamp: e.timestamp || new Date().toISOString(),
        meal:      e.meal || 'other',
        food:      String(e.food || 'Unknown'),
        cal:       Number(e.cal) || 0,
        pro:       Number(e.pro) || 0,
        fib:       Number(e.fib) || 0,
        notes:     e.notes || ''
      });
      const normalizeWeight = w => ({
        id:        w.id || uid(),
        personId:  validIds.has(w.personId) ? w.personId : fallbackId,
        timestamp: w.timestamp || new Date().toISOString(),
        value:     Number(w.value) || 0,
        notes:     w.notes || ''
      });
      const normalizeExercise = x => ({
        id:          x.id || uid(),
        personId:    validIds.has(x.personId) ? x.personId : fallbackId,
        timestamp:   x.timestamp || new Date().toISOString(),
        activity:    String(x.activity || 'Unknown'),
        durationMin: Number(x.durationMin) || 0,
        kcal:        Number(x.kcal) || 0,
        notes:       x.notes || ''
      });

      const merged = {
        version:        '6.0',
        createdAt:      fileLog.createdAt || new Date().toISOString(),
        updatedAt:      new Date().toISOString(),
        activePersonId: fileLog.activePersonId || fallbackId,
        people:         mergedPeople,
        entries:   [...fileLog.entries, ...addE].map(normalizeEntry),
        weights:   [...fileWeights, ...addW].map(normalizeWeight),
        exercises: [...fileExercises, ...addX].map(normalizeExercise)
      };
      state.log = merged;
      state.activePersonId = merged.activePersonId;
      syncPersonUI();
      const addCount = addE.length + addW.length + addX.length + stateOnly.length;
      if (addCount > 0) {
        toast(`Connected · ${fileLog.people.length} people, ${fileLog.entries.length} meals + ${fileWeights.length} weights + ${fileExercises.length} sessions from file (+ ${addCount} appended)`, 'success');
      } else {
        toast(`Connected · ${fileLog.people.length} people, ${fileLog.entries.length} meals, ${fileWeights.length} weights, ${fileExercises.length} sessions loaded`, 'success');
      }
    } else {
      // File empty / unparseable — keep current state, write to file
      toast(`Connected to ${handle.name} · writing current state`, 'success');
    }

    state.fileHandle = handle;
    await this.saveAll(state.log);
    updateStorageStatus();
    renderAll();
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.warn('[Connect] failed:', e);
      toast('Connect failed: ' + e.message, 'error');
    }
    return false;
  }
},

async exportDownload() {
  const blob = new Blob([JSON.stringify(state.log, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nutrition_log.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported nutrition_log.json', 'success');
},

async importFromFile(file) {
  console.log('[Import] file:', file && file.name, file && file.size, 'bytes, type:', file && file.type);
  try {
    if (!file) throw new Error('No file selected');
    if (file.size === 0) throw new Error('File is empty (0 bytes)');

    // Read text — try modern then legacy approach
    let text;
    try {
      text = await file.text();
    } catch (readErr) {
      // Fallback: FileReader for older browsers
      text = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(r.result);
        r.onerror = () => reject(new Error('FileReader failed'));
        r.readAsText(file);
      });
    }
    console.log('[Import] read', text.length, 'characters');

    // Strip BOM if present
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    text = text.trim();
    if (!text) throw new Error('File contained no text');

    // Parse
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      throw new Error('Not valid JSON — ' + parseErr.message);
    }
    console.log('[Import] parsed keys:', data && typeof data === 'object' ? Object.keys(data) : data);

    // Strict schema validation — only v6.0 accepted
    Storage.validateSchema(data);

    // Build the new log defensively — coerce types, fill missing fields.
    // Schema is already validated; this step is field-level defensive coercion
    // against malformed values (e.g. cal: "300" string instead of number).
    const newLog = {
      version:        '6.0',
      createdAt:      data.createdAt || new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
      activePersonId: data.activePersonId,
      people: data.people.map((p, i) => ({
        id:       p.id || uid(),
        name:     String(p.name || 'Person ' + (i + 1)),
        color:    p.color || PERSON_COLORS[i % PERSON_COLORS.length],
        profile: {
          gender:        (p.profile && p.profile.gender) || null,
          age:           p.profile && p.profile.age != null ? Number(p.profile.age) : null,
          heightCm:      p.profile && p.profile.heightCm != null ? Number(p.profile.heightCm) : null,
          activityLevel: (p.profile && p.profile.activityLevel) || 'moderate'
        },
        targets: {
          cal: Number((p.targets || {}).cal) || DEFAULT_TARGETS.cal,
          pro: Number((p.targets || {}).pro) || DEFAULT_TARGETS.pro,
          fib: Number((p.targets || {}).fib) || DEFAULT_TARGETS.fib
        },
        weightSettings: {
          unit: (p.weightSettings && p.weightSettings.unit === 'kg') ? 'kg' : 'lbs',
          goal: (p.weightSettings && p.weightSettings.goal != null) ? Number(p.weightSettings.goal) : null
        }
      })),
      entries:   [],
      weights:   [],
      exercises: []
    };

    const validIds   = new Set(newLog.people.map(p => p.id));
    const fallbackId = newLog.people[0].id;

    newLog.entries = data.entries.map(e => ({
      id:        e.id || uid(),
      personId:  validIds.has(e.personId) ? e.personId : fallbackId,
      timestamp: e.timestamp || new Date().toISOString(),
      meal:      e.meal || 'other',
      food:      String(e.food || 'Unknown'),
      cal:       Number(e.cal) || 0,
      pro:       Number(e.pro) || 0,
      fib:       Number(e.fib) || 0,
      notes:     e.notes || ''
    }));

    newLog.weights = data.weights.map(w => ({
      id:        w.id || uid(),
      personId:  validIds.has(w.personId) ? w.personId : fallbackId,
      timestamp: w.timestamp || new Date().toISOString(),
      value:     Number(w.value) || 0,
      notes:     w.notes || ''
    }));

    newLog.exercises = data.exercises.map(x => ({
      id:          x.id || uid(),
      personId:    validIds.has(x.personId) ? x.personId : fallbackId,
      timestamp:   x.timestamp || new Date().toISOString(),
      activity:    String(x.activity || 'Unknown'),
      durationMin: Number(x.durationMin) || 0,
      kcal:        Number(x.kcal) || 0,
      notes:       x.notes || ''
    }));

    // Ensure activePersonId still points at a real person after normalization
    if (!validIds.has(newLog.activePersonId)) {
      newLog.activePersonId = fallbackId;
    }

    state.log = newLog;
    state.activePersonId = newLog.activePersonId;

    // Refresh per-person UI bound to active person
    syncPersonUI();

    await this.saveAll(newLog);
    renderAll();
    const exCount = newLog.exercises.length;
    const exNote = exCount > 0 ? ` and ${exCount} exercise session${exCount === 1 ? '' : 's'}` : '';
    toast(`Imported ${newLog.entries.length} entries${exNote} across ${newLog.people.length} ${newLog.people.length === 1 ? 'person' : 'people'}`, 'success');
  } catch (e) {
    console.error('[Import] failed:', e);
    toast('Import failed: ' + e.message, 'error');
  }
}
};

/* ============ FOOD INDEX (from nutrition_data.json) ============ */
async function loadFoodIndex() {
try {
  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!res.ok) return;
  const data = await res.json();
  const idx = [];
  Object.values(data.sections || {}).forEach(section => {
    (section.items || []).forEach(item => {
      idx.push({
        name: item.name,
        serving: item.serving,
        cal: item.cal, pro: item.pro, fib: item.fib
      });
    });
  });
  state.foodIndex = idx;
  if (idx.length) {
    $('#form-subtitle').textContent = `Autocomplete connected · ${idx.length} foods indexed from nutrition_data.json`;
  }
} catch (e) {
  // silent — autocomplete just won't be available
}
}

/* ============ INIT ============ */
async function init() {
// Load log from localStorage (start point). loadLocal() runs migration.
state.log = Storage.loadLocal() || Storage.emptyLog();
if (!Array.isArray(state.log.weights)) state.log.weights = [];

// Set the active person — last viewed or first in the list
state.activePersonId = state.log.activePersonId || (state.log.people[0] && state.log.people[0].id);
state.log.activePersonId = state.activePersonId;

// Compute the deficit milestone we should treat as "already seen" on load
// so we don't replay celebrations from history.
const cum = cumulativeDeficit();
state.lastSeenMilestone = cum != null ? Math.max(0, Math.floor(cum / KCAL_PER_KG_FAT)) : 0;

// Set default datetime in forms to now
$('#f-time').value  = toLocalDatetimeInput(new Date());
$('#wf-time').value = toLocalDatetimeInput(new Date());

// Populate per-person UI (targets editor, weight settings, person selector)
syncPersonUI();

// Try to load food index for autocomplete
await loadFoodIndex();

// Bind events
bindEvents();

// Initial render
updateStorageStatus();
renderAll();
}

function updateStorageStatus() {
const fsa = Storage.fsaSupported();
const status = $('#storage-status');
const info = $('#data-source-info');
const connectBtn = $('#btn-connect');

if (state.fileHandle) {
  status.textContent = `Auto-saving to ${state.fileHandle.name} + browser storage`;
  info.textContent = state.fileHandle.name;
  connectBtn.textContent = '⏷ Change file';
} else if (fsa) {
  status.textContent = 'Auto-saving to browser storage · click "Open log file" to write to disk';
  info.textContent = 'localStorage';
  connectBtn.textContent = '⏷ Open log file';
} else {
  status.textContent = 'Auto-saving to browser storage · use Export to back up';
  info.textContent = 'localStorage (file API unsupported)';
  connectBtn.style.display = 'none';
}
}

/* ============ EVENT BINDING ============ */
function bindEvents() {
// Form submission
$('#entry-form').addEventListener('submit', onAddEntry);

// Autocomplete
$('#f-food').addEventListener('input', onFoodInput);
$('#f-food').addEventListener('focus', onFoodInput);
$('#f-food').addEventListener('keydown', onFoodKey);
document.addEventListener('click', e => {
  if (!e.target.closest('#food-field')) $('#food-field').classList.remove('open');
});

// Targets editor — writes to the ACTIVE person's targets
['cal', 'pro', 'fib'].forEach(k => {
  $(`#tgt-${k}`).addEventListener('change', e => {
    const v = Math.max(0, Number(e.target.value) || 0);
    const p = activePerson();
    if (!p) return;
    p.targets[k] = v;
    e.target.value = v;
    Storage.saveAll(state.log);
    renderAll();
  });
});

// Tab switching
$('#tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (btn) showTab(btn.dataset.tab);
});

// Day navigation
$('#day-prev').addEventListener('click',  () => { state.selectedDate = addDays(state.selectedDate, -1); renderToday(); });
$('#day-next').addEventListener('click',  () => { state.selectedDate = addDays(state.selectedDate, 1);  renderToday(); });
$('#day-today').addEventListener('click', () => { state.selectedDate = new Date(); renderToday(); });

// Week navigation
$('#week-prev').addEventListener('click', () => { state.selectedWeek = addDays(state.selectedWeek, -7); renderWeek(); });
$('#week-next').addEventListener('click', () => { state.selectedWeek = addDays(state.selectedWeek, 7);  renderWeek(); });
$('#week-this').addEventListener('click', () => { state.selectedWeek = new Date(); renderWeek(); });

// Month navigation
$('#month-prev').addEventListener('click', () => {
  const d = new Date(state.selectedMonth); d.setMonth(d.getMonth() - 1);
  state.selectedMonth = d; renderMonth();
});
$('#month-next').addEventListener('click', () => {
  const d = new Date(state.selectedMonth); d.setMonth(d.getMonth() + 1);
  state.selectedMonth = d; renderMonth();
});
$('#month-this').addEventListener('click', () => { state.selectedMonth = new Date(); renderMonth(); });

// Storage actions
$('#btn-connect').addEventListener('click', () => Storage.connectExistingFile());
$('#btn-export').addEventListener('click',  () => Storage.exportDownload());
$('#btn-import').addEventListener('click',  () => $('#file-input').click());
$('#btn-clear').addEventListener('click', () => {
  const p = activePerson();
  const msg = state.log.people.length > 1
    ? `Clear ${p.name}'s entries (meals AND weights)? Their profile, targets, and goal will be preserved. Other people are unaffected.`
    : 'Delete ALL entries (meals AND weights)? Profile, targets, and goal will be preserved. This cannot be undone (unless you have a backup).';
  if (!confirm(msg)) return;
  state.log.entries = state.log.entries.filter(e => e.personId !== p.id);
  state.log.weights = state.log.weights.filter(w => w.personId !== p.id);
  state.lastSeenMilestone = 0;
  Storage.saveAll(state.log);
  renderAll();
  toast(`Cleared ${p.name}'s entries`, 'success');
});

$('#file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  // Clear value BEFORE the async work so re-selecting the same file still fires change
  e.target.value = '';
  if (file) await Storage.importFromFile(file);
});

// ----- WEIGHT EVENTS -----
$('#weight-form').addEventListener('submit', onAddWeight);

// Unit toggle — writes to active person's weightSettings
$$('.unit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const ws = activeWS();
    const newUnit = btn.dataset.unit;
    if (newUnit === ws.unit) return;
    ws.unit = newUnit;
    Storage.saveAll(state.log);
    renderWeight();
    renderPlan();
  });
});

// Goal — input is in current display unit, stored as lbs
$('#wf-goal').addEventListener('change', e => {
  const ws = activeWS();
  const v = Number(e.target.value);
  ws.goal = (!v || v <= 0) ? null : toLbs(v, ws.unit);
  Storage.saveAll(state.log);
  renderWeight();
});

// Chart period — scoped to which tab's control was clicked
$$('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = btn.dataset.period;
    const periodValue = (p === 'all') ? 'all' : Number(p);
    const container = btn.closest('.nav-controls');

    if (container && container.id === 'weight-period-controls') {
      state.weightPeriod = periodValue;
      // Update active state in this container only
      container.querySelectorAll('.period-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderWeight();
    } else if (container && container.id === 'exercise-period-controls') {
      state.exercisePeriod = periodValue;
      container.querySelectorAll('.period-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderExercise();
    }
  });
});

// ----- EXERCISE EVENTS -----
$('#exercise-form').addEventListener('submit', onAddExercise);
$('#xf-activity').addEventListener('input', onExerciseInput);
$('#xf-activity').addEventListener('focus', onExerciseInput);
$('#xf-activity').addEventListener('blur', () => {
  // Delay so click on suggestion fires first
  setTimeout(() => { const list = $('#xf-suggest'); if (list) list.hidden = true; }, 150);
});
$('#xf-suggest').addEventListener('click', e => {
  const item = e.target.closest('.suggest-item');
  if (item) pickActivity(item.dataset.name);
});
$('#xf-estimate').addEventListener('click', onEstimateKcal);

// Chart tooltip (single floating tooltip element)
let chartTip = null;
document.addEventListener('mouseover', e => {
  const target = e.target.closest('.data-point');
  if (!target) return;
  if (!chartTip) {
    chartTip = document.createElement('div');
    chartTip.className = 'chart-tip';
    document.body.appendChild(chartTip);
  }
  chartTip.textContent = target.dataset.tip;
  const rect = target.getBoundingClientRect();
  chartTip.style.left = (rect.left + rect.width / 2 - 80) + 'px';
  chartTip.style.top  = (rect.top - 36) + 'px';
  chartTip.classList.add('visible');
});
document.addEventListener('mouseout', e => {
  if (e.target.closest('.data-point') && chartTip) chartTip.classList.remove('visible');
});

// ----- PERSON SELECTOR EVENTS -----
$('#person-select').addEventListener('change', e => switchPerson(e.target.value));

$('#btn-add-person').addEventListener('click', () => {
  const name = prompt('Name of the person to add:');
  if (name && name.trim()) addPerson(name.trim());
});

$('#btn-remove-person').addEventListener('click', () => {
  const p = activePerson();
  if (p) removePerson(p.id);
});

// ----- PLAN FORM EVENTS -----
// Each field writes back to active person's profile on change
const saveProfile = () => {
  const p = activePerson();
  if (!p) return;
  const gender = $('#pf-gender').value || null;
  const age = Number($('#pf-age').value) || null;
  // Height: prefer cm if filled, else compute from ft/in
  let heightCm = Number($('#pf-height-cm').value);
  if (!heightCm) {
    const ft = Number($('#pf-height-ft').value) || 0;
    const inches = Number($('#pf-height-in').value) || 0;
    const totalIn = ft * 12 + inches;
    if (totalIn > 0) heightCm = +(totalIn * 2.54).toFixed(1);
  }
  p.profile = {
    gender,
    age,
    heightCm: heightCm || null,
    activityLevel: $('#pf-activity').value || 'moderate'
  };
  Storage.saveAll(state.log);
  renderPlan();
  renderToday();   // deficit cards depend on profile
  renderInsights();
  renderHeaderRings();
};

['#pf-gender', '#pf-age', '#pf-height-cm', '#pf-height-ft', '#pf-height-in', '#pf-activity']
  .forEach(sel => $(sel).addEventListener('change', saveProfile));

// If cm is changed, blank out ft/in for clarity
$('#pf-height-cm').addEventListener('input', () => {
  if ($('#pf-height-cm').value) {
    $('#pf-height-ft').value = '';
    $('#pf-height-in').value = '';
  }
});
// And vice versa
const onFtIn = () => {
  if ($('#pf-height-ft').value || $('#pf-height-in').value) {
    $('#pf-height-cm').value = '';
  }
};
$('#pf-height-ft').addEventListener('input', onFtIn);
$('#pf-height-in').addEventListener('input', onFtIn);
}

/* ============ ENTRY ADD ============ */
function onAddEntry(e) {
e.preventDefault();
const timeStr = $('#f-time').value;
const meal    = $('#f-meal').value;
const food    = $('#f-food').value.trim();
const cal     = Number($('#f-cal').value);
const pro     = Number($('#f-pro').value);
const fib     = Number($('#f-fib').value);

if (!timeStr || !food) return;

const entry = {
  id: uid(),
  personId: state.activePersonId,
  timestamp: new Date(timeStr).toISOString(),
  meal, food,
  cal: cal || 0, pro: pro || 0, fib: fib || 0,
  notes: ''
};

state.log.entries.push(entry);
Storage.saveAll(state.log);

// Reset form (keep meal type, reset time to next-ish)
$('#f-food').value = '';
$('#f-cal').value = '';
$('#f-pro').value = '';
$('#f-fib').value = '';
$('#f-time').value = toLocalDatetimeInput(new Date());
$('#f-food').focus();

// If logging a non-today date, switch focus there
const entryDate = new Date(entry.timestamp);
if (!sameDay(entryDate, new Date())) {
  state.selectedDate = entryDate;
} else {
  state.selectedDate = new Date();
}

renderAll();
toast(`Added: ${food}`, 'success');
}

/* ============ AUTOCOMPLETE ============ */
function onFoodInput() {
const q = $('#f-food').value.toLowerCase().trim();
const field = $('#food-field');
const list = $('#autocomplete');

if (!state.foodIndex.length) { field.classList.remove('open'); return; }
if (q.length < 1) { field.classList.remove('open'); return; }

const matches = state.foodIndex
  .filter(f => f.name.toLowerCase().includes(q))
  .slice(0, 8);

if (!matches.length) { field.classList.remove('open'); return; }

state.autocompleteIdx = -1;
list.innerHTML = matches.map((f, i) => `
  <div class="suggest-item" data-idx="${i}">
    <div>
      <div class="s-name">${escapeHtml(f.name)}</div>
      <div class="s-serv">${escapeHtml(f.serving)}</div>
    </div>
    <div class="s-macros">
      ${f.cal} kcal · <span class="m-pro">${f.pro}p</span> · <span class="m-fib">${f.fib}f</span>
    </div>
  </div>
`).join('');

list.querySelectorAll('.suggest-item').forEach((node, i) => {
  node.addEventListener('click', () => pickFood(matches[i]));
});

field.classList.add('open');
field.dataset.matches = JSON.stringify(matches);
}

function pickFood(food) {
$('#f-food').value = food.name;
$('#f-cal').value = food.cal;
$('#f-pro').value = food.pro;
$('#f-fib').value = food.fib;
$('#food-field').classList.remove('open');
}

function onFoodKey(e) {
const field = $('#food-field');
if (!field.classList.contains('open')) return;
const items = field.querySelectorAll('.suggest-item');
if (!items.length) return;

if (e.key === 'ArrowDown') {
  e.preventDefault();
  state.autocompleteIdx = Math.min(state.autocompleteIdx + 1, items.length - 1);
} else if (e.key === 'ArrowUp') {
  e.preventDefault();
  state.autocompleteIdx = Math.max(state.autocompleteIdx - 1, 0);
} else if (e.key === 'Enter' && state.autocompleteIdx >= 0) {
  e.preventDefault();
  const matches = JSON.parse(field.dataset.matches || '[]');
  if (matches[state.autocompleteIdx]) pickFood(matches[state.autocompleteIdx]);
  return;
} else if (e.key === 'Escape') {
  field.classList.remove('open');
  return;
} else {
  return;
}
items.forEach((n, i) => n.classList.toggle('active', i === state.autocompleteIdx));
}

/* ============ ENTRY DELETE ============ */
function deleteEntry(id) {
if (!confirm('Delete this entry?')) return;
state.log.entries = state.log.entries.filter(e => e.id !== id);
Storage.saveAll(state.log);
renderAll();
toast('Entry deleted', 'success');
}

/* ============ AGGREGATIONS ============ */
function sumMacros(entries) {
return entries.reduce((acc, e) => ({
  cal: acc.cal + (e.cal || 0),
  pro: acc.pro + (e.pro || 0),
  fib: acc.fib + (e.fib || 0)
}), { cal: 0, pro: 0, fib: 0 });
}

function entriesForDay(date) {
const start = startOfDay(date).getTime();
const end   = endOfDay(date).getTime();
return activeEntries().filter(e => {
  const t = new Date(e.timestamp).getTime();
  return t >= start && t <= end;
}).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function entriesForWeek(date) {
const start = startOfWeek(date);
const days = [];
for (let i = 0; i < 7; i++) {
  const d = addDays(start, i);
  days.push({ date: d, entries: entriesForDay(d) });
}
return { start, days };
}

function entriesForMonth(date) {
const start = startOfMonth(date);
const end   = endOfMonth(date);
const days = [];
for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
  days.push({ date: new Date(d), entries: entriesForDay(d) });
}
return { start, end, days };
}

/* ============ TOP-LEVEL RENDER ============ */
function renderAll() {
renderHeaderDate();
renderHeaderRings();
renderToday();
renderWeek();
renderMonth();
renderPlan();
renderInsights();
renderWeight();
renderExercise();
renderAllEntries();
renderFamily();
}

function renderHeaderDate() {
$('#today-date').textContent = fmtDate(new Date()).toUpperCase();
}

function renderHeaderRings() {
const today = entriesForDay(new Date());
const totals = sumMacros(today);
const { cal, pro, fib } = activeTargets();
$('#rings').innerHTML = `
  ${ring('cal', totals.cal, cal, 'kcal')}
  ${ring('pro', totals.pro, pro, 'protein')}
  ${ring('fib', totals.fib, fib, 'fiber')}
`;
// Animate strokes
requestAnimationFrame(() => requestAnimationFrame(() => {
  $$('.ring-circle-fill').forEach(c => {
    c.style.strokeDashoffset = c.dataset.offset;
  });
}));
}

function ring(klass, value, target, label) {
const R = 28;
const C = 2 * Math.PI * R;
const pct = target > 0 ? Math.min(1, value / target) : 0;
const offset = C * (1 - pct);
const color = klass === 'cal' ? 'var(--cal)' : klass === 'pro' ? 'var(--pro)' : 'var(--fib)';
const met = pct >= 1;
return `
  <div class="ring">
    <svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r="${R}" stroke="rgba(255,255,255,0.06)" stroke-width="5" fill="none"/>
      <circle class="ring-circle-fill" cx="36" cy="36" r="${R}"
              stroke="${color}" stroke-width="5" fill="none"
              stroke-linecap="round"
              stroke-dasharray="${C.toFixed(2)}"
              stroke-dashoffset="${C.toFixed(2)}"
              data-offset="${offset.toFixed(2)}"
              transform="rotate(-90 36 36)"
              style="transition: stroke-dashoffset 1.2s cubic-bezier(0.2, 0.7, 0.2, 1)"/>
      ${met ? `<text x="36" y="42" text-anchor="middle" fill="${color}" font-family="JetBrains Mono" font-size="14" font-weight="600">✓</text>` :
              `<text x="36" y="40" text-anchor="middle" fill="var(--text)" font-family="JetBrains Mono" font-size="12" font-weight="500">${Math.round(pct * 100)}%</text>`}
    </svg>
    <div class="ring-label">${label}</div>
    <div class="ring-value">${value.toFixed(klass === 'cal' ? 0 : 1)}<span class="target"> / ${target}</span></div>
  </div>
`;
}

/* ============ TODAY VIEW ============ */
function renderToday() {
const date = state.selectedDate;
const isToday = sameDay(date, new Date());
$('#today-title').innerHTML = isToday
  ? `Today's <em>intake</em>`
  : `${fmtDate(date)} <em>intake</em>`;

const entries = entriesForDay(date);
const totals  = sumMacros(entries);
const { cal, pro, fib } = activeTargets();

// Summary cards
$('#day-summary').innerHTML = `
  ${statCard('cal', 'kcal', totals.cal, cal)}
  ${statCard('pro', 'protein', totals.pro, pro)}
  ${statCard('fib', 'fiber', totals.fib, fib)}
`;
requestAnimationFrame(() => requestAnimationFrame(() => {
  $$('.stat-fill').forEach(f => f.style.width = f.dataset.pct + '%');
}));

// ----- DEFICIT CARDS + CELEBRATION (if profile set) -----
renderDeficitArea(date, totals);

// Meals
const meals = $('#day-meals');
if (!entries.length) {
  meals.innerHTML = `
    <div class="empty-state">
      <h3>No entries yet${isToday ? ' today' : ''}.</h3>
      <p>Use the form above to log a meal. Macros auto-fill if the food is in your reference.</p>
    </div>
  `;
  return;
}

// Group by meal type
const grouped = {};
entries.forEach(e => {
  if (!grouped[e.meal]) grouped[e.meal] = [];
  grouped[e.meal].push(e);
});

meals.innerHTML = MEAL_ORDER
  .filter(m => grouped[m])
  .map(m => {
    const list = grouped[m];
    const sub = sumMacros(list);
    return `
      <div class="meal-group">
        <div class="meal-header">
          <div class="meal-name">${MEAL_LABELS[m]}</div>
          <div class="meal-subtotal">
            <span class="m-cal">${Math.round(sub.cal)} kcal</span><span class="dot">·</span>
            <span class="m-pro">${sub.pro.toFixed(1)}g pro</span><span class="dot">·</span>
            <span class="m-fib">${sub.fib.toFixed(1)}g fib</span>
          </div>
        </div>
        <div class="entries">
          ${list.map(e => entryRow(e)).join('')}
        </div>
      </div>
    `;
  }).join('');

// Wire delete buttons
meals.querySelectorAll('.entry-delete').forEach(btn => {
  btn.addEventListener('click', () => deleteEntry(btn.dataset.id));
});
}

function statCard(klass, label, value, target) {
const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
const met = pct >= 100;
const unit = klass === 'cal' ? '' : 'g';
const remaining = Math.max(0, target - value);
return `
  <div class="stat-card ${klass} ${met ? 'met' : ''}">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value.toFixed(klass === 'cal' ? 0 : 1)}<span class="unit">${unit}</span></div>
    <div class="stat-target">of ${target} ${unit} target · ${remaining.toFixed(klass === 'cal' ? 0 : 1)} ${unit} to go</div>
    <div class="stat-bar"><div class="stat-fill" data-pct="${pct}"></div></div>
  </div>
`;
}

function entryRow(e) {
const t = new Date(e.timestamp);
return `
  <div class="entry">
    <div class="entry-time">${fmtTime(t)}</div>
    <div class="entry-name">${escapeHtml(e.food)}</div>
    <div class="entry-macros">
      <span class="m cal"><strong>${e.cal}</strong> kcal</span>
      <span class="m pro"><strong>${e.pro}</strong>g pro</span>
      <span class="m fib"><strong>${e.fib}</strong>g fib</span>
    </div>
    <button class="entry-delete" data-id="${e.id}" title="Delete">×</button>
  </div>
`;
}

/* ============ WEEK VIEW ============ */
function renderWeek() {
const { start, days } = entriesForWeek(state.selectedWeek);
const weekEnd = addDays(start, 6);
$('#week-title').innerHTML = `${fmtDateShort(start)} – ${fmtDateShort(weekEnd)} <em>· week of ${start.getFullYear()}</em>`;

const { cal, pro, fib } = activeTargets();
const totals = sumMacros(days.flatMap(d => d.entries));
const daysWithEntries = days.filter(d => d.entries.length > 0).length;
const avg = daysWithEntries > 0 ? {
  cal: totals.cal / daysWithEntries,
  pro: totals.pro / daysWithEntries,
  fib: totals.fib / daysWithEntries
} : { cal: 0, pro: 0, fib: 0 };

const daysHitPro = days.filter(d => sumMacros(d.entries).pro >= pro).length;
const daysHitFib = days.filter(d => sumMacros(d.entries).fib >= fib).length;

$('#week-content').innerHTML = `
  <div class="chart-card">
    <div class="chart-title">Daily intake · last 7 days</div>
    <div class="chart-sub">Each day vs <em>targets</em></div>
    <div class="week-grid">
      ${days.map(d => weekDayCol(d, cal, pro, fib)).join('')}
    </div>
    <div class="legend">
      <div class="lg-item"><span class="lg-sw cal"></span>Calories</div>
      <div class="lg-item"><span class="lg-sw pro"></span>Protein</div>
      <div class="lg-item"><span class="lg-sw fib"></span>Fiber</div>
    </div>
  </div>

  <div class="chart-card">
    <div class="chart-title">Week summary</div>
    <div class="chart-sub">${daysWithEntries} day${daysWithEntries === 1 ? '' : 's'} logged · <em>${daysHitPro}/${days.length} protein targets, ${daysHitFib}/${days.length} fiber targets hit</em></div>
    <div class="week-summary">
      <div class="sum-cell cal">
        <div class="l">Daily avg · calories</div>
        <div class="v">${Math.round(avg.cal)}<span class="unit">kcal</span></div>
      </div>
      <div class="sum-cell pro">
        <div class="l">Daily avg · protein</div>
        <div class="v">${avg.pro.toFixed(1)}<span class="unit">g</span></div>
      </div>
      <div class="sum-cell fib">
        <div class="l">Daily avg · fiber</div>
        <div class="v">${avg.fib.toFixed(1)}<span class="unit">g</span></div>
      </div>
    </div>
    ${weekLineChart(days, cal, pro, fib)}
  </div>
`;

// Animate mini bars
requestAnimationFrame(() => requestAnimationFrame(() => {
  $$('#week-content .mini-fill').forEach(f => f.style.width = f.dataset.pct + '%');
}));
}

function weekDayCol(day, calT, proT, fibT) {
const t = sumMacros(day.entries);
const calPct = calT ? Math.min(100, (t.cal / calT) * 100) : 0;
const proPct = proT ? Math.min(100, (t.pro / proT) * 100) : 0;
const fibPct = fibT ? Math.min(100, (t.fib / fibT) * 100) : 0;
const dayName = day.date.toLocaleDateString('en-US', { weekday: 'short' });
const isToday = sameDay(day.date, new Date());
return `
  <div class="day-col ${isToday ? 'today' : ''}">
    <div class="d-day">${dayName}</div>
    <div class="d-date">${day.date.getDate()}</div>
    <div class="d-bars">
      <div class="mini-bar"><div class="mini-fill cal" data-pct="${calPct}"></div></div>
      <div class="mini-bar"><div class="mini-fill pro" data-pct="${proPct}"></div></div>
      <div class="mini-bar"><div class="mini-fill fib" data-pct="${fibPct}"></div></div>
    </div>
  </div>
`;
}

function weekLineChart(days, calT, proT, fibT) {
const W = 720, H = 200, PAD = { top: 20, right: 20, bottom: 30, left: 36 };
const innerW = W - PAD.left - PAD.right;
const innerH = H - PAD.top - PAD.bottom;
const n = days.length;
const stepX = innerW / (n - 1);

// Normalize each macro to its target = 100%, cap at 150% for room
const ymax = 1.5;
const yScale = v => PAD.top + innerH * (1 - Math.min(ymax, v / ymax) / ymax * ymax);
// simpler: y = PAD.top + innerH * (1 - clamp(v, 0, ymax) / ymax)

const pathFor = (key, target) => {
  if (!target) return '';
  return days.map((d, i) => {
    const totals = sumMacros(d.entries);
    const ratio = totals[key] / target;
    const clipped = Math.min(ymax, ratio);
    const y = PAD.top + innerH * (1 - clipped / ymax);
    const x = PAD.left + i * stepX;
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
};

const targetLineY = PAD.top + innerH * (1 - 1 / ymax);

return `
  <div class="line-chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <!-- target line -->
      <line x1="${PAD.left}" y1="${targetLineY}" x2="${W - PAD.right}" y2="${targetLineY}"
            stroke="rgba(255,255,255,0.15)" stroke-dasharray="3,4"/>
      <text x="${PAD.left - 6}" y="${targetLineY + 3}" text-anchor="end"
            fill="var(--text-dim)" font-family="JetBrains Mono" font-size="9">100%</text>
      <text x="${PAD.left - 6}" y="${PAD.top + innerH * (1 - 0.5/ymax) + 3}" text-anchor="end"
            fill="var(--text-dim)" font-family="JetBrains Mono" font-size="9">50%</text>
      <text x="${PAD.left - 6}" y="${PAD.top + innerH + 3}" text-anchor="end"
            fill="var(--text-dim)" font-family="JetBrains Mono" font-size="9">0%</text>

      <!-- x-axis labels -->
      ${days.map((d, i) => {
        const x = PAD.left + i * stepX;
        return `<text x="${x}" y="${H - 10}" text-anchor="middle"
                      fill="var(--text-dim)" font-family="JetBrains Mono" font-size="9">${d.date.toLocaleDateString('en-US', { weekday: 'narrow' })}</text>`;
      }).join('')}

      <!-- lines -->
      <path d="${pathFor('cal', calT)}" fill="none" stroke="var(--cal)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${pathFor('pro', proT)}" fill="none" stroke="var(--pro)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${pathFor('fib', fibT)}" fill="none" stroke="var(--fib)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>

      <!-- points -->
      ${days.map((d, i) => {
        const x = PAD.left + i * stepX;
        const t = sumMacros(d.entries);
        if (!d.entries.length) return '';
        const dot = (key, target, color) => {
          if (!target) return '';
          const y = PAD.top + innerH * (1 - Math.min(ymax, t[key]/target) / ymax);
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${color}"/>`;
        };
        return dot('cal', calT, 'var(--cal)') + dot('pro', proT, 'var(--pro)') + dot('fib', fibT, 'var(--fib)');
      }).join('')}
    </svg>
  </div>
`;
}

/* ============ MONTH VIEW ============ */
function renderMonth() {
const { start, end, days } = entriesForMonth(state.selectedMonth);
$('#month-title').innerHTML = `${fmtMonth(start)} <em>· month</em>`;

const { cal, pro, fib } = activeTargets();
const allEntries = days.flatMap(d => d.entries);
const totals = sumMacros(allEntries);
const daysLogged = days.filter(d => d.entries.length > 0).length;
const avg = daysLogged > 0 ? {
  cal: totals.cal / daysLogged,
  pro: totals.pro / daysLogged,
  fib: totals.fib / daysLogged
} : { cal: 0, pro: 0, fib: 0 };

const daysHitPro = days.filter(d => sumMacros(d.entries).pro >= pro).length;
const daysHitFib = days.filter(d => sumMacros(d.entries).fib >= fib).length;
const daysHitBoth = days.filter(d => {
  const t = sumMacros(d.entries);
  return t.pro >= pro && t.fib >= fib;
}).length;

// Build calendar grid: pad to start on Monday
const firstDayOfWeek = start.getDay(); // 0=Sun..6=Sat
const leadingBlanks = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
const today = new Date();

const cells = [];
for (let i = 0; i < leadingBlanks; i++) cells.push({ blank: true });
days.forEach(d => cells.push({ day: d }));
// pad trailing to multiple of 7
while (cells.length % 7 !== 0) cells.push({ blank: true });

const heatCell = (cell) => {
  if (cell.blank) return `<div class="heat-cell empty"></div>`;
  const d = cell.day;
  const t = sumMacros(d.entries);
  const isToday = sameDay(d.date, today);
  const isFuture = d.date > today;
  if (isFuture) {
    return `<div class="heat-cell future"><div class="heat-num">${d.date.getDate()}</div></div>`;
  }
  const proPct = pro ? Math.min(1, t.pro / pro) : 0;
  const fibPct = fib ? Math.min(1, t.fib / fib) : 0;
  const calPct = cal ? Math.min(1, t.cal / cal) : 0;
  const intensity = d.entries.length ? 0.15 + 0.55 * ((proPct + fibPct) / 2) : 0;
  const bg = d.entries.length
    ? `rgba(232, 160, 62, ${intensity.toFixed(2)})`
    : `transparent`;
  return `
    <div class="heat-cell ${isToday ? 'today' : ''}" style="background:${bg};" data-date="${d.date.toISOString()}">
      <div class="heat-num">${d.date.getDate()}</div>
      <div class="heat-bars">
        <div class="hb"><div class="hb-fill" style="width:${(calPct*100).toFixed(0)}%; background: var(--cal);"></div></div>
        <div class="hb"><div class="hb-fill" style="width:${(proPct*100).toFixed(0)}%; background: var(--pro);"></div></div>
        <div class="hb"><div class="hb-fill" style="width:${(fibPct*100).toFixed(0)}%; background: var(--fib);"></div></div>
      </div>
      ${d.entries.length ? `
        <div class="tooltip">
          ${fmtDateShort(d.date)} · ${d.entries.length} entries<br>
          ${Math.round(t.cal)} kcal / ${t.pro.toFixed(1)}g pro / ${t.fib.toFixed(1)}g fib
        </div>` : ''}
    </div>
  `;
};

const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

$('#month-content').innerHTML = `
  <div class="chart-card">
    <div class="chart-title">Month at a glance</div>
    <div class="chart-sub">${daysLogged} days logged · <em>${daysHitBoth} days hit both protein &amp; fiber targets</em></div>
    <div class="heatmap">
      ${dayLabels.map(l => `<div class="heat-head">${l}</div>`).join('')}
      ${cells.map(heatCell).join('')}
    </div>
    <div class="legend">
      <div class="lg-item"><span class="lg-sw cal"></span>Calories vs target</div>
      <div class="lg-item"><span class="lg-sw pro"></span>Protein vs target</div>
      <div class="lg-item"><span class="lg-sw fib"></span>Fiber vs target</div>
    </div>
  </div>

  <div class="chart-card">
    <div class="chart-title">Month summary</div>
    <div class="chart-sub">Averages across <em>${daysLogged} logged day${daysLogged === 1 ? '' : 's'}</em></div>
    <div class="week-summary">
      <div class="sum-cell cal">
        <div class="l">Avg daily · calories</div>
        <div class="v">${Math.round(avg.cal)}<span class="unit">kcal</span></div>
      </div>
      <div class="sum-cell pro">
        <div class="l">Avg daily · protein</div>
        <div class="v">${avg.pro.toFixed(1)}<span class="unit">g</span></div>
      </div>
      <div class="sum-cell fib">
        <div class="l">Avg daily · fiber</div>
        <div class="v">${avg.fib.toFixed(1)}<span class="unit">g</span></div>
      </div>
    </div>
    <div class="week-summary" style="margin-top:10px;">
      <div class="sum-cell">
        <div class="l">Days logged</div>
        <div class="v">${daysLogged}<span class="unit">/ ${days.length}</span></div>
      </div>
      <div class="sum-cell pro">
        <div class="l">Days hit protein</div>
        <div class="v">${daysHitPro}<span class="unit">/ ${daysLogged || 0}</span></div>
      </div>
      <div class="sum-cell fib">
        <div class="l">Days hit fiber</div>
        <div class="v">${daysHitFib}<span class="unit">/ ${daysLogged || 0}</span></div>
      </div>
    </div>
  </div>
`;

// Make heatmap cells navigate to that day
$$('#month-content .heat-cell[data-date]').forEach(cell => {
  cell.addEventListener('click', () => {
    state.selectedDate = new Date(cell.dataset.date);
    showTab('today');
  });
});
}

/* ============ ALL ENTRIES VIEW ============ */
function renderAllEntries() {
const all = state.log.entries
  .slice()
  .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

if (!all.length) {
  $('#all-content').innerHTML = `
    <div class="empty-state">
      <h3>No entries logged yet.</h3>
      <p>Start by adding your first meal using the form above.</p>
    </div>
  `;
  return;
}

// Group by date
const byDay = {};
all.forEach(e => {
  const day = startOfDay(new Date(e.timestamp)).toISOString();
  if (!byDay[day]) byDay[day] = [];
  byDay[day].push(e);
});

const html = Object.keys(byDay).sort((a, b) => new Date(b) - new Date(a)).map(day => {
  const list = byDay[day];
  const sub = sumMacros(list);
  const d = new Date(day);
  return `
    <div class="meal-group">
      <div class="meal-header">
        <div class="meal-name">${fmtDate(d)}</div>
        <div class="meal-subtotal">
          <span class="m-cal">${Math.round(sub.cal)} kcal</span><span class="dot">·</span>
          <span class="m-pro">${sub.pro.toFixed(1)}g pro</span><span class="dot">·</span>
          <span class="m-fib">${sub.fib.toFixed(1)}g fib</span><span class="dot">·</span>
          <span>${list.length} entries</span>
        </div>
      </div>
      <div class="entries">
        ${list.map(e => entryRow(e)).join('')}
      </div>
    </div>
  `;
}).join('');

$('#all-content').innerHTML = `
  <div class="chart-card">
    <div class="chart-title">Total logged</div>
    <div class="chart-sub">${all.length} entries across ${Object.keys(byDay).length} days</div>
  </div>
  ${html}
`;

// Wire delete
$('#all-content').querySelectorAll('.entry-delete').forEach(btn => {
  btn.addEventListener('click', () => deleteEntry(btn.dataset.id));
});
}

/* ============ WEIGHT ============ */
const KG_PER_LB = 0.45359237;
const LB_PER_KG = 1 / KG_PER_LB;

// All weights stored canonically in lbs. Convert on display only.
const toLbs       = (v, unit) => unit === 'kg' ? v * LB_PER_KG : v;
const fromLbs     = (v, unit) => unit === 'kg' ? v * KG_PER_LB : v;
const fmtW        = (lbs, unit) => fromLbs(lbs, unit).toFixed(1);

function syncWeightUI() {
const ws = activeWS();
// Active unit button
$$('.unit-btn').forEach(b => b.classList.toggle('active', b.dataset.unit === ws.unit));
// Unit label on input
$('#wf-unit-label').textContent = ws.unit;
// Goal field — display in current unit
$('#wf-goal').value = ws.goal != null ? fromLbs(ws.goal, ws.unit).toFixed(1) : '';
// Period buttons
$$('.period-btn').forEach(b => {
  const p = b.dataset.period === 'all' ? 'all' : Number(b.dataset.period);
  b.classList.toggle('active', p === state.weightPeriod);
});
}

function onAddWeight(e) {
e.preventDefault();
const timeStr = $('#wf-time').value;
const inputV  = Number($('#wf-value').value);
const notes   = $('#wf-notes').value.trim();
if (!timeStr || !inputV || inputV <= 0) return;

const ws = activeWS();
const entry = {
  id:        uid(),
  personId:  state.activePersonId,
  timestamp: new Date(timeStr).toISOString(),
  value:     toLbs(inputV, ws.unit),    // canonical lbs
  notes
};
state.log.weights.push(entry);
Storage.saveAll(state.log);

// Reset form
$('#wf-value').value = '';
$('#wf-notes').value = '';
$('#wf-time').value  = toLocalDatetimeInput(new Date());

renderWeight();
renderInsights();
renderToday();
renderPlan();
toast(`Weight logged: ${fmtW(entry.value, ws.unit)} ${ws.unit}`, 'success');
}

function deleteWeight(id) {
if (!confirm('Delete this weight entry?')) return;
state.log.weights = state.log.weights.filter(w => w.id !== id);
Storage.saveAll(state.log);
renderWeight();
toast('Weight entry deleted', 'success');
}

/* ============ EXERCISE: data, math, UI ============ */

// Common activities with MET values (Compendium of Physical Activities, Ainsworth et al.)
// Used to estimate calories burned when the user doesn't have a wearable reading.
const ACTIVITIES = [
{ name: 'Walking (slow)',           met: 2.8 },
{ name: 'Walking (moderate)',       met: 3.5 },
{ name: 'Walking (brisk)',          met: 5.0 },
{ name: 'Running (jogging)',        met: 7.0 },
{ name: 'Running (6 mph)',          met: 9.8 },
{ name: 'Running (8 mph)',          met: 13.5 },
{ name: 'Cycling (leisurely)',      met: 4.0 },
{ name: 'Cycling (moderate)',       met: 8.0 },
{ name: 'Cycling (vigorous)',       met: 10.0 },
{ name: 'Swimming (laps)',          met: 8.0 },
{ name: 'Weight training (light)',  met: 3.5 },
{ name: 'Weight training (heavy)',  met: 6.0 },
{ name: 'Yoga (hatha)',             met: 2.5 },
{ name: 'Yoga (power / vinyasa)',   met: 4.0 },
{ name: 'Pilates',                  met: 3.0 },
{ name: 'HIIT',                     met: 8.0 },
{ name: 'Elliptical (moderate)',    met: 5.0 },
{ name: 'Elliptical (vigorous)',    met: 9.0 },
{ name: 'Rowing (moderate)',        met: 7.0 },
{ name: 'Stair climbing',           met: 8.8 },
{ name: 'Hiking',                   met: 6.0 },
{ name: 'Basketball (game)',        met: 8.0 },
{ name: 'Tennis (singles)',         met: 8.0 },
{ name: 'Soccer',                   met: 7.0 },
{ name: 'Dancing',                  met: 5.0 },
{ name: 'Boxing (bag)',             met: 5.5 }
];

function estimateKcalFromMET(activityName, durationMin, weightKg) {
if (!activityName || !durationMin || !weightKg) return null;
const lookup = activityName.toLowerCase().trim();
const match = ACTIVITIES.find(a => a.name.toLowerCase() === lookup) ||
              ACTIVITIES.find(a => lookup.includes(a.name.toLowerCase().split(' ')[0]));
if (!match) return null;
// kcal = MET × weight_kg × hours
return Math.round(match.met * weightKg * (durationMin / 60));
}

function exerciseSuggest(query) {
if (!query) return [];
const q = query.toLowerCase().trim();
return ACTIVITIES
  .filter(a => a.name.toLowerCase().includes(q))
  .slice(0, 6);
}

function onAddExercise(e) {
e.preventDefault();
const p = activePerson();
if (!p) { toast('Add a person first', 'error'); return; }

const time     = $('#xf-time').value;
const activity = $('#xf-activity').value.trim();
const duration = parseInt($('#xf-duration').value);
const kcal     = parseInt($('#xf-kcal').value);
const notes    = $('#xf-notes').value.trim();

if (!time || !activity || !duration || isNaN(kcal)) {
  toast('Please fill in all fields', 'error');
  return;
}
if (kcal < 0) {
  toast('Calories burned must be positive', 'error');
  return;
}

const ex = {
  id: uid(),
  personId: p.id,
  timestamp: new Date(time).toISOString(),
  activity,
  durationMin: duration,
  kcal,
  notes
};

state.log.exercises = state.log.exercises || [];
state.log.exercises.push(ex);
Storage.saveAll(state.log);

// Reset form (preserve activity for streaks)
$('#xf-duration').value = '';
$('#xf-kcal').value     = '';
$('#xf-notes').value    = '';
$('#xf-time').value     = toLocalDatetimeInput(new Date());

renderExercise();
renderToday();      // deficit changes
renderHeaderRings();
renderInsights();   // deficit math updates
renderWeek();
renderMonth();
renderPlan();
toast(`Logged: ${activity} · ${kcal} kcal burned`, 'success');
}

function deleteExercise(id) {
if (!confirm('Delete this exercise session?')) return;
state.log.exercises = state.log.exercises.filter(x => x.id !== id);
Storage.saveAll(state.log);
renderExercise();
renderToday();
renderHeaderRings();
renderInsights();
renderWeek();
renderMonth();
toast('Session deleted', 'success');
}

function onExerciseInput() {
const val = $('#xf-activity').value;
const suggestions = exerciseSuggest(val);
const list = $('#xf-suggest');
if (!suggestions.length) {
  list.hidden = true;
  list.innerHTML = '';
  return;
}
list.innerHTML = suggestions.map(s => `
  <div class="suggest-item" data-name="${escapeHtml(s.name)}" data-met="${s.met}">
    <span class="si-name">${escapeHtml(s.name)}</span>
    <span class="si-meta">${s.met} MET</span>
  </div>
`).join('');
list.hidden = false;
}

function pickActivity(name) {
$('#xf-activity').value = name;
$('#xf-suggest').hidden = true;
$('#xf-suggest').innerHTML = '';
$('#xf-duration').focus();
}

function onEstimateKcal() {
const activity = $('#xf-activity').value.trim();
const duration = parseInt($('#xf-duration').value);
const p = activePerson();
const latestLbs = p ? latestWeightLbs(p.id) : null;
const weightKg = latestLbs != null ? latestLbs * 0.45359237 : null;

if (!activity)  { toast('Enter an activity first', 'error'); return; }
if (!duration)  { toast('Enter duration in minutes', 'error'); return; }
if (!weightKg)  { toast('Log a weight first — estimate needs your weight', 'error'); return; }

const est = estimateKcalFromMET(activity, duration, weightKg);
if (est == null) {
  toast('Activity not recognized — enter calories manually', 'error');
  return;
}
$('#xf-kcal').value = est;
toast(`Estimated: ${est} kcal · adjust if needed`, 'success');
}

function renderExercise() {
const content = $('#exercise-content');
if (!content) return;
const p = activePerson();
if (!p) { content.innerHTML = ''; return; }

// Default the time picker to now
if ($('#xf-time') && !$('#xf-time').value) {
  $('#xf-time').value = toLocalDatetimeInput(new Date());
}

const today = new Date();
const exs = activeExercises();

// Stats: today, week, month, all-time
const burnedToday   = exerciseKcalForDay(today);
const burned7day    = sumWindowBurned(7);
const burned30day   = sumWindowBurned(30);
const totalSessions = exs.length;

let html = `
  <div class="ex-stats">
    <div class="ex-stat hero">
      <div class="es-label">Today</div>
      <div class="es-value">${burnedToday}<span class="es-unit">kcal</span></div>
      <div class="es-sub">${countExForDay(today)} session${countExForDay(today) === 1 ? '' : 's'}</div>
    </div>
    <div class="ex-stat">
      <div class="es-label">7-day total</div>
      <div class="es-value">${burned7day.toLocaleString()}<span class="es-unit">kcal</span></div>
      <div class="es-sub">avg ${Math.round(burned7day / 7)} / day</div>
    </div>
    <div class="ex-stat">
      <div class="es-label">30-day total</div>
      <div class="es-value">${burned30day.toLocaleString()}<span class="es-unit">kcal</span></div>
      <div class="es-sub">avg ${Math.round(burned30day / 30)} / day</div>
    </div>
    <div class="ex-stat">
      <div class="es-label">Sessions logged</div>
      <div class="es-value">${totalSessions}</div>
      <div class="es-sub">all-time</div>
    </div>
  </div>
`;

// Period chart based on currently-selected period
const period = state.exercisePeriod || 30;
html += `
  <div class="ex-chart-wrap">
    <div class="chart-title">Calories burned · ${period === 'all' ? 'all time' : 'last ' + period + ' days'}</div>
    <div class="chart-subtitle">Each bar is a day · bar height is total kcal burned that day</div>
    ${renderExerciseChart(period)}
  </div>
`;

// List of recent exercises grouped by day
const sorted = exs.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
if (sorted.length === 0) {
  html += `<div class="ex-chart-empty">No sessions logged yet · use the form above to add your first one</div>`;
} else {
  const byDay = {};
  sorted.forEach(x => {
    const key = startOfDay(new Date(x.timestamp)).toISOString();
    (byDay[key] = byDay[key] || []).push(x);
  });
  const dayKeys = Object.keys(byDay).sort((a, b) => b.localeCompare(a)).slice(0, 21);
  html += `<div class="exercise-list">`;
  html += dayKeys.map(dayKey => {
    const date = new Date(dayKey);
    const day = byDay[dayKey];
    const totalKcal = day.reduce((s, x) => s + (Number(x.kcal) || 0), 0);
    const dateLabel = sameDay(date, new Date())
      ? 'Today'
      : sameDay(date, new Date(Date.now() - 86400000))
        ? 'Yesterday'
        : date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    return `
      <div class="day-group">
        <div class="day-header">
          <span>${dateLabel}</span>
          <span class="dh-burned">+${totalKcal.toLocaleString()} kcal · ${day.length} session${day.length === 1 ? '' : 's'}</span>
        </div>
        ${day.map(x => {
          const time = new Date(x.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          return `
            <div class="ex-entry">
              <div class="xe-time">${time}</div>
              <div class="xe-activity">${escapeHtml(x.activity)}${x.notes ? `<span class="xe-notes">${escapeHtml(x.notes)}</span>` : ''}</div>
              <div class="xe-duration">${x.durationMin} min</div>
              <div class="xe-kcal">${x.kcal} kcal</div>
              <button class="xe-delete" data-ex-id="${x.id}" title="Delete">✕</button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');
  html += `</div>`;
}

content.innerHTML = html;

// Wire delete buttons
content.querySelectorAll('.xe-delete').forEach(btn => {
  btn.addEventListener('click', () => deleteExercise(btn.dataset.exId));
});
}

function countExForDay(date) {
return activeExercises().filter(x => sameDay(new Date(x.timestamp), date)).length;
}

function sumWindowBurned(days) {
if (days === 'all') {
  return activeExercises().reduce((s, x) => s + (Number(x.kcal) || 0), 0);
}
const cutoff = startOfDay(new Date(Date.now() - (days - 1) * 86400000));
return activeExercises()
  .filter(x => new Date(x.timestamp) >= cutoff)
  .reduce((s, x) => s + (Number(x.kcal) || 0), 0);
}

function renderExerciseChart(period) {
const exs = activeExercises();
if (!exs.length) {
  return `<div class="ex-chart-empty">Log a session to see the trend</div>`;
}

// Determine date range
let startDate, endDate;
endDate = startOfDay(new Date());
if (period === 'all') {
  const earliest = exs.reduce((min, x) => {
    const t = new Date(x.timestamp);
    return t < min ? t : min;
  }, new Date());
  startDate = startOfDay(earliest);
} else {
  startDate = startOfDay(new Date(Date.now() - (period - 1) * 86400000));
}

// Bucket kcal by day
const days = [];
const cursor = new Date(startDate);
while (cursor <= endDate) {
  days.push({ date: new Date(cursor), kcal: 0 });
  cursor.setDate(cursor.getDate() + 1);
}
exs.forEach(x => {
  const t = startOfDay(new Date(x.timestamp));
  const day = days.find(d => sameDay(d.date, t));
  if (day) day.kcal += Number(x.kcal) || 0;
});

const maxK = Math.max(...days.map(d => d.kcal), 100);
const W = 700, H = 220;
const padL = 44, padR = 14, padT = 18, padB = 36;
const plotW = W - padL - padR, plotH = H - padT - padB;
const barW = Math.max(2, (plotW / days.length) - 2);

// Y-axis gridlines (4)
const ySteps = 4;
const yLines = [];
for (let i = 0; i <= ySteps; i++) {
  const v = (maxK / ySteps) * i;
  const y = padT + plotH - (v / maxK) * plotH;
  yLines.push({ y, value: Math.round(v) });
}

// X-axis labels (every ~7 days)
const xLabelEvery = Math.max(1, Math.floor(days.length / 6));
const xLabels = [];
days.forEach((d, i) => {
  if (i % xLabelEvery === 0 || i === days.length - 1) {
    const x = padL + (i * (plotW / days.length)) + barW / 2;
    xLabels.push({ x, label: d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
  }
});

return `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto;">
    ${yLines.map(l => `
      <line x1="${padL}" y1="${l.y}" x2="${W - padR}" y2="${l.y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="2,3" />
      <text x="${padL - 8}" y="${l.y + 3}" font-family="JetBrains Mono, monospace" font-size="10" fill="var(--text-dim)" text-anchor="end">${l.value}</text>
    `).join('')}
    ${days.map((d, i) => {
      const x = padL + (i * (plotW / days.length));
      const h = (d.kcal / maxK) * plotH;
      const y = padT + plotH - h;
      if (d.kcal === 0) return '';
      return `
        <rect x="${x}" y="${y}" width="${barW}" height="${h}"
              fill="var(--accent)" opacity="0.85" rx="1">
          <title>${d.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.kcal} kcal</title>
        </rect>
      `;
    }).join('')}
    ${xLabels.map(l => `
      <text x="${l.x}" y="${H - 8}" font-family="JetBrains Mono, monospace" font-size="10" fill="var(--text-dim)" text-anchor="middle">${l.label}</text>
    `).join('')}
  </svg>
`;
}

function renderWeight() {
const ws    = activeWS();
const unit  = ws.unit;
const goal  = ws.goal;                  // in lbs
const sorted = activeWeights().slice()
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

syncWeightUI();

const content = $('#weight-content');
if (!sorted.length) {
  content.innerHTML = `
    <div class="empty-state">
      <h3>No weight entries yet.</h3>
      <p>Use the form above to log your first weight reading. The trend chart appears once you have at least two entries.</p>
    </div>
  `;
  return;
}

// Stats
const latest = sorted[sorted.length - 1];
const first  = sorted[0];
const totalDelta = latest.value - first.value;

// Find an entry from ~7 days ago for week-over-week change
const sevenDaysAgo = Date.now() - 7 * 86400000;
const priorWeek = sorted.filter(w => new Date(w.timestamp).getTime() <= sevenDaysAgo).pop();
const weekDelta = priorWeek ? latest.value - priorWeek.value : null;

const goalDelta = (goal != null) ? latest.value - goal : null;

const deltaSpan = (deltaLbs) => {
  if (deltaLbs == null) return `<span class="delta zero">—</span>`;
  const v = Math.abs(fromLbs(deltaLbs, unit)).toFixed(1);
  if (Math.abs(deltaLbs) < 0.05) return `<span class="delta zero"><span class="arrow">●</span> 0.0 ${unit}</span>`;
  if (deltaLbs < 0) return `<span class="delta down"><span class="arrow">▼</span> ${v} ${unit}</span>`;
  return `<span class="delta up"><span class="arrow">▲</span> ${v} ${unit}</span>`;
};

const since = new Date(first.timestamp);
const sinceLabel = since.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Hero stats
const heroHtml = `
  <div class="weight-hero">
    <div class="weight-stat hero">
      <div class="ws-label">Current</div>
      <div class="ws-value">${fmtW(latest.value, unit)}<span class="unit">${unit}</span></div>
      <div class="ws-sub">last logged ${new Date(latest.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
    </div>
    <div class="weight-stat">
      <div class="ws-label">Since start</div>
      <div class="ws-value">${deltaSpan(totalDelta)}</div>
      <div class="ws-sub">from ${fmtW(first.value, unit)} ${unit} on ${sinceLabel}</div>
    </div>
    <div class="weight-stat">
      <div class="ws-label">7-day change</div>
      <div class="ws-value">${deltaSpan(weekDelta)}</div>
      <div class="ws-sub">${priorWeek ? 'vs ' + new Date(priorWeek.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'need older entry'}</div>
    </div>
    <div class="weight-stat">
      <div class="ws-label">To goal</div>
      <div class="ws-value">${goal != null ? deltaSpan(goalDelta) : '<span class="delta zero">—</span>'}</div>
      <div class="ws-sub">${goal != null ? 'target ' + fmtW(goal, unit) + ' ' + unit : 'set a goal above'}</div>
    </div>
  </div>
`;

// Filter by period for chart
let chartData = sorted;
if (state.weightPeriod !== 'all') {
  const cutoff = Date.now() - Number(state.weightPeriod) * 86400000;
  chartData = sorted.filter(w => new Date(w.timestamp).getTime() >= cutoff);
}

// Render
content.innerHTML = `
  ${heroHtml}
  <div class="chart-card weight-chart">
    <div class="chart-title">Trend · ${state.weightPeriod === 'all' ? 'all time' : 'last ' + state.weightPeriod + ' days'}</div>
    <div class="chart-sub">${chartData.length} entr${chartData.length === 1 ? 'y' : 'ies'} <em>in selected range</em></div>
    <div class="weight-chart-wrap">
      ${weightChartSVG(chartData, unit, goal)}
    </div>
  </div>

  <div class="chart-card">
    <div class="chart-title">History</div>
    <div class="chart-sub">${sorted.length} total entr${sorted.length === 1 ? 'y' : 'ies'} <em>· newest first</em></div>
    <div class="weight-list entries" id="weight-list-rows">
      ${sorted.slice().reverse().map(w => weightRow(w, unit)).join('')}
    </div>
  </div>
`;

// Wire delete
content.querySelectorAll('.entry-delete').forEach(btn => {
  btn.addEventListener('click', () => deleteWeight(btn.dataset.id));
});
}

function weightRow(w, unit) {
const t = new Date(w.timestamp);
const dateStr = t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
const timeStr = fmtTime(t);
return `
  <div class="entry">
    <div class="we-time">${dateStr}<br>${timeStr}</div>
    <div class="we-value">${fmtW(w.value, unit)} <span style="font-size:11px;color:var(--text-dim);">${unit}</span></div>
    <div class="we-notes">${escapeHtml(w.notes || '')}</div>
    <div></div>
    <button class="entry-delete" data-id="${w.id}" title="Delete">×</button>
  </div>
`;
}

function weightChartSVG(data, unit, goalLbs) {
if (data.length === 0) {
  return `<div style="text-align:center; padding:60px 20px; color:var(--text-dim); font-size:13px;">No entries in this range. Pick a longer period.</div>`;
}
if (data.length === 1) {
  return `<div style="text-align:center; padding:60px 20px; color:var(--text-dim); font-size:13px;">Need at least 2 entries to draw a trend. Log another reading.</div>`;
}

const W = 800, H = 280;
const PAD = { top: 20, right: 20, bottom: 36, left: 56 };
const innerW = W - PAD.left - PAD.right;
const innerH = H - PAD.top  - PAD.bottom;

const values = data.map(d => fromLbs(d.value, unit));
const times  = data.map(d => new Date(d.timestamp).getTime());
let vmin = Math.min(...values);
let vmax = Math.max(...values);
if (goalLbs != null) {
  const g = fromLbs(goalLbs, unit);
  vmin = Math.min(vmin, g);
  vmax = Math.max(vmax, g);
}
// pad y range, round to nearest 1
const range = Math.max(vmax - vmin, 2);
const pad = range * 0.15;
vmin = Math.floor(vmin - pad);
vmax = Math.ceil(vmax + pad);

const tmin = times[0];
const tmax = times[times.length - 1];
const tspan = Math.max(tmax - tmin, 1);

const x = t => PAD.left + ((t - tmin) / tspan) * innerW;
const y = v => PAD.top  + (1 - (v - vmin) / (vmax - vmin)) * innerH;

// Path for line
const path = data.map((d, i) => {
  const px = x(times[i]);
  const py = y(values[i]);
  return (i === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1);
}).join(' ');

// Area path (fill under line)
const areaPath = path + ` L${x(tmax).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${x(tmin).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;

// Y axis ticks (4-5 lines)
const tickCount = 5;
const yTicks = [];
for (let i = 0; i <= tickCount; i++) {
  const v = vmin + (vmax - vmin) * (i / tickCount);
  yTicks.push({ value: v, y: y(v) });
}

// X axis ticks (~5 evenly spaced, labeled with dates)
const xTickCount = Math.min(6, data.length);
const xTicks = [];
for (let i = 0; i < xTickCount; i++) {
  const t = tmin + (tspan * i) / (xTickCount - 1);
  xTicks.push({ time: t, x: x(t) });
}

const goalDisplay = goalLbs != null ? fromLbs(goalLbs, unit) : null;
const goalY = goalDisplay != null ? y(goalDisplay) : null;

// Trend direction for line color: down = good (green-ish), up = warning
const trend = values[values.length - 1] - values[0];
const lineColor = Math.abs(trend) < 0.1 ? 'var(--accent)' : (trend < 0 ? 'var(--success)' : 'var(--danger)');

return `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="weight-area" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%"  stop-color="${lineColor}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${lineColor}" stop-opacity="0.0"/>
      </linearGradient>
    </defs>

    <!-- horizontal grid -->
    ${yTicks.map(t => `
      <line x1="${PAD.left}" y1="${t.y.toFixed(1)}" x2="${W - PAD.right}" y2="${t.y.toFixed(1)}"
            stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
      <text x="${PAD.left - 8}" y="${(t.y + 3).toFixed(1)}" text-anchor="end"
            fill="var(--text-dim)" font-size="10">${t.value.toFixed(1)}</text>
    `).join('')}

    <!-- y-axis label -->
    <text x="${PAD.left - 40}" y="${(PAD.top + innerH/2).toFixed(1)}"
          fill="var(--text-dim)" font-size="9" text-anchor="middle"
          transform="rotate(-90 ${PAD.left - 40} ${(PAD.top + innerH/2).toFixed(1)})">${unit}</text>

    <!-- goal line -->
    ${goalY != null ? `
      <line x1="${PAD.left}" y1="${goalY.toFixed(1)}" x2="${W - PAD.right}" y2="${goalY.toFixed(1)}"
            stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="6,5" opacity="0.7"/>
      <text x="${W - PAD.right - 4}" y="${(goalY - 6).toFixed(1)}" text-anchor="end"
            fill="var(--gold)" font-size="10">goal · ${goalDisplay.toFixed(1)}</text>
    ` : ''}

    <!-- area under curve -->
    <path d="${areaPath}" fill="url(#weight-area)"/>

    <!-- trend line -->
    <path d="${path}" fill="none" stroke="${lineColor}" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round"/>

    <!-- data points (interactive) -->
    ${data.map((d, i) => {
      const px = x(times[i]).toFixed(1);
      const py = y(values[i]).toFixed(1);
      const dateStr = new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `
        <g class="data-point" data-tip="${dateStr} · ${values[i].toFixed(1)} ${unit}${d.notes ? ' · ' + escapeHtml(d.notes) : ''}">
          <circle cx="${px}" cy="${py}" r="10" fill="transparent"/>
          <circle cx="${px}" cy="${py}" r="3.5" fill="${lineColor}" stroke="var(--bg)" stroke-width="2"/>
        </g>
      `;
    }).join('')}

    <!-- x-axis labels -->
    ${xTicks.map(t => {
      const d = new Date(t.time);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<text x="${t.x.toFixed(1)}" y="${H - 12}" text-anchor="middle"
                    fill="var(--text-dim)" font-size="10">${label}</text>`;
    }).join('')}
  </svg>
`;
}


function showTab(tabKey) {
state.view = tabKey;
$$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabKey));
$$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tabKey));
// Re-render relevant view to re-trigger animations
if (tabKey === 'today')    renderToday();
if (tabKey === 'week')     renderWeek();
if (tabKey === 'month')    renderMonth();
if (tabKey === 'plan')     renderPlan();
if (tabKey === 'insights') renderInsights();
if (tabKey === 'weight')   renderWeight();
if (tabKey === 'exercise') renderExercise();
if (tabKey === 'all')      renderAllEntries();
if (tabKey === 'family')   renderFamily();
}

/* ============ INSIGHTS TAB — the math, exposed ============ */
function renderInsights() {
const content = $('#insights-content');
if (!content) return;
const p = activePerson();
if (!p) { content.innerHTML = ''; return; }

const prof = p.profile || {};
const ws   = p.weightSettings || { unit: 'lbs', goal: null };
const lbs  = latestWeightLbs(p.id);
const kg   = lbs != null ? lbs * 0.45359237 : null;
const bmr  = calcBMR(prof, kg);
const tdee = calcTDEE(bmr, prof.activityLevel);

const todayEntries = entriesForDay(new Date());
const todayKcal = sumMacros(todayEntries).cal;
const todayBurned = exerciseKcalForDay(new Date());
const todayDeficit = tdee != null ? (tdee - todayKcal) + todayBurned : null;
const cumDeficit = cumulativeDeficit();

// ----- INTRO -----
let html = `
  <div class="insight-intro">
    <h3>Why <em>show the math?</em></h3>
    <p>Every number on this page comes from a specific equation with your specific data. Hiding that is fine when the math is opaque. When it's straightforward — and most of it is just arithmetic — it's more useful to see it. You'll know whether to trust the prediction, what would change it, and where the uncertainty lives.</p>
    <p style="margin-top: 12px;">Every section below shows the formula in the abstract, then the same formula with your numbers plugged in, then the answer. Some sections won't have your numbers yet — fill in your profile in <strong style="color: var(--accent)">Plan</strong> and log a weight to unlock them.</p>
  </div>
`;

// ----- CARD 1: BMR -----
const eqGeneric = (gender) =>
  gender === 'female'
    ? `BMR <span class="op">=</span> (10 <span class="op">×</span> <span class="var">weight</span><sub>kg</sub>) <span class="op">+</span> (6.25 <span class="op">×</span> <span class="var">height</span><sub>cm</sub>) <span class="op">−</span> (5 <span class="op">×</span> <span class="var">age</span>) <span class="op">−</span> 161`
    : `BMR <span class="op">=</span> (10 <span class="op">×</span> <span class="var">weight</span><sub>kg</sub>) <span class="op">+</span> (6.25 <span class="op">×</span> <span class="var">height</span><sub>cm</sub>) <span class="op">−</span> (5 <span class="op">×</span> <span class="var">age</span>) <span class="op">+</span> 5`;

html += `
  <div class="insight-card">
    <div class="insight-eyebrow">01 · The foundation</div>
    <h3>What is <em>BMR?</em></h3>
    <p class="insight-explainer"><strong>Basal Metabolic Rate</strong> is the energy your body uses at complete rest — heart beating, brain thinking, lungs breathing, cells dividing, body temperature maintained. It's not what you burn from exercise; it's what you burn from being alive. For most sedentary adults, BMR accounts for <strong>60–75% of total daily calorie burn</strong>.</p>
    <p class="insight-explainer">We use the <strong>Mifflin–St Jeor equation</strong>, published in 1990 by Dr. Mark Mifflin and Dr. Sachiko St Jeor in the <em>American Journal of Clinical Nutrition</em>. It replaced the older Harris–Benedict formula (1919) because it's measurably more accurate for modern populations, particularly people who are overweight. The Academy of Nutrition and Dietetics recognizes it as the most reliable predictive BMR equation in routine use.</p>

    <div class="insight-formula">
      <div class="formula-label">Mifflin–St Jeor · ${prof.gender === 'female' ? 'female' : 'male'} variant</div>
      <div class="formula-eq">${eqGeneric(prof.gender)}</div>
    </div>
`;

if (bmr != null) {
  const heightIn = (prof.heightCm / 2.54);
  const wKg = kg.toFixed(1);
  const sign = prof.gender === 'female' ? '−' : '+';
  const constant = prof.gender === 'female' ? '161' : '5';
  const term1 = 10 * kg;
  const term2 = 6.25 * prof.heightCm;
  const term3 = 5 * prof.age;
  html += `
    <div class="insight-plugin">
      <div class="plugin-label">For you · ${escapeHtml(p.name)}</div>
      <div class="plugin-eq">BMR = (10 × ${wKg}) + (6.25 × ${prof.heightCm}) − (5 × ${prof.age}) ${sign} ${constant}</div>
      <div class="plugin-eq">    = ${term1.toFixed(1)} + ${term2.toFixed(1)} − ${term3} ${sign} ${constant}</div>
      <div class="plugin-result">= <strong>${Math.round(bmr).toLocaleString()} kcal / day</strong></div>
    </div>
    <p class="insight-note">Weight ${wKg} kg comes from your latest log entry (${(lbs).toFixed(1)} ${ws.unit === 'lbs' ? 'lbs' : 'lbs canonical, ' + fromLbs(lbs, 'kg').toFixed(1) + ' kg'}). If you log a fresh weight, every number on this page updates.</p>
  `;
} else {
  html += `
    <div class="insight-locked">
      Plug-in math will appear here once you've set <strong>gender, age, and height</strong> in Plan and logged at least one <strong>weight</strong> entry.
    </div>
  `;
}

html += `</div>`;

// ----- CARD 2: TDEE -----
const activeAct = ACTIVITY_LEVELS[prof.activityLevel] || ACTIVITY_LEVELS.moderate;
const multTable = Object.entries(ACTIVITY_LEVELS).map(([key, a]) => {
  const tdeeIfThis = bmr != null ? Math.round(bmr * a.mult).toLocaleString() + ' kcal' : '—';
  return `
    <div class="multiplier-row ${key === prof.activityLevel ? 'active' : ''}">
      <div class="mr-name">${escapeHtml(a.label)}<span class="mr-sub">${escapeHtml(a.sub)}</span></div>
      <div class="mr-mult">× ${a.mult}</div>
      <div class="mr-tdee">${tdeeIfThis}</div>
    </div>
  `;
}).join('');

html += `
  <div class="insight-card">
    <div class="insight-eyebrow">02 · Adding life back in</div>
    <h3>What is <em>TDEE?</em></h3>
    <p class="insight-explainer"><strong>Total Daily Energy Expenditure</strong> is BMR plus everything else your body does on a normal day — walking, working, exercising, even digesting food (about 10% of intake goes to digestion itself, called the <em>thermic effect of food</em>). Since almost nobody actually lies still all day, TDEE is closer to your "true" maintenance burn than BMR is.</p>
    <p class="insight-explainer">The calculation method is simple: multiply BMR by an <strong>activity factor</strong>. The five standard factors below come from research originally codified by Katch & McArdle. They're approximations — your real number depends on muscle mass, NEAT (fidgeting, posture, restless movement), and how honest you are about how much you actually exercise.</p>

    <div class="insight-formula">
      <div class="formula-label">The equation</div>
      <div class="formula-eq">TDEE <span class="op">=</span> BMR <span class="op">×</span> <span class="var">activity multiplier</span></div>
    </div>

    <div class="multiplier-table">${multTable}</div>
`;

if (tdee != null) {
  html += `
    <div class="insight-plugin">
      <div class="plugin-label">For you · ${escapeHtml(p.name)} at ${escapeHtml(activeAct.label)}</div>
      <div class="plugin-eq">TDEE = ${Math.round(bmr).toLocaleString()} × ${activeAct.mult}</div>
      <div class="plugin-result">= <strong>${Math.round(tdee).toLocaleString()} kcal / day</strong></div>
    </div>
    <p class="insight-note">If you change your activity level on the Plan tab, this number — and everything downstream of it — adjusts immediately.</p>
  `;
} else {
  html += `<div class="insight-locked">Set your profile in <strong>Plan</strong> to see TDEE calculated for you.</div>`;
}

html += `</div>`;

// ----- CARD 3: THE 7700 RULE -----
html += `
  <div class="insight-card">
    <div class="insight-eyebrow">03 · Why deficit equals loss</div>
    <h3>The <em>7,700 kcal rule</em></h3>
    <p class="insight-explainer">A kilogram of stored body fat releases approximately <strong>7,700 kilocalories</strong> when oxidized. A pound stores about <strong>3,500 kcal</strong>. This is a physiological constant — the energy density of adipose tissue.</p>
    <p class="insight-explainer">So if you maintain a <strong>sustained calorie deficit of 7,700 kcal</strong> — meaning your TDEE exceeds your intake by that amount, summed over any number of days — you'll have burned roughly 1 kg of fat. This is how every weight-loss calculation in the app works.</p>

    <div class="insight-formula">
      <div class="formula-label">The conversion</div>
      <div class="formula-eq">1 kg of fat <span class="op">≈</span> 7,700 kcal</div>
      <div class="formula-eq">1 lb of fat <span class="op">≈</span> 3,500 kcal</div>
      <div class="formula-eq">predicted loss <span class="op">=</span> total deficit <span class="op">÷</span> 7,700</div>
    </div>

    <div class="insight-callout">
      <div class="callout-title">Caveat — short-term vs long-term</div>
      <p>Day-to-day scale weight fluctuates from water, glycogen (which holds ~3 g of water per gram stored), and sodium. Over weeks, the 7,700 number holds up well. Over many months, your BMR drops slightly as you get smaller (less mass to maintain), and the body becomes more efficient — this is <em>metabolic adaptation</em>. The prediction in this app is mathematically clean but should be read as <strong>"if your metabolism stayed exactly where it is today."</strong></p>
    </div>
  </div>
`;

// ----- CARD 4: TODAY'S DEFICIT -----
html += `
  <div class="insight-card">
    <div class="insight-eyebrow">04 · Today's number</div>
    <h3>Today's <em>deficit</em></h3>
    <p class="insight-explainer">Subtract what you ate from what you burned, then add any extra calories burned through exercise. Positive deficit = you spent more than you took in = losing. Negative = surplus = gaining. Zero = maintaining.</p>
    <p class="insight-explainer"><strong>Why exercise adds:</strong> your TDEE estimate already includes <em>some</em> activity (the multiplier you picked in Plan — sedentary, moderate, etc). Logged exercise sessions are <em>additional</em> burn on top of that baseline, so they push your daily deficit higher.</p>

    <div class="insight-formula">
      <div class="formula-label">The equation</div>
      <div class="formula-eq">today's deficit <span class="op">=</span> (TDEE <span class="op">−</span> calories consumed) <span class="op">+</span> exercise burn</div>
    </div>
`;

if (todayDeficit != null) {
  const trend = todayDeficit > 0 ? 'in deficit' : (todayDeficit < 0 ? 'in surplus' : 'at maintenance');
  const baseDeficit = tdee - todayKcal;
  html += `
    <div class="insight-plugin">
      <div class="plugin-label">For you · ${new Date().toLocaleDateString('en-US', { weekday: 'long' })}</div>
      ${todayBurned > 0 ? `
        <div class="plugin-eq">base   = ${Math.round(tdee).toLocaleString()} − ${Math.round(todayKcal).toLocaleString()} = ${Math.round(baseDeficit).toLocaleString()}</div>
        <div class="plugin-eq">+ exercise burn = ${todayBurned.toLocaleString()}</div>
        <div class="plugin-result">= <strong>${todayDeficit >= 0 ? '−' : '+'}${Math.abs(Math.round(todayDeficit)).toLocaleString()} kcal</strong> · ${trend}</div>
      ` : `
        <div class="plugin-eq">today = ${Math.round(tdee).toLocaleString()} − ${Math.round(todayKcal).toLocaleString()}</div>
        <div class="plugin-result">= <strong>${todayDeficit >= 0 ? '−' : '+'}${Math.abs(Math.round(todayDeficit)).toLocaleString()} kcal</strong> · ${trend}</div>
        <div class="plugin-eq" style="margin-top: 8px; color: var(--text-dim);">(no exercise logged today — log a session to add to this number)</div>
      `}
    </div>
    <p class="insight-note">A single day's deficit is small. The story is in the streak — see card 06 for the cumulative.</p>
  `;
} else {
  html += `<div class="insight-locked">Profile + weight needed to compute. Set them in <strong>Plan</strong> and <strong>Weight</strong>.</div>`;
}

html += `</div>`;

// ----- CARD 5: WEEKLY PROJECTION -----
const dailyDeficitChoices = [250, 500, 750, 1000];
html += `
  <div class="insight-card">
    <div class="insight-eyebrow">05 · Translating to the scale</div>
    <h3>What does a <em>daily deficit</em> add up to?</h3>
    <p class="insight-explainer">Take a fixed daily deficit, multiply by 7 days, divide by 7,700. That's the weekly fat loss the math predicts. This is also why most credible coaches suggest 500 kcal/day as a reasonable target — it lands around 1 lb / 0.45 kg per week, which is sustainable without compromising muscle or sanity.</p>

    <div class="projection-table">
      <div class="pt-head">daily deficit</div>
      <div class="pt-head">weekly total</div>
      <div class="pt-head">kg / week</div>
      <div class="pt-head">lb / week</div>
      ${dailyDeficitChoices.map(d => {
        const weekTotal = d * 7;
        const kgWk = weekTotal / KCAL_PER_KG_FAT;
        const lbWk = weekTotal / KCAL_PER_LB_FAT;
        return `
          <div class="pt-row">−${d}</div>
          <div class="pt-row">−${weekTotal.toLocaleString()}</div>
          <div class="pt-row">${kgWk.toFixed(2)} kg</div>
          <div class="pt-row">${lbWk.toFixed(2)} lb</div>
        `;
      }).join('')}
      ${(todayDeficit != null && todayDeficit > 0) ? `
        <div class="pt-row you">${Math.round(todayDeficit).toLocaleString()}</div>
        <div class="pt-row you">−${Math.round(todayDeficit * 7).toLocaleString()}</div>
        <div class="pt-row you">${(todayDeficit * 7 / KCAL_PER_KG_FAT).toFixed(2)} kg</div>
        <div class="pt-row you">${(todayDeficit * 7 / KCAL_PER_LB_FAT).toFixed(2)} lb</div>
      ` : ''}
    </div>

    ${todayDeficit != null && todayDeficit > 0 ? `
      <p class="insight-note">The highlighted row projects your <em>actual</em> deficit today, held constant for 7 days. The reality of a real week will differ — the point is to see what scale movement <em>this kind of day</em> creates.</p>
    ` : ''}
  </div>
`;

// ----- CARD 6: CUMULATIVE & PREDICTION -----
html += `
  <div class="insight-card">
    <div class="insight-eyebrow">06 · The cumulative</div>
    <h3>Total deficit <em>so far</em></h3>
    <p class="insight-explainer">Every day you log, the app computes that day's deficit and adds it to a running total. Divide by 7,700 = projected kilograms of fat. Divide by 3,500 = pounds.</p>

    <div class="insight-formula">
      <div class="formula-label">The equation</div>
      <div class="formula-eq">cumulative deficit <span class="op">=</span> Σ ((TDEE <span class="op">−</span> kcal eaten) <span class="op">+</span> exercise burn) <span class="op">over all logged days</span></div>
      <div class="formula-eq">predicted kg lost  <span class="op">=</span> cumulative deficit <span class="op">÷</span> 7,700</div>
      <div class="formula-eq">predicted lb lost  <span class="op">=</span> cumulative deficit <span class="op">÷</span> 3,500</div>
    </div>
`;

if (cumDeficit != null) {
  const numDays = countLoggedDays(p.id);
  const predKg = Math.max(0, cumDeficit) / KCAL_PER_KG_FAT;
  const predLb = Math.max(0, cumDeficit) / KCAL_PER_LB_FAT;
  html += `
    <div class="insight-plugin">
      <div class="plugin-label">For you · across ${numDays} day${numDays === 1 ? '' : 's'} logged</div>
      <div class="plugin-eq">cumulative = ${cumDeficit >= 0 ? '' : '−'}${Math.abs(Math.round(cumDeficit)).toLocaleString()} kcal ${cumDeficit >= 0 ? 'under burn' : 'over burn'}</div>
      ${cumDeficit > 0 ? `
        <div class="plugin-eq">kg = ${Math.round(cumDeficit).toLocaleString()} ÷ 7,700</div>
        <div class="plugin-eq">lb = ${Math.round(cumDeficit).toLocaleString()} ÷ 3,500</div>
        <div class="plugin-result">= <strong>${predKg.toFixed(2)} kg</strong> / <strong>${predLb.toFixed(2)} lb</strong> projected fat loss</div>
      ` : `
        <div class="plugin-result"><strong>No projected loss yet</strong> · cumulative is at or above maintenance</div>
      `}
    </div>
    <p class="insight-note">"Logged days" means any day with at least one meal entry. Days you forgot to log don't count toward the cumulative — accuracy depends on consistent logging.</p>
  `;
} else {
  html += `<div class="insight-locked">Profile + weight needed. Once set, every meal you log feeds this.</div>`;
}

html += `</div>`;

// ----- CARD 7: GOAL PROJECTION (if goal set) -----
if (ws.goal != null && lbs != null && tdee != null && todayDeficit != null && todayDeficit > 0) {
  const goalLbs = ws.goal;
  const toLoseLbs = lbs - goalLbs;
  if (toLoseLbs > 0.1) {
    const dailyDef = todayDeficit;  // assume today's pattern continues
    const daysAtThisPace = (toLoseLbs * KCAL_PER_LB_FAT) / dailyDef;
    const reachDate = new Date(Date.now() + daysAtThisPace * 86400000);
    const toLoseKg = toLoseLbs * 0.45359237;
    html += `
      <div class="insight-card">
        <div class="insight-eyebrow">07 · Time to goal</div>
        <h3>How long to <em>your goal?</em></h3>
        <p class="insight-explainer">If you maintained today's deficit (${Math.round(dailyDef).toLocaleString()} kcal/day) every single day, this is when you'd hit your goal weight of <strong>${fromLbs(goalLbs, ws.unit).toFixed(1)} ${ws.unit}</strong>. Most weeks won't be perfect; treat this as a "best-case constant-pace" projection, not a deadline.</p>

        <div class="insight-formula">
          <div class="formula-label">The equation</div>
          <div class="formula-eq">days to goal <span class="op">=</span> (current <span class="op">−</span> goal) <span class="op">×</span> 3,500 <span class="op">÷</span> daily deficit</div>
        </div>

        <div class="insight-plugin">
          <div class="plugin-label">For you · at today's pace</div>
          <div class="plugin-eq">to lose: ${fromLbs(lbs, ws.unit).toFixed(1)} − ${fromLbs(goalLbs, ws.unit).toFixed(1)} = ${ws.unit === 'kg' ? toLoseKg.toFixed(1) : toLoseLbs.toFixed(1)} ${ws.unit}</div>
          <div class="plugin-eq">days = ${toLoseLbs.toFixed(1)} × 3,500 ÷ ${Math.round(dailyDef).toLocaleString()}</div>
          <div class="plugin-result">≈ <strong>${Math.round(daysAtThisPace)} days</strong> · ${reachDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>
        <p class="insight-note">Set a different goal in the Weight tab to recalculate. Different daily deficit patterns produce different timelines — see card 05 for what to aim for.</p>
      </div>
    `;
  }
}

// ----- CARD 8: MACROS -----
html += `
  <div class="insight-card">
    <div class="insight-eyebrow">${ws.goal != null && lbs != null && todayDeficit != null && todayDeficit > 0 ? '08' : '07'} · The non-calorie targets</div>
    <h3>Why <em>protein and fiber</em> get their own targets</h3>
    <p class="insight-explainer">Calories tell you about energy balance. Protein and fiber matter for <em>composition</em> — what your body does with that energy.</p>
    <p class="insight-explainer"><strong>Protein</strong> is the macronutrient your body cannot store as a long-term reserve. During a calorie deficit, if intake is too low, the body breaks down muscle for amino acids — exactly what you don't want. Sports nutrition research generally recommends <strong>1.6–2.2 grams per kg of bodyweight</strong> when in a deficit. ${kg != null ? `For you that's ${(kg * 1.6).toFixed(0)}–${(kg * 2.2).toFixed(0)} g/day.` : ''} Your current target: <strong>${p.targets.pro} g/day</strong>.</p>
    <p class="insight-explainer"><strong>Fiber</strong> isn't digested for calories — it feeds gut bacteria, slows blood-sugar response, and crucially for a deficit, increases satiety per calorie. Standard guidelines are <strong>25 g/day for women, 38 g for men</strong>. The 40+ g/day target this app defaults to is intentionally higher than that minimum — it's calibrated for the specific goals of weight loss and digestive health. Your current target: <strong>${p.targets.fib} g/day</strong>.</p>

    <div class="insight-callout">
      <div class="callout-title">The hierarchy</div>
      <p>Calories drive whether you lose or gain. Protein drives whether what you lose is fat or muscle. Fiber makes the whole thing sustainable by keeping you full and your gut working. That's why all three live on the Today screen.</p>
    </div>
  </div>
`;

content.innerHTML = html;
}

function countLoggedDays(personId) {
const id = personId || (activePerson() && activePerson().id);
if (!id) return 0;
const days = new Set();
entriesForPerson(id).forEach(e => {
  days.add(startOfDay(new Date(e.timestamp)).toISOString());
});
exercisesForPerson(id).forEach(x => {
  days.add(startOfDay(new Date(x.timestamp)).toISOString());
});
return days.size;
}



/* ============ PERSON UI SYNC ============ */
function syncPersonUI() {
if (!state.log || !state.log.people) return;
const p = activePerson();
if (!p) return;

// Person dropdown
const sel = $('#person-select');
sel.innerHTML = state.log.people
  .map(pp => `<option value="${pp.id}" ${pp.id === p.id ? 'selected' : ''}>${escapeHtml(pp.name)}</option>`)
  .join('');
// Color dot
$('#person-dot').style.background = p.color;

// Targets editor reflects active person
$('#tgt-cal').value = p.targets.cal;
$('#tgt-pro').value = p.targets.pro;
$('#tgt-fib').value = p.targets.fib;

// Weight settings UI (if the weight panel's inputs exist)
if ($('#wf-unit-label')) {
  syncWeightUI();
}

// Plan form reflects active person's profile
const prof = p.profile || {};
if ($('#pf-gender')) {
  $('#pf-gender').value = prof.gender || '';
  $('#pf-age').value = prof.age != null ? prof.age : '';
  $('#pf-height-cm').value = prof.heightCm != null ? prof.heightCm : '';
  $('#pf-activity').value = prof.activityLevel || 'moderate';
  // Derive ft/in from cm if cm is set, else leave blank
  if (prof.heightCm) {
    const totalIn = prof.heightCm / 2.54;
    const ft = Math.floor(totalIn / 12);
    const inches = +(totalIn - ft * 12).toFixed(1);
    $('#pf-height-ft').value = ft;
    $('#pf-height-in').value = inches;
  } else {
    $('#pf-height-ft').value = '';
    $('#pf-height-in').value = '';
  }
}
}

/* ============ DEFICIT AREA (in Today view) ============ */
function renderDeficitArea(date, todayTotals) {
const p = activePerson();
const tdee = activeTDEE();
const deficitEl = $('#day-deficit');
const celebEl = $('#day-celebration');

if (tdee == null) {
  // Profile or weight missing — show a soft prompt instead
  deficitEl.innerHTML = `
    <div class="empty-state" style="padding: 24px 20px; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 24px;">
      <h3 style="font-size: 16px;">Want deficit tracking?</h3>
      <p style="font-size: 12px; margin-top: 6px;">Set your profile in <strong style="color: var(--accent)">04 Plan</strong> and log at least one weight entry. The deficit cards and weight-loss prediction will appear here.</p>
    </div>
  `;
  celebEl.innerHTML = '';
  return;
}

const consumed = todayTotals.cal;
const burned   = exerciseKcalForDay(date);  // exercise calories burned that day
const todayDeficit = (tdee - consumed) + burned;  // exercise ADDS to deficit
const cumDeficit = cumulativeDeficit();
const ws = activeWS();

// Predicted fat loss from cumulative deficit (only if positive)
const positiveCum = Math.max(0, cumDeficit);
const predKg  = positiveCum / KCAL_PER_KG_FAT;
const predLbs = positiveCum / KCAL_PER_LB_FAT;

const tdeeRounded = Math.round(tdee);
const todayClass = todayDeficit >= 0 ? 'positive' : 'negative';
const cumClass = cumDeficit >= 0 ? 'positive' : 'negative';

// Build deficit subtext based on whether exercise contributed
const deficitSubtext = burned > 0
  ? `${tdeeRounded.toLocaleString()} burned + ${burned.toLocaleString()} exercise − ${Math.round(consumed).toLocaleString()} eaten`
  : `${tdeeRounded.toLocaleString()} burned − ${Math.round(consumed).toLocaleString()} eaten`;

deficitEl.innerHTML = `
  <div class="deficit-row">
    <div class="deficit-card">
      <div class="dc-label">TDEE today</div>
      <div class="dc-value">${tdeeRounded.toLocaleString()}<span class="dc-unit">kcal burned</span></div>
      <div class="dc-sub">basal + activity for ${escapeHtml(p.name)}${burned > 0 ? ` · +${burned.toLocaleString()} from exercise` : ' · from your profile'}</div>
    </div>
    <div class="deficit-card ${todayClass}">
      <div class="dc-label">${sameDay(date, new Date()) ? "Today's" : "Day's"} deficit</div>
      <div class="dc-value">${todayDeficit >= 0 ? '−' : '+'}${Math.abs(Math.round(todayDeficit)).toLocaleString()}<span class="dc-unit">kcal</span></div>
      <div class="dc-sub">${deficitSubtext}</div>
    </div>
    <div class="deficit-card ${cumClass}">
      <div class="dc-label">Cumulative deficit</div>
      <div class="dc-value">${cumDeficit >= 0 ? '−' : '+'}${Math.abs(Math.round(cumDeficit)).toLocaleString()}<span class="dc-unit">kcal</span></div>
      <div class="dc-sub">across all logged days · 7,700 kcal ≈ 1 kg fat</div>
    </div>
  </div>
`;

// ----- CELEBRATIONS -----
let celebHtml = '';

// Daily celebration when current day is in deficit
if (todayDeficit > 0 && sameDay(date, new Date())) {
  celebHtml += `
    <div class="celebration-band">
      <div class="cb-eyebrow">✦ In deficit today</div>
      <div class="cb-title">You're <em>${Math.round(todayDeficit).toLocaleString()} kcal under</em> your burn.</div>
      <div class="cb-body">Hold the line for today. Repeated days like this are what move the scale.</div>
    </div>
  `;
}

// Milestone celebration: every 1 kg crossed
if (cumDeficit > 0) {
  const currentMilestone = Math.floor(cumDeficit / KCAL_PER_KG_FAT);
  const isNewMilestone = currentMilestone > (state.lastSeenMilestone || 0);
  if (currentMilestone >= 1) {
    celebHtml += `
      <div class="celebration-band milestone">
        <div class="cb-eyebrow">${isNewMilestone ? '★ NEW MILESTONE' : '★ Milestone'}</div>
        <div class="cb-title">${currentMilestone} kg <em>of fat-equivalent deficit reached.</em></div>
        <div class="cb-body">${currentMilestone === 1
          ? 'First kilogram in the bank — this is the threshold most people never cross.'
          : `That's roughly ${currentMilestone} kg / ${(currentMilestone * 2.205).toFixed(1)} lbs of fat over your run.`}</div>
        <div class="prediction">
          <span><strong>${predKg.toFixed(2)} kg</strong> projected fat loss</span>
          <span><strong>${predLbs.toFixed(2)} lb</strong> projected fat loss</span>
          <span style="color: var(--text-dim);">based on 7,700 kcal ≈ 1 kg of body fat</span>
        </div>
      </div>
    `;
    if (isNewMilestone) {
      state.lastSeenMilestone = currentMilestone;
      // Save lastSeen to keep across sessions per-person — not persisted in log right now;
      // the milestone re-celebrates on each session start once user adds more deficit.
    }
  } else if (predKg >= 0.05) {
    // Smaller prediction — still motivating
    celebHtml += `
      <div class="celebration-band">
        <div class="cb-eyebrow">Tracking projected loss</div>
        <div class="cb-title">≈ <em>${predKg.toFixed(2)} kg / ${predLbs.toFixed(2)} lb</em> of fat by deficit.</div>
        <div class="cb-body">Keep stacking deficit days. Each 7,700 kcal = a full kilogram of fat lost (theoretical).</div>
      </div>
    `;
  }
}

celebEl.innerHTML = celebHtml;
}

/* ============ PLAN TAB ============ */
function renderPlan() {
const p = activePerson();
if (!p) return;
syncPersonUI();
const prof = p.profile;
const lbs = latestWeightLbs(p.id);
const ws = p.weightSettings;
const content = $('#plan-content');

// No weight = cannot compute
if (lbs == null) {
  content.innerHTML = `
    <div class="plan-empty">
      <h3>One thing missing.</h3>
      <p>Log at least one weight entry (in the <strong style="color: var(--accent)">05 Weight</strong> tab) and the calorie plan will compute from your latest reading.</p>
    </div>
  `;
  return;
}

// No complete profile = show what's needed
const kg = lbs * 0.45359237;
const bmr = calcBMR(prof, kg);
if (bmr == null) {
  content.innerHTML = `
    <div class="plan-empty">
      <h3>Complete your profile.</h3>
      <p>Pick gender, enter age, and provide height (either cm or feet+inches). Activity level defaults to Moderate.</p>
    </div>
  `;
  return;
}

const tdee = calcTDEE(bmr, prof.activityLevel);
const act = ACTIVITY_LEVELS[prof.activityLevel] || ACTIVITY_LEVELS.moderate;
const weightShown = `${fromLbs(lbs, ws.unit).toFixed(1)} ${ws.unit}`;

// Deficit tiers
const tiers = [
  { name: 'Maintain',     rate: 'hold current weight',   deficit: 0,    recommended: false },
  { name: 'Mild deficit', rate: '~0.25 kg / 0.5 lb / wk', deficit: 275,  recommended: false },
  { name: 'Moderate',     rate: '~0.5 kg / 1 lb / wk',    deficit: 550,  recommended: true  },
  { name: 'Aggressive',   rate: '~1 kg / 2 lb / wk',      deficit: 1100, recommended: false }
];

const tierRows = tiers.map(t => {
  const target = Math.max(1000, Math.round(tdee - t.deficit));  // floor at 1000 for safety
  return `
    <div class="deficit-tier ${t.recommended ? 'recommended' : ''}">
      <div class="dt-name">${escapeHtml(t.name)} <span class="dt-rate">${escapeHtml(t.rate)}</span></div>
      <div class="dt-kcal">${target.toLocaleString()} kcal</div>
      <div class="dt-deficit">${t.deficit === 0 ? '—' : '−' + t.deficit + ' /day'}</div>
      <button class="btn" data-apply="${target}">Apply</button>
    </div>
  `;
}).join('');

content.innerHTML = `
  <div class="plan-results">
    <div class="plan-result">
      <div class="pr-label">BMR · Mifflin–St Jeor</div>
      <div class="pr-value">${Math.round(bmr).toLocaleString()}<span class="unit">kcal / day</span></div>
      <div class="pr-sub">At rest — what your body burns just keeping you alive.</div>
    </div>
    <div class="plan-result hero">
      <div class="pr-label">TDEE · with activity</div>
      <div class="pr-value">${Math.round(tdee).toLocaleString()}<span class="unit">kcal / day</span></div>
      <div class="pr-sub">BMR × <strong>${act.mult}</strong> (${escapeHtml(act.label.toLowerCase())} · ${escapeHtml(act.sub)})<br>Using latest weight: <strong>${weightShown}</strong></div>
    </div>
  </div>

  <div class="deficit-options">
    <h3>Pick your <em>deficit</em></h3>
    <div class="do-sub">7,700 kcal ≈ 1 kg fat — pick a sustainable cut and click Apply to set ${escapeHtml(p.name)}'s daily calorie target.</div>
    ${tierRows}
  </div>
`;

// Apply buttons
content.querySelectorAll('[data-apply]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = Number(btn.dataset.apply);
    p.targets.cal = target;
    Storage.saveAll(state.log);
    syncPersonUI();
    renderAll();
    toast(`Applied ${target.toLocaleString()} kcal/day target for ${p.name}`, 'success');
  });
});
}

/* ============ FAMILY TAB ============ */
function renderFamily() {
const content = $('#family-content');
const people = state.log.people || [];

// ----- Family totals across all people for today -----
const dayStart = startOfDay(new Date()).getTime();
const dayEnd   = endOfDay(new Date()).getTime();
const todayAll = (state.log.entries || []).filter(e => {
  const t = new Date(e.timestamp).getTime();
  return t >= dayStart && t <= dayEnd;
});
const totals = sumMacros(todayAll);
const combinedTargets = people.reduce((acc, p) => ({
  cal: acc.cal + (p.targets.cal || 0),
  pro: acc.pro + (p.targets.pro || 0),
  fib: acc.fib + (p.targets.fib || 0)
}), { cal: 0, pro: 0, fib: 0 });

// ----- Per-person cards -----
const cardHtml = people.map(p => familyMemberCard(p)).join('');

// ----- Multi-line weight chart -----
const weightHtml = familyWeightChart(people);

content.innerHTML = `
  <div class="chart-card">
    <div class="chart-title">Today · combined family intake</div>
    <div class="chart-sub">${people.length} ${people.length === 1 ? 'person' : 'people'} · ${todayAll.length} entries today</div>
    <div class="family-totals">
      ${statCard('cal', 'kcal', totals.cal, combinedTargets.cal)}
      ${statCard('pro', 'protein', totals.pro, combinedTargets.pro)}
      ${statCard('fib', 'fiber', totals.fib, combinedTargets.fib)}
    </div>
  </div>

  <div class="chart-card">
    <div class="chart-title">Members · today</div>
    <div class="chart-sub">Tap a card to switch to that person</div>
    <div class="family-members">${cardHtml}</div>
  </div>

  ${weightHtml}

  ${people.length === 1 ? `
    <div class="plan-empty" style="margin-top: 16px;">
      <h3>Want comparisons?</h3>
      <p>Add another family member using <strong style="color: var(--accent)">+ Add person</strong> at the top of the page. All their data lands in the same JSON file alongside yours.</p>
    </div>
  ` : ''}
`;

// Animate bars
requestAnimationFrame(() => requestAnimationFrame(() => {
  $$('#family-content .stat-fill, #family-content .fc-fill').forEach(f => f.style.width = f.dataset.pct + '%');
}));

// Card click switches person
content.querySelectorAll('.family-card[data-person]').forEach(card => {
  card.addEventListener('click', () => switchPerson(card.dataset.person));
});
}

function familyMemberCard(p) {
const dayStart = startOfDay(new Date()).getTime();
const dayEnd   = endOfDay(new Date()).getTime();
const entries = entriesForPerson(p.id).filter(e => {
  const t = new Date(e.timestamp).getTime();
  return t >= dayStart && t <= dayEnd;
});
const totals = sumMacros(entries);
const calPct = p.targets.cal ? Math.min(100, (totals.cal / p.targets.cal) * 100) : 0;
const proPct = p.targets.pro ? Math.min(100, (totals.pro / p.targets.pro) * 100) : 0;
const fibPct = p.targets.fib ? Math.min(100, (totals.fib / p.targets.fib) * 100) : 0;

// Latest weight (in person's preferred unit)
const lbs = latestWeightLbs(p.id);
const weightDisp = lbs != null
  ? `${fromLbs(lbs, p.weightSettings.unit).toFixed(1)} ${p.weightSettings.unit}`
  : '— not logged';

// Compute this person's deficit (independent of activePersonId)
const savedActive = state.activePersonId;
state.activePersonId = p.id;
const tdee = activeTDEE();
state.activePersonId = savedActive;

let deficitHtml = '<span style="color: var(--text-dim);">profile not set</span>';
if (tdee != null) {
  const d = tdee - totals.cal;
  deficitHtml = d >= 0
    ? `<span class="pos">−${Math.round(d).toLocaleString()} kcal deficit</span>`
    : `<span class="neg">+${Math.round(-d).toLocaleString()} kcal surplus</span>`;
}

return `
  <div class="family-card" data-person="${p.id}" style="--person-color: ${p.color};">
    <div class="fc-head">
      <div class="fc-name">${escapeHtml(p.name)}</div>
      <div class="fc-weight">${weightDisp}</div>
    </div>
    <div class="fc-rows">
      <div class="fc-row">
        <div class="fc-label">kcal</div>
        <div class="fc-bar"><div class="fc-fill cal" data-pct="${calPct}"></div></div>
        <div class="fc-val">${Math.round(totals.cal)}/${p.targets.cal}</div>
      </div>
      <div class="fc-row">
        <div class="fc-label">pro</div>
        <div class="fc-bar"><div class="fc-fill pro" data-pct="${proPct}"></div></div>
        <div class="fc-val">${totals.pro.toFixed(1)}/${p.targets.pro}g</div>
      </div>
      <div class="fc-row">
        <div class="fc-label">fib</div>
        <div class="fc-bar"><div class="fc-fill fib" data-pct="${fibPct}"></div></div>
        <div class="fc-val">${totals.fib.toFixed(1)}/${p.targets.fib}g</div>
      </div>
    </div>
    <div class="fc-deficit">
      <span>Today's deficit</span>
      <span>${deficitHtml}</span>
    </div>
  </div>
`;
}

function familyWeightChart(people) {
// Show multi-line weight trend — only people with 2+ weight entries are drawn
const withWeights = people.map(p => {
  const ws = weightsForPerson(p.id).slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return { person: p, weights: ws };
}).filter(x => x.weights.length >= 2);

if (!withWeights.length) {
  return `
    <div class="chart-card">
      <div class="chart-title">Weight trends</div>
      <div class="chart-sub">No multi-point weight data yet · log 2+ readings per person to compare</div>
    </div>
  `;
}

// Common time + value ranges
const allTimes = withWeights.flatMap(x => x.weights.map(w => new Date(w.timestamp).getTime()));
const tmin = Math.min(...allTimes);
const tmax = Math.max(...allTimes);
const tspan = Math.max(tmax - tmin, 1);

// Use Sri's (or active person's) unit as the chart display unit
const dispUnit = activeWS().unit;
const allVals = withWeights.flatMap(x => x.weights.map(w => fromLbs(w.value, dispUnit)));
let vmin = Math.min(...allVals);
let vmax = Math.max(...allVals);
const range = Math.max(vmax - vmin, 2);
const pad = range * 0.12;
vmin = Math.floor(vmin - pad);
vmax = Math.ceil(vmax + pad);

const W = 800, H = 280;
const PAD = { top: 20, right: 100, bottom: 36, left: 56 };  // bigger right for legend
const innerW = W - PAD.left - PAD.right;
const innerH = H - PAD.top - PAD.bottom;
const x = t => PAD.left + ((t - tmin) / tspan) * innerW;
const y = v => PAD.top + (1 - (v - vmin) / (vmax - vmin)) * innerH;

// Y ticks
const yTickCount = 5;
const yTicks = [];
for (let i = 0; i <= yTickCount; i++) {
  const v = vmin + (vmax - vmin) * (i / yTickCount);
  yTicks.push({ value: v, y: y(v) });
}

// Build paths per person
const paths = withWeights.map(x_obj => {
  const { person, weights } = x_obj;
  const d = weights.map((w, i) => {
    const px = x(new Date(w.timestamp).getTime()).toFixed(1);
    const py = y(fromLbs(w.value, dispUnit)).toFixed(1);
    return (i === 0 ? 'M' : 'L') + px + ',' + py;
  }).join(' ');
  return { person, weights, path: d };
});

// Legend
const legendY = PAD.top;
const legendItems = paths.map((p, i) => `
  <g transform="translate(${W - PAD.right + 16}, ${legendY + i * 22})">
    <line x1="0" y1="0" x2="16" y2="0" stroke="${p.person.color}" stroke-width="2.5"/>
    <text x="22" y="4" fill="var(--text)" font-size="11" font-family="Inter">${escapeHtml(p.person.name)}</text>
  </g>
`).join('');

// X ticks
const xTickCount = 5;
const xTicks = [];
for (let i = 0; i < xTickCount; i++) {
  const t = tmin + (tspan * i) / (xTickCount - 1);
  xTicks.push({ time: t, x: x(t) });
}

return `
  <div class="chart-card weight-chart">
    <div class="chart-title">Weight trends · ${escapeHtml(dispUnit)}</div>
    <div class="chart-sub">${paths.length} ${paths.length === 1 ? 'person' : 'people'} <em>· each line is one member</em></div>
    <div class="weight-chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${yTicks.map(t => `
          <line x1="${PAD.left}" y1="${t.y.toFixed(1)}" x2="${W - PAD.right}" y2="${t.y.toFixed(1)}"
                stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
          <text x="${PAD.left - 8}" y="${(t.y + 3).toFixed(1)}" text-anchor="end"
                fill="var(--text-dim)" font-size="10">${t.value.toFixed(1)}</text>
        `).join('')}
        ${paths.map(p => `
          <path d="${p.path}" fill="none" stroke="${p.person.color}" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round"/>
          ${p.weights.map(w => {
            const px = x(new Date(w.timestamp).getTime()).toFixed(1);
            const py = y(fromLbs(w.value, dispUnit)).toFixed(1);
            return `<circle cx="${px}" cy="${py}" r="3" fill="${p.person.color}" stroke="var(--bg)" stroke-width="1.5"/>`;
          }).join('')}
        `).join('')}
        ${xTicks.map(t => {
          const d = new Date(t.time);
          return `<text x="${t.x.toFixed(1)}" y="${H - 12}" text-anchor="middle"
                        fill="var(--text-dim)" font-size="10" font-family="JetBrains Mono">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</text>`;
        }).join('')}
        ${legendItems}
      </svg>
    </div>
  </div>
`;
}


/* ============ TOAST ============ */
let toastTimer = null;
function toast(msg, kind = '') {
const t = $('#toast');
t.textContent = msg;
t.className = 'toast show ' + kind;
clearTimeout(toastTimer);
toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ============ GO ============ */
init();
