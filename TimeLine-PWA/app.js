/**
 * Time Line v3.2 - Logic & Engine
 * Diseñado bajo principios PMI/PMBOK (WBS, tiempos netos y TOs)
 * y visualización de diagramas en cascada y rutas temporales.
 */

// Estructura de Estado de la Aplicación
let projectData = {
  primaryTasks: [] // Máximo 15
};

/* ---------- v3.0: persistencia, utilidades y carga diferida de librerías ---------- */
const STORE_KEY = 'timeline_v3_project';
const safeId = v => String(v == null ? '' : v).replace(/[^\w.-]/g, '');
const num = v => Number(v) || 0;

// Valida/sanea un proyecto (localStorage o archivo JSON importado)
function normalizeProject(d) {
  if (!d || !Array.isArray(d.primaryTasks)) return null;
  d.primaryTasks = d.primaryTasks.slice(0, 15).map((pt, i) => ({
    editMode: false, ...pt,
    id: safeId(pt.id) || `pt_${Date.now()}_${i}`, code: safeId(pt.code) || `${i + 1}.0`,
    name: String(pt.name || ''), notes: String(pt.notes || ''),
    running: !!pt.running && num(pt.startTime) > 0, startTime: num(pt.startTime) || null,
    accumulatedTime: num(pt.accumulatedTime), currentDuration: num(pt.currentDuration),
    timeOuts: (Array.isArray(pt.timeOuts) ? pt.timeOuts : []).map((to, k) => ({
      id: safeId(to.id) || `to_${i}_${k}`, label: safeId(to.label) || `TO${k + 1}`,
      startOffsetMs: num(to.startOffsetMs), durationMs: num(to.durationMs), deleted: !!to.deleted })),
    subtasks: (Array.isArray(pt.subtasks) ? pt.subtasks : []).slice(0, 20).map((st, j) => ({
      hasBeenTimed: false, editMode: false, ...st,
      id: safeId(st.id) || `st_${Date.now()}_${i}_${j}`, code: safeId(st.code) || `${i + 1}.${j + 1}`,
      name: String(st.name || ''), notes: String(st.notes || ''),
      running: !!st.running && num(st.startTime) > 0, startTime: num(st.startTime) || null,
      startOffsetMs: num(st.startOffsetMs), durationMs: num(st.durationMs),
      accumulatedTime: num(st.accumulatedTime), currentDuration: num(st.currentDuration) }))
  }));
  return d;
}
function saveState() { try { localStorage.setItem(STORE_KEY, JSON.stringify(projectData)); } catch (e) {} }
function loadState() {
  try {
    const d = normalizeProject(JSON.parse(localStorage.getItem(STORE_KEY) || 'null'));
    if (d) { projectData = d; return true; }
  } catch (e) {}
  return false;
}
async function saveProjectJSON() {
  const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
  await saveFileWithPicker(blob, `TimeLine_${Date.now()}.json`,
    [{ description: 'Proyecto Time Line (*.json)', accept: { 'application/json': ['.json'] } }]);
}
function loadProjectJSON(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = normalizeProject(JSON.parse(r.result));
      if (!d) throw new Error('formato');
      projectData = d; renderApp();
    } catch (e) { alert('El archivo no es un proyecto Time Line válido.'); }
  };
  r.readAsText(file);
}

// Tiempo activo real: unión de intervalos (las subtareas simultáneas no se suman doble)
function activeUnionMs(pt) {
  const iv = pt.subtasks.map(s => [s.startOffsetMs, s.startOffsetMs + (s.currentDuration || s.durationMs || 0)])
    .filter(i => i[1] > i[0]).sort((a, b) => a[0] - b[0]);
  let total = 0, start = 0, end = -1;
  iv.forEach(([a, b]) => {
    if (a > end) { if (end >= 0) total += end - start; start = a; end = b; }
    else if (b > end) end = b;
  });
  return end >= 0 ? total + end - start : total;
}
function startLabel(t) { return t.running ? 'En curso' : (t.accumulatedTime > 0 ? 'Reanudar' : 'Iniciar'); }
function renumber() {
  projectData.primaryTasks.forEach((pt, i) => {
    pt.code = `${i + 1}.0`;
    pt.subtasks.forEach((st, j) => { st.code = `${i + 1}.${j + 1}`; });
  });
}
const _libs = {};
function loadLib(src) {
  return _libs[src] || (_libs[src] = new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src; el.onload = res;
    el.onerror = () => { delete _libs[src]; rej(new Error('No se pudo cargar ' + src)); };
    document.head.appendChild(el);
  }));
}
const LIB_PDF = 'lib/jspdf.umd.min.js';
const LIB_AUTOTABLE = 'lib/jspdf.plugin.autotable.min.js';
const LIB_PPTX = 'lib/pptxgen.bundle.js';

// Formato exacto de Excel: [h]:mm:ss.00
function formatDuration(ms, includeHours = true) {
  if (ms < 0 || isNaN(ms)) ms = 0;
  const totalHundredths = Math.floor(ms / 10);
  const hundredths = totalHundredths % 100;
  const totalSeconds = Math.floor(totalHundredths / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const pad = (n, len = 2) => String(n).padStart(len, '0');

  if (includeHours || hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}`;
}

// Reloj global (50 ms; en pausa si la pestaña está oculta, el tiempo se calcula con Date.now)
setInterval(() => {
  if (document.hidden) return;
  const now = Date.now();
  let hasRunning = false;
  projectData.primaryTasks.forEach(pt => {
    if (pt.running) {
      pt.currentDuration = (pt.accumulatedTime || 0) + (now - pt.startTime);
      hasRunning = true;
    }
    pt.subtasks.forEach(st => {
      if (st.running) {
        st.currentDuration = (st.accumulatedTime || 0) + (now - st.startTime);
        pt.currentDuration = Math.max(pt.currentDuration || 0, st.startOffsetMs + st.currentDuration);
        hasRunning = true;
      }
    });
  });
  if (hasRunning) renderApp(false);
}, 50);

// Inicialización de Eventos Globales
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnAddPrimary').addEventListener('click', addPrimaryTask);
  document.getElementById('btnExportExcel').addEventListener('click', openExportModal);
  document.getElementById('btnExportPPT').addEventListener('click', exportToPPT);
  document.getElementById('btnExportPDF').addEventListener('click', exportToPDF);
  document.getElementById('btnResetAll').addEventListener('click', resetAll);
  document.getElementById('btnSaveJSON').addEventListener('click', saveProjectJSON);
  document.getElementById('btnLoadJSON').addEventListener('click', () => document.getElementById('fileLoadJSON').click());
  document.getElementById('fileLoadJSON').addEventListener('change', e => { loadProjectJSON(e.target.files[0]); e.target.value = ''; });

  // Eventos del Modal de Selección de Exportación a Excel
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeExportModal);
  
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeExportModal);

  const exportModal = document.getElementById('exportModal');
  if (exportModal) {
    exportModal.addEventListener('click', (e) => {
      if (e.target.id === 'exportModal') closeExportModal();
    });
  }

  const btnConfirmTable = document.getElementById('btnConfirmTable');
  if (btnConfirmTable) {
    btnConfirmTable.addEventListener('click', () => {
      closeExportModal();
      exportToExcelTable();
    });
  }

  const btnConfirmGantt = document.getElementById('btnConfirmGantt');
  if (btnConfirmGantt) {
    btnConfirmGantt.addEventListener('click', () => {
      closeExportModal();
      exportToExcelGantt();
    });
  }

  const cardTable = document.getElementById('cardExportTable');
  if (cardTable) {
    cardTable.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        closeExportModal();
        exportToExcelTable();
      }
    });
  }

  const cardGantt = document.getElementById('cardExportGantt');
  if (cardGantt) {
    cardGantt.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        closeExportModal();
        exportToExcelGantt();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeExportModal();
  });

  // Restaurar el último proyecto guardado o iniciar con una tarea de muestra
  if (loadState() && projectData.primaryTasks.length) renderApp(); else addPrimaryTask();
});

// Apertura y Cierre del Modal de Exportación Excel
function openExportModal() {
  const modal = document.getElementById('exportModal');
  if (modal) modal.classList.remove('hidden');
}

function closeExportModal() {
  const modal = document.getElementById('exportModal');
  if (modal) modal.classList.add('hidden');
}

function resetAll() {
  if (confirm('¿Estás seguro de que deseas reiniciar todos los cronómetros y tareas?')) {
    projectData.primaryTasks = [];
    addPrimaryTask();
  }
}

// Agregar Tarea Primaria (Máximo 15)
function addPrimaryTask() {
  if (projectData.primaryTasks.length >= 15) {
    alert('Has alcanzado el límite máximo de 15 tareas principales.');
    return;
  }

  const idx = projectData.primaryTasks.length + 1;
  const newPrimary = {
    id: `pt_${Date.now()}_${Math.random()}`,
    code: `${idx}.0`,
    name: `Tarea principal #${idx}`,
    notes: '',
    editMode: false,
    running: false,
    startTime: null,
    endTime: null,
    accumulatedTime: 0,
    currentDuration: 0,
    timeOuts: [], // Lista de { id, label: "TO1", durationMs, startOffsetMs, deleted: false }
    subtasks: []  // Máximo 20
  };

  projectData.primaryTasks.push(newPrimary);
  renderApp();
}

// Agregar Tarea Secundaria (Máximo 20 por tarea primaria)
function addSecondaryTask(primaryId) {
  const pt = projectData.primaryTasks.find(p => p.id === primaryId);
  if (!pt) return;

  if (pt.subtasks.length >= 20) {
    alert('Has alcanzado el límite máximo de 20 tareas secundarias para esta tarea principal.');
    return;
  }

  const pIdx = projectData.primaryTasks.indexOf(pt) + 1;
  const sIdx = pt.subtasks.length + 1;

  const newSubtask = {
    id: `st_${Date.now()}_${Math.random()}`,
    code: `${pIdx}.${sIdx}`,
    name: `Subtarea ${sIdx}`,
    notes: '',
    editMode: false,
    hasBeenTimed: false,
    running: false,
    startTime: null,
    endTime: null,
    startOffsetMs: 0, // Posición relativa en la línea de tiempo primaria
    durationMs: 0,
    accumulatedTime: 0,
    currentDuration: 0
  };

  pt.subtasks.push(newSubtask);
  renderApp();
}

// Iniciar cronómetro de Tarea Principal
function startPrimaryTask(id) {
  const pt = projectData.primaryTasks.find(p => p.id === id);
  if (!pt || pt.running) return;

  pt.running = true;
  pt.startTime = Date.now();
  renderApp();
}

// Detener cronómetro de Tarea Principal
function endPrimaryTask(id) {
  const pt = projectData.primaryTasks.find(p => p.id === id);
  if (!pt || !pt.running) return;

  const elapsed = Date.now() - pt.startTime;
  pt.accumulatedTime = (pt.accumulatedTime || 0) + elapsed;
  pt.currentDuration = pt.accumulatedTime;
  pt.running = false;
  pt.startTime = null;
  pt.endTime = Date.now();

  // Si había alguna subtarea corriendo, detenerla
  pt.subtasks.forEach(st => {
    if (st.running) endSubtask(pt.id, st.id);
  });

  recalculateTimeoutsAndTimeline(pt);
  renderApp();
}

// Iniciar cronómetro de Tarea Secundaria
function startSubtask(primaryId, subtaskId) {
  const pt = projectData.primaryTasks.find(p => p.id === primaryId);
  if (!pt) return;

  // Si la tarea principal no está corriendo, la iniciamos automáticamente
  if (!pt.running && pt.accumulatedTime === 0) {
    pt.running = true;
    pt.startTime = Date.now();
  }

  const st = pt.subtasks.find(s => s.id === subtaskId);
  if (!st || st.running) return;

  st.running = true;
  st.hasBeenTimed = true;
  st.startTime = Date.now();

  // Calcular el desfase de inicio (startOffset) respecto al inicio de la primaria
  const currentPtElapsed = pt.running 
    ? (pt.accumulatedTime + (Date.now() - pt.startTime)) 
    : pt.currentDuration;

  if (st.startOffsetMs === 0 && st.accumulatedTime === 0) {
    st.startOffsetMs = currentPtElapsed;
  } else if (st.accumulatedTime > 0) {
    // Reanudar: el bloque conserva su duración real y termina "ahora" (la pausa no infla la barra)
    st.startOffsetMs = Math.max(0, currentPtElapsed - st.accumulatedTime);
  }

  renderApp();
}

// Detener cronómetro de Tarea Secundaria
function endSubtask(primaryId, subtaskId) {
  const pt = projectData.primaryTasks.find(p => p.id === primaryId);
  if (!pt) return;

  const st = pt.subtasks.find(s => s.id === subtaskId);
  if (!st || !st.running) return;

  const elapsed = Date.now() - st.startTime;
  st.accumulatedTime = (st.accumulatedTime || 0) + elapsed;
  st.durationMs = st.accumulatedTime;
  st.currentDuration = st.accumulatedTime;
  st.hasBeenTimed = true;
  st.running = false;
  st.startTime = null;
  st.endTime = Date.now();

  if (st.startOffsetMs + st.durationMs > (pt.currentDuration || 0)) {
    pt.currentDuration = st.startOffsetMs + st.durationMs;
    if (!pt.running) pt.accumulatedTime = pt.currentDuration;
  }

  recalculateTimeoutsAndTimeline(pt);
  renderApp();
}

// Algoritmo de Detección de Time-Outs (TO) y Segmentación de la Línea de Tiempo
function recalculateTimeoutsAndTimeline(pt) {
  // Ordenar subtareas con tiempo registrado por su inicio relativo
  const finishedSubtasks = pt.subtasks
    .filter(st => st.durationMs > 0 || st.startOffsetMs > 0 || st.hasBeenTimed)
    .sort((a, b) => a.startOffsetMs - b.startOffsetMs);

  let currentPointer = 0;
  let newTimeOuts = [];
  let toCount = 1;

  finishedSubtasks.forEach((st) => {
    // Si hay un hueco antes de que inicie esta subtarea, es un Time Out (TO)
    if (st.startOffsetMs > currentPointer) {
      const gapDuration = st.startOffsetMs - currentPointer;
      const existingTO = pt.timeOuts.find(to =>
        Math.max(to.startOffsetMs, currentPointer) < Math.min(to.startOffsetMs + to.durationMs, st.startOffsetMs)
      );
      
      newTimeOuts.push({
        id: `to_${pt.id}_${toCount}`,
        label: `TO${toCount}`,
        startOffsetMs: currentPointer,
        durationMs: gapDuration,
        deleted: existingTO ? existingTO.deleted : false // Mantener estado de borrado
      });
      toCount++;
    }
    currentPointer = Math.max(currentPointer, st.startOffsetMs + st.durationMs);
  });

  // Si la primaria tiene una duración total mayor que el final de la última subtarea, hay un TO final
  const totalPtDuration = Math.max(pt.currentDuration || 0, currentPointer);
  pt.currentDuration = totalPtDuration;
  if (!pt.running) {
    pt.accumulatedTime = totalPtDuration;
  }

  if (totalPtDuration > currentPointer) {
    const gapDuration = totalPtDuration - currentPointer;
    const existingTO = pt.timeOuts.find(to =>
      Math.max(to.startOffsetMs, currentPointer) < Math.min(to.startOffsetMs + to.durationMs, totalPtDuration)
    );
    newTimeOuts.push({
      id: `to_${pt.id}_${toCount}`,
      label: `TO${toCount}`,
      startOffsetMs: currentPointer,
      durationMs: gapDuration,
      deleted: existingTO ? existingTO.deleted : false
    });
  }

  pt.timeOuts = newTimeOuts;
}

// Conmutar modo edición de tiempo (activa botones incremental + y decreciente -)
function togglePrimaryEdit(primaryId) {
  commitPending('pt', primaryId, '');
  const pt = projectData.primaryTasks.find(p => p.id === primaryId);
  if (!pt) return;
  pt.editMode = !pt.editMode;
  renderApp();
}

function toggleSubtaskEdit(primaryId, subtaskId) {
  commitPending('st', primaryId, subtaskId);
  const pt = projectData.primaryTasks.find(p => p.id === primaryId);
  if (!pt) return;
  const st = pt.subtasks.find(s => s.id === subtaskId);
  if (!st) return;
  st.editMode = !st.editMode;
  renderApp();
}

// Ajuste incremental (+) o decreciente (-) en Tarea Primaria
function adjustPrimaryTime(primaryId, direction, event, stepMs) {
  if (!stepMs) commitPending('pt', primaryId, '');
  const pt = projectData.primaryTasks.find(p => p.id === primaryId);
  if (!pt || !pt.editMode) return;

  const baseStep = stepMs || (event && event.shiftKey ? 1000 : (event && event.altKey ? 100 : 10)); // clic: 0.01 s · Alt: 0.1 s · Shift: 1 s

  // Sincronizar duración actual con el máximo fin de subtareas/TOs
  let maxSubtaskEnd = 0;
  pt.subtasks.forEach(s => {
    const d = s.currentDuration || s.durationMs || 0;
    maxSubtaskEnd = Math.max(maxSubtaskEnd, s.startOffsetMs + d);
  });

  const curPtDur = Math.max(pt.currentDuration || 0, maxSubtaskEnd);

  if (direction > 0) {
    pt.currentDuration = curPtDur + baseStep;
    pt.accumulatedTime = pt.currentDuration;
  } else {
    if (curPtDur <= 0) return;
    const step = Math.min(baseStep, curPtDur);
    const newPtDur = Math.max(0, curPtDur - step);
    pt.currentDuration = newPtDur;
    pt.accumulatedTime = newPtDur;

    // Si no había TO final y las subtareas llegaban al borde, ajustar subtareas que excedan el nuevo límite
    pt.subtasks.forEach(s => {
      const d = s.currentDuration || s.durationMs || 0;
      if (s.startOffsetMs >= newPtDur) {
        s.startOffsetMs = newPtDur;
        s.durationMs = 0;
        s.currentDuration = 0;
        s.accumulatedTime = 0;
      } else if (s.startOffsetMs + d > newPtDur) {
        const trimmed = Math.max(0, newPtDur - s.startOffsetMs);
        s.durationMs = trimmed;
        s.currentDuration = trimmed;
        s.accumulatedTime = trimmed;
      }
    });
  }

  recalculateTimeoutsAndTimeline(pt);
  renderApp();
}

// Ajuste incremental (+) o decreciente (-) en Tarea Secundaria
function adjustSubtaskTime(primaryId, subtaskId, direction, event, stepMs) {
  if (!stepMs) commitPending('st', primaryId, subtaskId);
  const pt = projectData.primaryTasks.find(p => p.id === primaryId);
  if (!pt) return;
  const sIdx = pt.subtasks.findIndex(s => s.id === subtaskId);
  if (sIdx === -1) return;
  const st = pt.subtasks[sIdx];
  if (!st.editMode) return;

  const baseStep = stepMs || (event && event.shiftKey ? 1000 : (event && event.altKey ? 100 : 10)); // clic: 0.01 s · Alt: 0.1 s · Shift: 1 s
  const curDur = st.currentDuration || st.durationMs || 0;

  // Asegurar que la tarea principal tenga registrada al menos la extensión actual de la línea de tiempo
  let currentMaxEnd = pt.currentDuration || 0;
  pt.subtasks.forEach(s => {
    const d = s.currentDuration || s.durationMs || 0;
    currentMaxEnd = Math.max(currentMaxEnd, s.startOffsetMs + d);
  });
  pt.timeOuts.forEach(t => {
    currentMaxEnd = Math.max(currentMaxEnd, t.startOffsetMs + t.durationMs);
  });
  pt.currentDuration = currentMaxEnd;
  if (!pt.running) pt.accumulatedTime = currentMaxEnd;

  if (direction > 0) {
    const step = baseStep;

    // Si esta subtarea aún no tenía tiempo ni offset pero hay subtareas previas con tiempo, posicionarla después de la previa
    if (curDur === 0 && st.startOffsetMs === 0 && !st.hasBeenTimed && sIdx > 0) {
      let prevEnd = 0;
      for (let i = 0; i < sIdx; i++) {
        const prevSt = pt.subtasks[i];
        const prevDur = prevSt.currentDuration || prevSt.durationMs || 0;
        prevEnd = Math.max(prevEnd, prevSt.startOffsetMs + prevDur);
      }
      st.startOffsetMs = prevEnd;
    }

    const oldEnd = st.startOffsetMs + curDur;
    st.hasBeenTimed = true;
    st.durationMs = curDur + step;
    st.currentDuration = st.durationMs;
    st.accumulatedTime = st.durationMs;

    // Mover hacia la derecha las siguientes líneas de tiempo de las tareas siguientes
    pt.subtasks.forEach((otherSt, idx) => {
      if (otherSt.id === st.id) return;
      const otherHasActivity = (otherSt.durationMs > 0 || otherSt.currentDuration > 0 || otherSt.startOffsetMs > 0 || otherSt.hasBeenTimed);
      if (otherHasActivity && otherSt.startOffsetMs >= oldEnd) {
        otherSt.startOffsetMs += step;
      }
    });

    // Aumentar también en la línea principal
    let newMaxEnd = 0;
    pt.subtasks.forEach(s => {
      const d = s.currentDuration || s.durationMs || 0;
      newMaxEnd = Math.max(newMaxEnd, s.startOffsetMs + d);
    });
    pt.currentDuration = Math.max((pt.currentDuration || 0) + step, newMaxEnd);
    if (!pt.running) pt.accumulatedTime = currentMaxEnd + step;
  } else {
    // Caso decreciente (-): reducir el tiempo de la subtarea;
    // el tiempo sobrante se adiciona al Time Out que va después (o crea uno por defecto si no había)
    if (curDur <= 0) return;

    const step = Math.min(baseStep, curDur);
    st.hasBeenTimed = true;
    st.durationMs = Math.max(0, curDur - step);
    st.currentDuration = st.durationMs;
    st.accumulatedTime = st.durationMs;
    // No reducimos pt.currentDuration ni movemos la siguiente subtarea,
    // de modo que el tiempo sobrante pasa automáticamente al Time Out posterior (o lo crea por defecto).
  }

  recalculateTimeoutsAndTimeline(pt);
  renderApp();
}

// Escapar atributos HTML para evitar que comillas en nombres o notas rompan el input
function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Conmutar eliminación o inclusión de un Time Out
function toggleTimeOutDeleted(primaryId, toId) {
  const pt = projectData.primaryTasks.find(p => p.id === primaryId);
  if (!pt) return;
  const to = pt.timeOuts.find(t => t.id === toId);
  if (to) {
    to.deleted = !to.deleted;
    renderApp();
  }
}

// Renderizado de la Interfaz
function renderApp(fullRebuild = true) {
  const container = document.getElementById('tasksContainer');
  
  // Totales Globales
  let totalActiveMs = 0;
  let totalTOMs = 0;
  let grandTotalMs = 0;
  let netTotalMs = 0;
  let totalSubtaskCount = 0;

  projectData.primaryTasks.forEach(pt => {
    totalSubtaskCount += pt.subtasks.length;
    const activeSubtasksMs = activeUnionMs(pt);

    let toMs = 0, delMs = 0;
    pt.timeOuts.forEach(to => { if (to.deleted) delMs += to.durationMs; else toMs += to.durationMs; });

    totalActiveMs += activeSubtasksMs;
    totalTOMs += toMs;
    const ptGross = pt.currentDuration || (activeSubtasksMs + toMs);
    grandTotalMs += ptGross;
    netTotalMs += Math.max(0, ptGross - delMs);
  });

  document.getElementById('statPrimaryCount').innerText = `${projectData.primaryTasks.length} / 15`;
  document.getElementById('statSecondaryCount').innerText = totalSubtaskCount;
  document.getElementById('statTotalActive').innerText = formatDuration(totalActiveMs);
  document.getElementById('statTotalTO').innerText = formatDuration(totalTOMs);
  document.getElementById('statGrandTotal').innerText = formatDuration(grandTotalMs);
  document.getElementById('statNet').innerText = formatDuration(netTotalMs);

  if (!fullRebuild) {
    // Actualización rápida sin reconstruir el DOM: totales y barras de las tareas en curso
    projectData.primaryTasks.forEach(pt => {
      const live = pt.running || pt.subtasks.some(s => s.running);
      const maxDur = Math.max(pt.currentDuration, 1000);
      const ptTotalEl = document.getElementById(`total_pt_${pt.id}`);
      if (ptTotalEl && !ptTotalEl.querySelector("input")) ptTotalEl.innerText = formatDuration(pt.currentDuration);
      if (live) {
        const bar = document.getElementById(`pbar_${pt.id}`);
        if (bar) bar.innerHTML = renderPrimaryTimelineSegments(pt, maxDur);
        const endEl = document.getElementById(`pend_${pt.id}`);
        if (endEl) endEl.innerText = formatDuration(pt.currentDuration, false);
      }
      pt.subtasks.forEach(st => {
        const stTotalEl = document.getElementById(`total_st_${st.id}`);
        if (stTotalEl && !stTotalEl.querySelector("input")) stTotalEl.innerText = formatDuration(st.currentDuration);
        if (live) {
          const sb = document.getElementById(`sbar_${st.id}`);
          if (sb) sb.innerHTML = renderSubtaskBar(st, maxDur);
        }
      });
    });
    return;
  }

  saveState();
  container.innerHTML = '';

  projectData.primaryTasks.forEach((pt, pIdx) => {
    const card = document.createElement('div');
    card.className = 'primary-task-card';

    // Duración total de referencia para escala gráfica (en ms)
    const maxPrimaryDuration = Math.max(pt.currentDuration, 1000);

    // Header de la Tarea Primaria con botón de Add Secondary Task
    card.innerHTML = `
      <div class="primary-task-header">
        <span class="primary-badge">TAREA PRINCIPAL ${pt.code}</span>
        <div class="primary-actions">
          <button class="btn btn-secondary-add" onclick="addSecondaryTask('${pt.id}')">+ Agregar Subtarea (Máx. 20)</button>
          <button class="btn btn-danger" style="padding: 2px 8px; font-size:11px;" onclick="removePrimaryTask('${pt.id}')">✕ Eliminar</button>
        </div>
      </div>

      <!-- Fila de la Tarea Principal (Primary Task) -->
      <div class="timeline-row">
        <div class="row-controls">
          <span class="row-idx">${pt.code}</span>
          <button class="btn btn-start ${pt.running ? 'running' : ''}" onclick="startPrimaryTask('${pt.id}')">${startLabel(pt)}</button>
          <button class="btn btn-end" onclick="endPrimaryTask('${pt.id}')">Detener</button>
        </div>
        <div class="row-name-group">
          <input type="text" class="row-name-input" value="${escapeAttr(pt.name)}" oninput="updatePrimaryName('${pt.id}', this.value)" onchange="updatePrimaryName('${pt.id}', this.value)">
          <div class="row-notes-wrapper">
            <span class="row-notes-label">Notas:</span>
            <input type="text" class="row-notes-input" placeholder="Ej: Esta tarea solo aplica para el chasis 1.2" value="${escapeAttr(pt.notes)}" oninput="updatePrimaryNotes('${pt.id}', this.value)" onchange="updatePrimaryNotes('${pt.id}', this.value)">
          </div>
        </div>
        
        <!-- Línea de tiempo Principal Compuesta -->
        <div class="timeline-visual-area">
          <div style="font-size: 10px; font-weight: bold; position: absolute; left: 0; top: -14px;">0.00</div>
          <div class="primary-timeline-bar-container" id="pbar_${pt.id}">
            ${renderPrimaryTimelineSegments(pt, maxPrimaryDuration)}
          </div>
          <div id="pend_${pt.id}" style="font-size: 10px; font-weight: bold; position: absolute; right: 0; top: -14px;">
            ${formatDuration(pt.currentDuration, false)}
          </div>
        </div>

        <div class="row-right-actions">
          ${timeBox('pt', pt.id, '', pt.currentDuration, pt.editMode && !pt.running)}
          <div class="edit-time-controls">
            <button class="btn btn-edit-time ${pt.editMode ? 'active' : ''}" onmousedown="event.preventDefault()" onclick="togglePrimaryEdit('${pt.id}')" title="Activar/Desactivar edición de tiempo">Edit</button>
            <div class="step-buttons">
              <button class="btn btn-step btn-step-inc" ${pt.editMode ? '' : 'disabled'} onmousedown="event.preventDefault()" onclick="adjustPrimaryTime('${pt.id}', 1, event)" title="Incrementar (+0.01 s · Alt +0.1 s · Shift +1 s)" aria-label="Incrementar tiempo">+</button>
              <button class="btn btn-step btn-step-dec" ${pt.editMode ? '' : 'disabled'} onmousedown="event.preventDefault()" onclick="adjustPrimaryTime('${pt.id}', -1, event)" title="Disminuir (-0.01 s · Alt -0.1 s · Shift -1 s)" aria-label="Disminuir tiempo">−</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Filas de Tareas Secundarias Anidadas -->
      <div class="subtasks-list">
        ${pt.subtasks.map((st, sIdx) => `
          <div class="timeline-row">
            <div class="row-controls">
              <span class="row-idx">${st.code}</span>
              <button class="btn btn-start ${st.running ? 'running' : ''}" onclick="startSubtask('${pt.id}', '${st.id}')">${startLabel(st)}</button>
              <button class="btn btn-end" onclick="endSubtask('${pt.id}', '${st.id}')">Detener</button>
              <button class="btn btn-danger btn-mini" onclick="removeSubtask('${pt.id}', '${st.id}')" title="Eliminar subtarea" aria-label="Eliminar subtarea">✕</button>
            </div>
            <div class="row-name-group">
              <input type="text" class="row-name-input" value="${escapeAttr(st.name)}" oninput="updateSubtaskName('${pt.id}', '${st.id}', this.value)" onchange="updateSubtaskName('${pt.id}', '${st.id}', this.value)">
              <div class="row-notes-wrapper">
                <span class="row-notes-label">Notas:</span>
                <input type="text" class="row-notes-input" placeholder="Agregar nota o comentario..." value="${escapeAttr(st.notes)}" oninput="updateSubtaskNotes('${pt.id}', '${st.id}', this.value)" onchange="updateSubtaskNotes('${pt.id}', '${st.id}', this.value)">
              </div>
            </div>
            
            <!-- Barra Verde de Subtarea posicionada proporcionalmente -->
            <div class="timeline-visual-area">
              <div class="subtask-time-track" id="sbar_${st.id}">
                ${renderSubtaskBar(st, maxPrimaryDuration)}
              </div>
            </div>

            <div class="row-right-actions">
              ${timeBox('st', pt.id, st.id, st.currentDuration, st.editMode && !st.running)}
              <div class="edit-time-controls">
                <button class="btn btn-edit-time ${st.editMode ? 'active' : ''}" onmousedown="event.preventDefault()" onclick="toggleSubtaskEdit('${pt.id}', '${st.id}')" title="Activar/Desactivar edición de tiempo">Edit</button>
                <div class="step-buttons">
                  <button class="btn btn-step btn-step-inc" ${st.editMode ? '' : 'disabled'} onmousedown="event.preventDefault()" onclick="adjustSubtaskTime('${pt.id}', '${st.id}', 1, event)" title="Incrementar (+0.01 s · Alt +0.1 s · Shift +1 s)" aria-label="Incrementar tiempo">+</button>
                  <button class="btn btn-step btn-step-dec" ${st.editMode ? '' : 'disabled'} onmousedown="event.preventDefault()" onclick="adjustSubtaskTime('${pt.id}', '${st.id}', -1, event)" title="Disminuir (-0.01 s · Alt -0.1 s · Shift -1 s)" aria-label="Disminuir tiempo">−</button>
                </div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Selector para Eliminar / Gestionar Time Out (TO) -->
      <div class="timeout-management-row">
        <label style="font-weight: bold; font-size: 12px; color: #475569;">Excluir / restaurar Time Out:</label>
        <select class="to-select" onchange="toggleTimeOutDeleted('${pt.id}', this.value)">
          <option value="">-- Seleccionar TO para excluir/incluir --</option>
          ${pt.timeOuts.map(to => `
            <option value="${to.id}">
              ${to.label} (${formatDuration(to.durationMs, false)}) ${to.deleted ? '[ELIMINADO]' : '[ACTIVO]'}
            </option>
          `).join('')}
        </select>
        <span style="font-size: 11px; color: #64748b;">(o haz clic directamente en el bloque amarillo TO de la barra)</span>
      </div>
    `;

    container.appendChild(card);
  });
}

// Generación de los bloques de la barra principal (Amarillo TO + Celeste Activo)
function renderPrimaryTimelineSegments(pt, totalDuration) {
  if (totalDuration <= 0) return '<div class="time-segment segment-active" style="width: 100%;">00:00.00</div>';

  let segmentsHtml = '';

  // Dibujar los TOs
  pt.timeOuts.forEach(to => {
    const leftPct = Math.min((to.startOffsetMs / totalDuration) * 100, 98);
    const widthPct = Math.min(Math.max((to.durationMs / totalDuration) * 100, 2), 100 - leftPct);
    segmentsHtml += `
      <div class="time-segment segment-to ${to.deleted ? 'deleted' : ''}" onclick="toggleTimeOutDeleted('${pt.id}','${to.id}')"
           style="cursor: pointer; position: absolute; left: ${leftPct}%; width: ${widthPct}%;" 
           title="${to.label}: ${formatDuration(to.durationMs, false)} ${to.deleted ? '(Excluido)' : ''}">
        ${to.label}
      </div>
    `;
  });

  // Dibujar los bloques de subtareas activas en celeste
  pt.subtasks.forEach(st => {
    const dur = st.currentDuration || st.durationMs;
    if (dur > 0) {
      const leftPct = Math.min((st.startOffsetMs / totalDuration) * 100, 98);
      const widthPct = Math.min(Math.max((dur / totalDuration) * 100, 2), 100 - leftPct);
      segmentsHtml += `
        <div class="time-segment segment-active" 
             style="position: absolute; left: ${leftPct}%; width: ${widthPct}%;" 
             title="${escapeAttr(st.name)}: ${formatDuration(dur, false)}">
        </div>
      `;
    }
  });

  return segmentsHtml;
}

// Generación de la barra verde para cada subtarea
function renderSubtaskBar(st, totalDuration) {
  const dur = st.currentDuration || st.durationMs;
  if (dur <= 0) return '';

  const leftPct = Math.min((st.startOffsetMs / totalDuration) * 100, 97);
  const widthPct = Math.min(Math.max((dur / totalDuration) * 100, 3), 100 - leftPct);

  return `
    <div class="subtask-bar" 
         style="position: absolute; left: ${leftPct}%; width: ${widthPct}%;"
         title="${escapeAttr(st.name)} - Duración: ${formatDuration(dur, false)}">
      ${escapeAttr(st.name)}
    </div>
    <!-- Línea conectoras con marcas de tiempo en el inicio y fin -->
    <div class="guide-line-start" style="left: ${leftPct}%; top: -14px; height: 14px;"></div>
    <span class="guide-timestamp" style="left: ${leftPct}%; top: -2px;">${formatDuration(st.startOffsetMs, false)}</span>
    <div class="guide-line-end" style="left: ${leftPct + widthPct}%; top: -14px; height: 14px;"></div>
    <span class="guide-timestamp" style="left: ${leftPct + widthPct}%; top: -2px;">${formatDuration(st.startOffsetMs + dur, false)}</span>
  `;
}

// Modificadores de Nombres y Notas
function updatePrimaryName(id, val) {
  const pt = projectData.primaryTasks.find(p => p.id === id);
  if (pt) pt.name = val; saveState();
}
function updatePrimaryNotes(id, val) {
  const pt = projectData.primaryTasks.find(p => p.id === id);
  if (pt) pt.notes = val; saveState();
}
function updateSubtaskName(primaryId, subtaskId, val) {
  const pt = projectData.primaryTasks.find(p => p.id === primaryId);
  if (!pt) return;
  const st = pt.subtasks.find(s => s.id === subtaskId);
  if (st) st.name = val; saveState();
}
function updateSubtaskNotes(primaryId, subtaskId, val) {
  const pt = projectData.primaryTasks.find(p => p.id === primaryId);
  if (!pt) return;
  const st = pt.subtasks.find(s => s.id === subtaskId);
  if (st) st.notes = val; saveState();
}
function removePrimaryTask(id) {
  if (confirm('¿Eliminar esta tarea principal y todas sus tareas secundarias?')) {
    projectData.primaryTasks = projectData.primaryTasks.filter(p => p.id !== id);
    renumber();
    renderApp();
  }
}

function removeSubtask(primaryId, subtaskId) {
  const pt = projectData.primaryTasks.find(p => p.id === primaryId);
  if (!pt || !confirm('¿Eliminar esta subtarea?')) return;
  pt.subtasks = pt.subtasks.filter(st => st.id !== subtaskId);
  renumber();
  recalculateTimeoutsAndTimeline(pt);
  renderApp();
}

/* ---------- v3.1: edición manual de HH : mm : ss . cc ---------- */
function timeBox(kind, pid, sid, ms, editable) {
  const id = kind === 'pt' ? `total_pt_${pid}` : `total_st_${sid}`;
  if (!editable) return `<div class="row-total-box font-mono" id="${id}">${formatDuration(ms)}</div>`;
  const t = Math.floor(Math.max(0, ms) / 10), sec = Math.floor(t / 100);
  const v = [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60, t % 100];
  const lab = ['horas', 'minutos', 'segundos', 'centésimas'];
  const inp = v.map((n, i) => `<input type="text" inputmode="numeric" class="time-part" maxlength="${i ? 2 : 3}" value="${String(n).padStart(2, '0')}" aria-label="${lab[i]}" onfocus="this.select()" onkeydown="timeKey(event)">`);
  return `<div class="row-total-box font-mono time-edit" id="${id}" onfocusout="commitTime(event,'${kind}','${pid}','${sid}')">${inp[0]}:${inp[1]}:${inp[2]}.${inp[3]}</div>`;
}
function timeKey(e) {
  if (e.key === 'Enter') e.target.blur();
  else if (e.key === 'Escape') { window._skipCommit = true; renderApp(); window._skipCommit = false; }
}
function commitTime(e, kind, pid, sid) {
  if (window._skipCommit || e.currentTarget.contains(e.relatedTarget)) return; // Esc o Tab dentro del mismo campo
  applyTimeFromBox(e.currentTarget, kind, pid, sid);
}
// Aplica lo escrito en el campo de tiempo (si lo hay) antes de salir de Edit o pulsar +/-
function commitPending(kind, pid, sid) {
  const box = document.getElementById(kind === 'pt' ? `total_pt_${pid}` : `total_st_${sid}`);
  if (box && box.querySelector('input')) applyTimeFromBox(box, kind, pid, sid);
}
function applyTimeFromBox(box, kind, pid, sid) {
  const inputs = [...box.querySelectorAll('input')];
  const p = inputs.map(x => Math.max(0, parseInt(x.value, 10) || 0));
  const target = ((p[0] * 60 + Math.min(p[1], 59)) * 60 + Math.min(p[2], 59)) * 1000 + Math.min(p[3], 99) * 10;
  const pt = projectData.primaryTasks.find(x => x.id === pid);
  if (!pt) return;
  let cur, st = null;
  if (kind === 'pt') {
    cur = pt.currentDuration || 0;
    pt.subtasks.forEach(s => { cur = Math.max(cur, s.startOffsetMs + (s.currentDuration || s.durationMs || 0)); });
  } else {
    st = pt.subtasks.find(x => x.id === sid);
    if (!st) return;
    cur = st.currentDuration || st.durationMs || 0;
  }
  const delta = target - cur;
  if (delta === 0) { // sin cambios: solo normalizar el formato mostrado
    const sh = Math.floor(cur / 10), ss = Math.floor(sh / 100);
    [Math.floor(ss / 3600), Math.floor(ss / 60) % 60, ss % 60, sh % 100].forEach((n, i) => { inputs[i].value = String(n).padStart(2, '0'); });
    return;
  }
  if (kind === 'pt') adjustPrimaryTime(pid, delta > 0 ? 1 : -1, null, Math.abs(delta));
  else adjustSubtaskTime(pid, sid, delta > 0 ? 1 : -1, null, Math.abs(delta));
}

/* ========================================================
 * MOTORES DE EXPORTACIÓN (EXCEL, POWERPOINT, PDF)
 * ======================================================== */

/**
 * Guarda un archivo abriendo la ventana nativa de "Guardar como" del sistema operativo,
 * permitiendo al usuario seleccionar la carpeta en su equipo (Mi PC) y elegir el nombre del archivo.
 *
 * @param {Blob} blob - Contenido binario del archivo
 * @param {string} suggestedName - Nombre sugerido por defecto
 * @param {Array} types - Filtros de formato para el explorador de archivos
 */
async function saveFileWithPicker(blob, suggestedName, types) {
  // 1. Intentar con File System Access API (Abre la ventana nativa "Guardar como" de Windows / SO)
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedName,
        types: types || []
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      // Si el usuario canceló la selección de guardado, no hacer nada
      if (err.name === 'AbortError') {
        return false;
      }
      console.warn('showSaveFilePicker no completado o restringido, pasando a método alternativo:', err);
    }
  }

  // 1b. iOS/iPadOS: hoja Compartir con el archivo (permite "Guardar en Archivos", AirDrop, correo, etc.)
  try {
    const file = new File([blob], suggestedName, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: suggestedName });
      return true;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return false;
    console.warn('navigator.share no disponible o sin gesto de usuario, usando descarga directa:', err);
    // Si el gesto del usuario caducó (exportación lenta), descargar directamente sin prompt
    const u = URL.createObjectURL(blob);
    const a2 = document.createElement('a');
    a2.href = u; a2.download = suggestedName;
    document.body.appendChild(a2); a2.click(); document.body.removeChild(a2);
    setTimeout(() => URL.revokeObjectURL(u), 10000);
    return true;
  }

  // 2. Método alternativo si el navegador no tiene soporte directo para showSaveFilePicker:
  // Permitir al usuario ingresar el nombre que desee
  const fileNamePrompt = prompt('Guardar como - Ingrese el nombre con el que desea guardar el archivo:', suggestedName);
  if (fileNamePrompt === null) {
    return false; // El usuario canceló
  }

  let finalName = fileNamePrompt.trim() || suggestedName;
  const extMatch = suggestedName.match(/\.[0-9a-z]+$/i);
  if (extMatch && !finalName.toLowerCase().endsWith(extMatch[0].toLowerCase())) {
    finalName += extMatch[0];
  }

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => window.URL.revokeObjectURL(url), 10000);
  return true;
}

// Alias para abrir el modal selector de exportación a Excel
function exportToExcel() {
  openExportModal();
}

// 1.A. Exportar en MODO TABLA (.xlsx)
async function exportToExcelTable() {
  // Sincronizar tiempos en ejecución si hay cronómetros activos
  const now = Date.now();
  projectData.primaryTasks.forEach(pt => {
    if (pt.running) {
      pt.currentDuration = (pt.accumulatedTime || 0) + (now - pt.startTime);
    }
    pt.subtasks.forEach(st => {
      if (st.running) {
        st.currentDuration = (st.accumulatedTime || 0) + (now - st.startTime);
      }
    });
    recalculateTimeoutsAndTimeline(pt);
  });

  // Si ExcelJS está disponible, generar hoja estilizada profesional
  try { await loadLib('exceljs.min.js'); } catch (e) { alert('No se pudo cargar la biblioteca de Excel.'); return; }
  if (typeof ExcelJS !== 'undefined') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Time Line Project';
    const ws = workbook.addWorksheet('Reporte de Tiempos', { views: [{ showGridLines: true }] });

    // Título y Metadatos
    ws.mergeCells('A1:F1');
    const title = ws.getCell('A1');
    title.value = 'TIME LINE - REPORTE DE TIEMPOS Y RUTA CRÍTICA (PMI / PMBOK)';
    title.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FF1E293B' } };
    ws.getRow(1).height = 25;

    ws.mergeCells('A2:F2');
    const sub = ws.getCell('A2');
    sub.value = `Fecha de Generación: ${new Date().toLocaleString()} | Estándar WBS/PMBOK`;
    sub.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: 'FF64748B' } };
    ws.getRow(2).height = 18;

    // Encabezados de Tabla
    const headers = ['Código', 'Nombre de Tarea', 'Notas / Comentarios', 'Tipo de Tarea', 'Inicio Relativo', 'Duración [h]:mm:ss.00', 'Estado / Time Outs'];
    const headerRow = ws.getRow(4);
    headerRow.values = headers;
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF1D4ED8' } },
        bottom: { style: 'thin', color: { argb: 'FF1D4ED8' } },
        left: { style: 'thin', color: { argb: 'FF1D4ED8' } },
        right: { style: 'thin', color: { argb: 'FF1D4ED8' } }
      };
    });

    let rowIdx = 5;
    const borderCell = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };

    projectData.primaryTasks.forEach(pt => {
      // Fila Primaria
      const pRow = ws.getRow(rowIdx++);
      pRow.values = [
        pt.code,
        pt.name,
        pt.notes || '-',
        'Tarea Principal',
        0,
        pt.currentDuration / 86400000,
        `TOs: ${pt.timeOuts.length} (${pt.timeOuts.filter(t => t.deleted).length} excluidos)`
      ];
      pRow.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      pRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      pRow.eachCell(c => { c.border = borderCell; });
      pRow.getCell(1).alignment = { horizontal: 'center' };
      pRow.getCell(5).alignment = { horizontal: 'center' };
      pRow.getCell(6).alignment = { horizontal: 'center' };

      // Subtareas
      pt.subtasks.forEach(st => {
        const sRow = ws.getRow(rowIdx++);
        const dur = st.currentDuration || st.durationMs;
        sRow.values = [
          st.code,
          '    ' + st.name,
          st.notes || '-',
          'Tarea Secundaria',
          st.startOffsetMs / 86400000,
          dur / 86400000,
          st.running ? 'EN EJECUCIÓN' : (dur > 0 ? 'COMPLETADA' : 'SIN INICIAR')
        ];
        sRow.font = { name: 'Segoe UI', size: 9, color: { argb: 'FF334155' } };
        sRow.eachCell(c => { c.border = borderCell; });
        sRow.getCell(1).alignment = { horizontal: 'center' };
        sRow.getCell(5).alignment = { horizontal: 'center' };
        sRow.getCell(6).alignment = { horizontal: 'center' };
      });

      // Time Outs
      pt.timeOuts.forEach(to => {
        const toRow = ws.getRow(rowIdx++);
        toRow.values = [
          'TO',
          `    Time Out ${to.label}`,
          '-',
          'Tiempo Muerto (TO)',
          to.startOffsetMs / 86400000,
          to.durationMs / 86400000,
          to.deleted ? 'EXCLUIDO DE RUTA' : 'ACTIVO'
        ];
        toRow.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: to.deleted ? 'FF94A3B8' : 'FFD97706' } };
        toRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: to.deleted ? 'FFF8FAFC' : 'FFFFFBEB' } };
        toRow.eachCell(c => { c.border = borderCell; });
        toRow.getCell(1).alignment = { horizontal: 'center' };
        toRow.getCell(5).alignment = { horizontal: 'center' };
        toRow.getCell(6).alignment = { horizontal: 'center' };
      });

      rowIdx++; // Fila vacía entre tareas principales
    });

    // Tiempos como valores numéricos de Excel (sirven para fórmulas, filtros y sumas)
    ws.eachRow((row, n) => {
      if (n < 5) return;
      [5, 6].forEach(c => { const cell = row.getCell(c); if (typeof cell.value === 'number') cell.numFmt = '[h]:mm:ss.00'; });
    });

    // Autoajustar columnas
    ws.getColumn(1).width = 12; // Código
    ws.getColumn(2).width = 28; // Nombre
    ws.getColumn(3).width = 32; // Notas
    ws.getColumn(4).width = 20; // Tipo
    ws.getColumn(5).width = 18; // Inicio
    ws.getColumn(6).width = 22; // Duración
    ws.getColumn(7).width = 25; // Estado

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await saveFileWithPicker(blob, `TimeLine_Tabla_${Date.now()}.xlsx`, [
      {
        description: 'Libro de Excel (*.xlsx)',
        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
      }
    ]);
    return;
  }

  // Fallback con XLSX clásico si ExcelJS no está cargado
  if (typeof XLSX !== 'undefined') {
    const rows = [
      ['TIME LINE - REPORTE DE TIEMPOS Y RUTA CRÍTICA'],
      ['Fecha de Generación:', new Date().toLocaleString()],
      [],
      ['Código', 'Nombre de Tarea', 'Notas / Comentarios', 'Tipo', 'Inicio Relativo', 'Duración Total [h]:mm:ss.00', 'Estado / TOs']
    ];

    projectData.primaryTasks.forEach(pt => {
      rows.push([
        pt.code, 
        pt.name, 
        pt.notes || '-',
        'Tarea Principal', 
        '00:00:00.00', 
        formatDuration(pt.currentDuration),
        `TOs: ${pt.timeOuts.length} (${pt.timeOuts.filter(t => t.deleted).length} excluidos)`
      ]);

      pt.subtasks.forEach(st => {
        rows.push([
          st.code,
          st.name,
          st.notes || '-',
          'Tarea Secundaria',
          formatDuration(st.startOffsetMs),
          formatDuration(st.currentDuration || st.durationMs),
          '-'
        ]);
      });

      pt.timeOuts.forEach(to => {
        rows.push([
          '-',
          `Time Out ${to.label}`,
          '-',
          'Tiempo Muerto (TO)',
          formatDuration(to.startOffsetMs),
          formatDuration(to.durationMs),
          to.deleted ? 'EXCLUIDO' : 'ACTIVO'
        ]);
      });

      rows.push([]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'TimeLine');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await saveFileWithPicker(blob, `TimeLine_Tabla_${Date.now()}.xlsx`, [
      {
        description: 'Libro de Excel (*.xlsx)',
        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
      }
    ]);
  }
}

// 1.B. Exportar en MODO DIAGRAMA GANTT VISUAL (.xlsx)
async function exportToExcelGantt() {
  try { await loadLib('exceljs.min.js'); } catch (e) { alert('No se pudo cargar la biblioteca de Excel.'); return; }

  // Sincronizar tiempos en ejecución
  const now = Date.now();
  projectData.primaryTasks.forEach(pt => {
    if (pt.running) {
      pt.currentDuration = (pt.accumulatedTime || 0) + (now - pt.startTime);
    }
    pt.subtasks.forEach(st => {
      if (st.running) {
        st.currentDuration = (st.accumulatedTime || 0) + (now - st.startTime);
      }
    });
    recalculateTimeoutsAndTimeline(pt);
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Time Line App';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Diagrama Gantt', {
    views: [{ showGridLines: true }]
  });

  // Configurar anchos de columna base
  ws.getColumn(1).width = 3;  // A: Margen
  ws.getColumn(2).width = 6;  // B: Código WBS (1.0, 1.1)
  ws.getColumn(3).width = 3;  // C: Espaciador
  ws.getColumn(4).width = 3;  // D: Espaciador
  ws.getColumn(5).width = 24; // E: Nombre de Tarea
  ws.getColumn(6).width = 16; // F: Label adicional

  const NUM_COLS = 60; // 60 columnas para la cuadrícula temporal
  const START_COL = 7; // Columna G (col 7)
  const END_COL = START_COL + NUM_COLS - 1; // Columna BN (col 66)
  const TOTAL_COL = END_COL + 2; // Columna BP (col 68)

  // Columnas compactas para simular bloques gráficos idénticos a Excel
  for (let c = START_COL; c <= END_COL; c++) {
    ws.getColumn(c).width = 3.2;
  }
  ws.getColumn(END_COL + 1).width = 3; // Separador
  ws.getColumn(TOTAL_COL).width = 18; // Columna TOTAL

  // Título Superior
  ws.mergeCells('B1:J1');
  const titleCell = ws.getCell('B1');
  titleCell.value = 'TIME LINE - CRONOGRAMA GANTT Y CONTROL TEMPORAL';
  titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FF0F172A' } };

  ws.mergeCells('B2:H2');
  const dateCell = ws.getCell('B2');
  dateCell.value = `Generado: ${new Date().toLocaleString()} | Metodología PMI / CPM`;
  dateCell.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: 'FF64748B' } };

  let currentRow = 4;

  const thinBorder = {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
  };

  const darkBorder = {
    top: { style: 'thin', color: { argb: 'FF0F172A' } },
    left: { style: 'thin', color: { argb: 'FF0F172A' } },
    bottom: { style: 'thin', color: { argb: 'FF0F172A' } },
    right: { style: 'thin', color: { argb: 'FF0F172A' } }
  };

  projectData.primaryTasks.forEach((pt) => {
    // Determinar la duración total del bloque
    let maxSubtaskEnd = 0;
    pt.subtasks.forEach(st => {
      const dur = st.currentDuration || st.durationMs;
      maxSubtaskEnd = Math.max(maxSubtaskEnd, st.startOffsetMs + dur);
    });
    let maxTOEnd = 0;
    pt.timeOuts.forEach(to => {
      maxTOEnd = Math.max(maxTOEnd, to.startOffsetMs + to.durationMs);
    });

    const totalDuration = Math.max(pt.currentDuration, maxSubtaskEnd, maxTOEnd, 1000);

    // Construir lista cronológica unificada de todos los bloques (TOs y Subtareas)
    const segments = [];
    pt.subtasks.forEach(st => {
      const dur = st.currentDuration || st.durationMs;
      if (dur > 0 || st.startOffsetMs > 0) {
        segments.push({
          type: 'SUB',
          id: st.id,
          code: st.code,
          name: st.name,
          startMs: st.startOffsetMs,
          endMs: st.startOffsetMs + dur,
          dur: dur,
          stRef: st
        });
      }
    });

    pt.timeOuts.forEach(to => {
      segments.push({
        type: 'TO',
        id: to.id,
        label: to.label,
        startMs: to.startOffsetMs,
        endMs: to.startOffsetMs + to.durationMs,
        dur: to.durationMs,
        deleted: to.deleted,
        toRef: to
      });
    });

    // Ordenar cronológicamente por tiempo de inicio y fin
    segments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

    // Mapeo proporcional exacto a límites de columna (sin traslapes ni desfases)
    function timeToBoundary(ms) {
      const ratio = Math.max(0, Math.min(1, ms / totalDuration));
      return START_COL + Math.round(ratio * NUM_COLS);
    }

    let prevEndCol = START_COL - 1;
    segments.forEach((seg, i) => {
      let sCol;
      if (i === 0 || seg.startMs === 0) {
        sCol = START_COL;
      } else if (Math.abs(seg.startMs - segments[i - 1].endMs) < 50) {
        // Estrictamente contiguo al segmento anterior: inicia en la columna siguiente
        sCol = prevEndCol + 1;
      } else {
        sCol = Math.max(prevEndCol + 1, timeToBoundary(seg.startMs));
      }

      let targetEndCol = timeToBoundary(seg.endMs) - 1;
      let eCol;
      if (i === segments.length - 1 || seg.endMs >= totalDuration) {
        eCol = END_COL;
      } else {
        eCol = Math.max(sCol, targetEndCol);
      }

      eCol = Math.min(END_COL, Math.max(sCol, eCol));
      seg.sCol = sCol;
      seg.eCol = eCol;
      prevEndCol = eCol;
    });

    // 1. Fila de Marcas Superiores de Tiempo (00:00 y fin)
    const timeRow = currentRow;
    const startMark = ws.getCell(timeRow, START_COL);
    startMark.value = '00:00:00.00';
    startMark.font = { name: 'Segoe UI', size: 8, bold: true, color: { argb: 'FF475569' } };
    startMark.alignment = { horizontal: 'left', vertical: 'bottom' };

    const endMark = ws.getCell(timeRow, END_COL);
    endMark.value = formatDuration(totalDuration);
    endMark.font = { name: 'Segoe UI', size: 8, bold: true, color: { argb: 'FF475569' } };
    endMark.alignment = { horizontal: 'right', vertical: 'bottom' };

    // 2. Fila de Etiquetas de TO y Cabecera TOTAL
    const labelRow = currentRow + 1;
    const nameHdr = ws.getCell(labelRow, 5);
    nameHdr.value = 'NAME';
    nameHdr.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF475569' } };
    nameHdr.alignment = { horizontal: 'center', vertical: 'middle' };

    const totalHdr = ws.getCell(labelRow, TOTAL_COL);
    totalHdr.value = 'TOTAL';
    totalHdr.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF0F172A' } };
    totalHdr.alignment = { horizontal: 'center', vertical: 'middle' };

    // Etiquetas TO centradas exactamente sobre su bloque amarillo
    segments.filter(s => s.type === 'TO').forEach(toSeg => {
      const toLabelCell = ws.getCell(labelRow, toSeg.sCol);
      toLabelCell.value = toSeg.label + (toSeg.deleted ? ' [x]' : '');
      toLabelCell.font = { name: 'Segoe UI', size: 8, bold: true, color: { argb: toSeg.deleted ? 'FF94A3B8' : 'FFB45309' } };
      toLabelCell.alignment = { horizontal: 'center', vertical: 'bottom' };
    });

    // 3. Fila de la Barra Principal (Bloques Celestes de actividad y Bloques Amarillos de TO sin traslape)
    const barRow = currentRow + 2;
    ws.getRow(barRow).height = 24;

    const codeCell = ws.getCell(barRow, 2);
    codeCell.value = pt.code;
    codeCell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    codeCell.alignment = { horizontal: 'center', vertical: 'middle' };

    const nameCell = ws.getCell(barRow, 5);
    nameCell.value = pt.name;
    nameCell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF0F172A' } };
    nameCell.alignment = { horizontal: 'left', vertical: 'middle' };
    nameCell.border = thinBorder;
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

    const nameLabelCell = ws.getCell(barRow, 6);
    nameLabelCell.value = '';
    nameLabelCell.font = { name: 'Segoe UI', size: 8, italic: true, color: { argb: 'FF64748B' } };
    nameLabelCell.alignment = { horizontal: 'left', vertical: 'middle' };

    // Si no hay segmentos, inicializar barra vacía
    if (segments.length === 0) {
      for (let c = START_COL; c <= END_COL; c++) {
        const barCell = ws.getCell(barRow, c);
        barCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        barCell.border = darkBorder;
      }
    } else {
      // Dibujar cada segmento exactamente en su rango de columnas [sCol, eCol]
      segments.forEach(seg => {
        const isTO = seg.type === 'TO';
        const fillArgb = isTO 
          ? (seg.deleted ? 'FFE2E8F0' : 'FFFFC000') // Amarillo Time Out o Gris si eliminado
          : 'FF38BDF8';                              // Celeste Activo

        for (let c = seg.sCol; c <= seg.eCol; c++) {
          const barCell = ws.getCell(barRow, c);
          barCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
          barCell.border = darkBorder;
          if (isTO && c === seg.sCol) {
            barCell.value = seg.label;
            barCell.font = { name: 'Segoe UI', size: 7, bold: true, color: { argb: seg.deleted ? 'FF94A3B8' : 'FF78350F' } };
            barCell.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        }
      });
    }

    // TOTAL Tarea Principal
    const primaryTotalCell = ws.getCell(barRow, TOTAL_COL);
    primaryTotalCell.value = formatDuration(totalDuration);
    primaryTotalCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    primaryTotalCell.alignment = { horizontal: 'center', vertical: 'middle' };
    primaryTotalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    primaryTotalCell.border = darkBorder;

    // 4. Fila de Conectores y Marcas de Tiempo a 90° en los cortes exactos (+ Notes de la tarea primaria debajo de su nombre)
    const connRow = currentRow + 3;
    ws.getRow(connRow).height = 42;

    if (pt.notes) {
      const ptNoteCell = ws.getCell(connRow, 5);
      ptNoteCell.value = `Notes: ${pt.notes}`;
      ptNoteCell.font = { name: 'Segoe UI', size: 8, italic: true, color: { argb: 'FF475569' } };
      ptNoteCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    }

    const usedCutCols = new Set();
    segments.forEach(seg => {
      // Marca en el inicio del segmento
      if (seg.sCol > START_COL && !usedCutCols.has(seg.sCol)) {
        usedCutCols.add(seg.sCol);
        const stampCell = ws.getCell(connRow, seg.sCol);
        stampCell.value = formatDuration(seg.startMs, false);
        stampCell.font = { name: 'Segoe UI', size: 7, bold: true, color: { argb: 'FF475569' } };
        stampCell.alignment = { textRotation: 90, horizontal: 'center', vertical: 'top' };
        stampCell.border = { left: { style: 'thin', color: { argb: 'FF0F172A' } } };
      }
    });

    // 5. Filas de Tareas Secundarias en Cascada (Barras Verdes que coinciden 100% con la barra principal)
    let currentSubRow = currentRow + 4;
    pt.subtasks.forEach(st => {
      const dur = st.currentDuration || st.durationMs;
      ws.getRow(currentSubRow).height = 20;

      const stCodeCell = ws.getCell(currentSubRow, 2);
      stCodeCell.value = st.code;
      stCodeCell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF475569' } };
      stCodeCell.alignment = { horizontal: 'center', vertical: 'middle' };

      const stNameCell = ws.getCell(currentSubRow, 5);
      stNameCell.value = st.name;
      stNameCell.font = { name: 'Segoe UI', size: 9, color: { argb: 'FF1E293B' } };
      stNameCell.alignment = { horizontal: 'left', vertical: 'middle' };
      stNameCell.border = thinBorder;

      const subSeg = segments.find(s => s.type === 'SUB' && s.id === st.id);
      if (subSeg && subSeg.sCol && subSeg.eCol) {
        const sCol = subSeg.sCol;
        const eCol = subSeg.eCol;

        if (sCol > START_COL) {
          const preCell = ws.getCell(currentSubRow, sCol - 1);
          preCell.value = st.name;
          preCell.font = { name: 'Segoe UI', size: 8, color: { argb: 'FF64748B' } };
          preCell.alignment = { horizontal: 'right', vertical: 'middle' };
        }

        for (let c = sCol; c <= eCol; c++) {
          const barCell = ws.getCell(currentSubRow, c);
          barCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };
          barCell.border = {
            top: { style: 'thin', color: { argb: 'FF16A34A' } },
            bottom: { style: 'thin', color: { argb: 'FF16A34A' } },
            left: c === sCol ? { style: 'thin', color: { argb: 'FF0F172A' } } : undefined,
            right: c === eCol ? { style: 'thin', color: { argb: 'FF0F172A' } } : undefined
          };
          if (c === sCol) {
            barCell.value = st.name;
            barCell.font = { name: 'Segoe UI', size: 8, bold: true, color: { argb: 'FF14532D' } };
            barCell.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        }
      }

      // TOTAL Subtarea
      const stTotalCell = ws.getCell(currentSubRow, TOTAL_COL);
      stTotalCell.value = formatDuration(dur);
      stTotalCell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF0F172A' } };
      stTotalCell.alignment = { horizontal: 'center', vertical: 'middle' };
      stTotalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      stTotalCell.border = thinBorder;

      // Fila debajo del nombre de la subtarea para Notes y líneas guía
      currentSubRow++;
      ws.getRow(currentSubRow).height = st.notes ? 15 : 8;
      if (st.notes) {
        const stNoteCell = ws.getCell(currentSubRow, 5);
        stNoteCell.value = `Notes: ${st.notes}`;
        stNoteCell.font = { name: 'Segoe UI', size: 8, italic: true, color: { argb: 'FF64748B' } };
        stNoteCell.alignment = { horizontal: 'left', vertical: 'middle' };
      }
      if (subSeg && subSeg.sCol && subSeg.eCol) {
        ws.getCell(currentSubRow, subSeg.sCol).border = { left: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
        ws.getCell(currentSubRow, subSeg.eCol).border = { right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
      }
      currentSubRow++;
    });

    // 6. Fila de Gestión Delete Time Out
    const toRow = currentSubRow;
    const toLabel = ws.getCell(toRow, 5);
    toLabel.value = 'Delete Time Out';
    toLabel.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF475569' } };
    toLabel.alignment = { horizontal: 'left', vertical: 'middle' };

    const toVal = ws.getCell(toRow, 6);
    toVal.value = pt.timeOuts.length > 0 
      ? pt.timeOuts.map(t => `${t.label}${t.deleted ? ' (Excluido)' : ''}`).join(', ') 
      : 'Sin TOs registrados';
    toVal.font = { name: 'Segoe UI', size: 8, italic: true, color: { argb: 'FF64748B' } };
    toVal.border = thinBorder;

    // Espacio antes de la siguiente tarea principal
    currentRow = toRow + 3;
  });

  // Generar y guardar archivo Excel
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  await saveFileWithPicker(blob, `TimeLine_Gantt_${Date.now()}.xlsx`, [
    {
      description: 'Libro de Excel (*.xlsx)',
      accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
    }
  ]);
}

// 2. Exportar a PDF
async function exportToPDF() {
  try { await loadLib(LIB_PDF); await loadLib(LIB_AUTOTABLE); } catch (e) { alert('No se pudo cargar la biblioteca PDF .'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');

  doc.setFontSize(16);
  doc.text('Time Line - Reporte Ejecutivo de Tiempos', 14, 15);
  doc.setFontSize(10);
  doc.text(`Fecha: ${new Date().toLocaleString()} | Metodología PMI/PMBOK`, 14, 22);

  const tableData = [];
  projectData.primaryTasks.forEach(pt => {
    tableData.push([pt.code, pt.name, pt.notes || '-', 'Principal', '00:00:00.00', formatDuration(pt.currentDuration), pt.running ? 'En ejecución' : 'Detenida']);
    pt.subtasks.forEach(st => {
      tableData.push([st.code, st.name, st.notes || '-', 'Secundaria', formatDuration(st.startOffsetMs), formatDuration(st.currentDuration), st.running ? 'En ejecución' : (st.currentDuration > 0 ? 'Completada' : 'Sin iniciar')]);
    });
    pt.timeOuts.forEach(to => {
      tableData.push(['TO', to.label, '-', 'Time Out', formatDuration(to.startOffsetMs), formatDuration(to.durationMs), to.deleted ? 'Excluido' : 'Activo']);
    });
  });

  doc.autoTable({
    head: [['Código', 'Nombre', 'Notas', 'Tipo', 'Inicio Relativo', 'Duración [h]:mm:ss.00', 'Estado']],
    body: tableData,
    startY: 28,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [37, 99, 235] }
  });

  const blob = doc.output('blob');
  await saveFileWithPicker(blob, `TimeLine_Report_${Date.now()}.pdf`, [
    {
      description: 'Documento PDF (*.pdf)',
      accept: { 'application/pdf': ['.pdf'] }
    }
  ]);
}

// 3. Exportar a PowerPoint (.pptx)
async function exportToPPT() {
  try { await loadLib(LIB_PPTX); } catch (e) { alert('No se pudo cargar la biblioteca PPTX .'); return; }

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  // Diapositiva 1: Título
  const slide1 = pptx.addSlide();
  slide1.addText('Time Line Project', { x: 1, y: 1.5, fontSize: 32, bold: true, color: '1e293b' });
  slide1.addText('Reporte de Cronometraje, Subtareas y Time Outs (PMI / PMBOK)', { x: 1, y: 2.3, fontSize: 16, color: '64748b' });
  slide1.addText(`Fecha de Generación: ${new Date().toLocaleString()}`, { x: 1, y: 3.0, fontSize: 12, color: '94a3b8' });

  const hdr = ['Código', 'Tarea', 'Notas', 'Tipo', 'Inicio', 'Duración'].map(t => ({ text: t, options: { bold: true, fill: '2563eb', color: 'ffffff' } }));
  const body = [];
  projectData.primaryTasks.forEach(pt => {
    body.push([pt.code, pt.name, pt.notes || '-', 'Principal', '00:00:00.00', formatDuration(pt.currentDuration)]);
    pt.subtasks.forEach(st => body.push([st.code, st.name, st.notes || '-', 'Secundaria', formatDuration(st.startOffsetMs), formatDuration(st.currentDuration)]));
    pt.timeOuts.forEach(to => body.push(['TO', to.label + (to.deleted ? ' (excluido)' : ''), '-', 'Time Out', formatDuration(to.startOffsetMs), formatDuration(to.durationMs)]));
  });
  // Paginado: 12 filas por diapositiva
  for (let i = 0; i < Math.max(body.length, 1); i += 12) {
    const sl = pptx.addSlide();
    sl.addText(`Desglose de Tiempos y Tareas (${Math.floor(i / 12) + 1})`, { x: 0.5, y: 0.4, fontSize: 20, bold: true, color: '1e293b' });
    sl.addTable([hdr, ...body.slice(i, i + 12)], { x: 0.5, y: 1.1, w: 12.3, colW: [1.0, 3.0, 3.0, 1.6, 1.7, 2.0], fontSize: 10 });
  }

  let blob = await pptx.write({ outputType: 'blob' });
  if (!(blob instanceof Blob)) {
    blob = new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  }

  await saveFileWithPicker(blob, `TimeLine_Presentation_${Date.now()}.pptx`, [
    {
      description: 'Presentación de PowerPoint (*.pptx)',
      accept: {
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx']
      }
    }
  ]);
}
