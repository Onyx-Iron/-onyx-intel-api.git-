// Critical Path Method (CPM) scheduling engine
// Implements: Kahn topological sort, Forward Pass (ES/EF), Backward Pass (LS/LF),
// Total Float, Free Float, and Critical Path identification.

/**
 * Compute CPM for a list of tasks.
 * @param {Array} tasks - [{id, name, duration, deps:[id,...], ...}]
 * @returns {Array} - same tasks enriched with ES,EF,LS,LF,totalFloat,freeFloat,critical
 */
export function computeCPM(tasks) {
  if (!tasks || tasks.length === 0) return [];

  // Work on copies so we don't mutate input
  const byId = {};
  for (const t of tasks) byId[t.id] = { ...t };

  // Build adjacency list (pred → [succs]) and in-degree map
  const inDegree = {};
  const adj = {};
  for (const t of tasks) {
    inDegree[t.id] = inDegree[t.id] || 0;
    adj[t.id] = adj[t.id] || [];
    for (const dep of (t.deps || [])) {
      if (!byId[dep]) continue; // skip unknown dep refs
      adj[dep] = adj[dep] || [];
      adj[dep].push(t.id);
      inDegree[t.id] = (inDegree[t.id] || 0) + 1;
    }
  }

  // Kahn's algorithm — topological sort
  const queue = tasks.filter(t => (inDegree[t.id] || 0) === 0).map(t => t.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const succ of (adj[id] || [])) {
      if (--inDegree[succ] === 0) queue.push(succ);
    }
  }

  // If tasks remain unvisited, there's a cycle — append remaining in original order
  for (const t of tasks) {
    if (!order.includes(t.id)) order.push(t.id);
  }

  // Forward Pass: ES = max EF of all predecessors, EF = ES + duration
  for (const id of order) {
    const t = byId[id];
    const preds = (t.deps || []).filter(d => byId[d]);
    t.ES = preds.length > 0 ? Math.max(...preds.map(p => byId[p].EF ?? 0)) : 0;
    t.EF = t.ES + Math.max(1, t.duration || 1);
  }

  // Project duration = max EF across all tasks
  const projectEnd = Math.max(...Object.values(byId).map(t => t.EF || 0));

  // Backward Pass: LF = min LS of all successors, LS = LF - duration
  for (const id of [...order].reverse()) {
    const t = byId[id];
    const succs = (adj[id] || []).filter(s => byId[s]);
    t.LF = succs.length > 0 ? Math.min(...succs.map(s => byId[s].LS ?? projectEnd)) : projectEnd;
    t.LS = t.LF - Math.max(1, t.duration || 1);
  }

  // Total Float, Free Float, Critical Path flag
  for (const t of Object.values(byId)) {
    t.totalFloat = t.LS - t.ES;
    const succs = (adj[t.id] || []).filter(s => byId[s]);
    t.freeFloat = succs.length > 0
      ? Math.min(...succs.map(s => byId[s].ES ?? t.EF)) - t.EF
      : 0;
    t.critical = t.totalFloat === 0;
  }

  return order.map(id => byId[id]);
}

/**
 * Convert CPM working-day offsets to absolute calendar dates.
 * @param {Array} cpmTasks - Output of computeCPM()
 * @param {Date|string} projectStart - Absolute project start date
 * @returns {Array} - tasks with startDate, endDate, lsDate, lfDate as YYYY-MM-DD strings
 */
export function buildGanttData(cpmTasks, projectStart) {
  const base = projectStart instanceof Date ? projectStart : new Date(projectStart);
  return cpmTasks.map(t => ({
    ...t,
    startDate: addWorkingDays(base, t.ES).toISOString().slice(0, 10),
    endDate:   addWorkingDays(base, t.EF).toISOString().slice(0, 10),
    lsDate:    addWorkingDays(base, t.LS).toISOString().slice(0, 10),
    lfDate:    addWorkingDays(base, t.LF).toISOString().slice(0, 10),
  }));
}

/**
 * Add N working days (Mon–Fri) to a date. Negative N moves backward.
 */
export function addWorkingDays(date, n) {
  const d = new Date(date);
  if (n === 0) return d;
  let remaining = Math.abs(n);
  const step = n > 0 ? 1 : -1;
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d;
}

/**
 * Count working days between two dates (positive if b > a).
 */
export function workingDaysBetween(a, b) {
  const start = new Date(Math.min(+a, +b));
  const end   = new Date(Math.max(+a, +b));
  let count = 0;
  const d = new Date(start);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return +a <= +b ? count : -count;
}
