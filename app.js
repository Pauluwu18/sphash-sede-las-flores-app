let arrivals = [];
let lastSyncedReport = "";
const SUPABASE_URL = "https://yyhvpbgvmnhonyqzevfr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aHZwYmd2bW5ob255cXpldmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MTMwNTEsImV4cCI6MjEwNDk4OTA1MX0.V4bE69TXc7FuxogGhCszhN0O-9XF4jfoXGgYrYGY-i0";

function supabaseHeaders(extra = {}) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, ...extra };
}

function formatSupabaseRecord(record) {
  return { date: record.record_date, arrivals: record.arrivals || [], report: record.report || "", updated_at: record.updated_at };
}

function notifyAttendance(message) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification("SPLASH Control Operativo", { body: message, icon: "icon.png" });
}

async function attendanceFetch(path, options = {}) {
  const method = options.method || "GET";
  if (method === "GET") {
    const date = new URL(path, window.location.origin).searchParams.get("date");
    const filter = date ? `&record_date=eq.${encodeURIComponent(date)}` : "&order=record_date.desc";
    const response = await fetch(`${SUPABASE_URL}/rest/v1/daily_records?select=record_date,arrivals,report,updated_at${filter}`, { headers: supabaseHeaders() });
    if (!response.ok) return response;
    const records = await response.json();
    const payload = date ? (records[0] ? formatSupabaseRecord(records[0]) : null) : records.map(formatSupabaseRecord);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const record = JSON.parse(options.body || "{}");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/daily_records?on_conflict=record_date`, {
    method: "POST",
    headers: supabaseHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify([{ record_date: record.date, arrivals: record.arrivals, report: record.report }])
  });
  return response;
}

async function inventoryFetch(options = {}) {
  const method = options.method || "GET";
  if (method === "GET") {
    return fetch(`${SUPABASE_URL}/rest/v1/inventory?select=name,owner,borrower,non_operative,no_solution,updated_at&order=name.asc`, {
      headers: supabaseHeaders()
    });
  }
  const item = JSON.parse(options.body || "{}");
  return fetch(`${SUPABASE_URL}/rest/v1/inventory?on_conflict=name`, {
    method: "POST",
    headers: supabaseHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify([item])
  });
}

// Esta pagina no usa Service Worker; elimina cualquier registro/cache viejo que quede pegado en el navegador.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
}
if (window.caches) {
  caches.keys().then((names) => names.forEach((name) => caches.delete(name)));
}

const loginScreen = document.querySelector("#login-screen");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const welcomeMessage = document.querySelector("#welcome-message");

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const username = document.querySelector("#login-user").value.trim();
  const password = document.querySelector("#login-password").value;
  if (username === "admin" && password === "220501") {
    loginScreen.hidden = true;
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    welcomeMessage.classList.add("visible");
    window.setTimeout(() => welcomeMessage.classList.remove("visible"), 3000);
    document.querySelector("#person-name").focus();
    return;
  }
  loginMessage.textContent = "Usuario o contraseña incorrectos.";
});

const input = document.querySelector("#person-name");
const lateCheckbox = document.querySelector("#late-checkbox");
const form = document.querySelector("#arrival-form");
const formMessage = document.querySelector("#form-message");
const arrivalList = document.querySelector("#arrival-list");
const emptyState = document.querySelector("#empty-state");
const report = document.querySelector("#report");
const count = document.querySelector("#operator-count");
const copyButton = document.querySelector("#copy-button");
const copyMessage = document.querySelector("#copy-message");
const saveButton = document.querySelector("#save-button");
const historyButton = document.querySelector("#history-button");
const historyList = document.querySelector("#history-list");
const historyDialog = document.querySelector("#history-dialog");
const historyTitle = document.querySelector("#history-title");
const historySummary = document.querySelector("#history-summary");
const historyPeople = document.querySelector("#history-people");
const peopleRegisteredButton = document.querySelector("#people-registered-button");
const peopleDialog = document.querySelector("#people-dialog");
const peopleClose = document.querySelector("#people-close");
const peopleSearch = document.querySelector("#people-search");
const peopleList = document.querySelector("#people-list");
const personFirstName = document.querySelector("#person-first-name");
const personLastName = document.querySelector("#person-last-name");
const personAddButton = document.querySelector("#person-add-button");
const peopleResetButton = document.querySelector("#people-reset-button");
const missingDialog = document.querySelector("#missing-dialog");
const missingClose = document.querySelector("#missing-close");
const missingList = document.querySelector("#missing-list");
const missingCancelButton = document.querySelector("#missing-cancel-button");
const missingSaveButton = document.querySelector("#missing-save-button");
const editMissingButton = document.querySelector("#edit-missing-button");
const historyEditMissingButton = document.querySelector("#history-edit-missing-button");
const personNameSuggestions = document.querySelector("#person-name-suggestions");
const movementsDialog = document.querySelector("#movements-dialog");
const movementsClose = document.querySelector("#movements-close");
const allMovementsList = document.querySelector("#all-movements-list");
const movementsSearch = document.querySelector("#movements-search");
const exactTimeDialog = document.querySelector("#exact-time-dialog");
const exactTimeClose = document.querySelector("#exact-time-close");
const exactTimeNo = document.querySelector("#exact-time-no");
const exactTimeYes = document.querySelector("#exact-time-yes");
const historyAddButton = document.querySelector("#history-add-button");
const historyLoadButton = document.querySelector("#history-load-button");
const historyReport = document.querySelector("#history-report");
const dialogClose = document.querySelector("#dialog-close");
const copyHistoryButton = document.querySelector("#copy-history-button");
const shareHistoryButton = document.querySelector("#share-history-button");
const shareReportButton = document.querySelector("#share-report-button");
const refreshCurrentButton = document.querySelector("#refresh-current-button");
const historySearch = document.querySelector("#history-search");
const historyCalendar = document.querySelector("#history-calendar");
const historyResults = document.querySelector("#history-results");
const editDialog = document.querySelector("#edit-dialog");
const editForm = document.querySelector("#edit-form");
const editName = document.querySelector("#edit-name");
const editLate = document.querySelector("#edit-late");
const editService = document.querySelector("#edit-service");
const editClose = document.querySelector("#edit-close");
const toast = document.querySelector("#toast");
const toastText = document.querySelector("#toast-text");
let editingIndex = -1;
let editingSavedDate = null;
let loadedReportText = "";
let isEditingArrival = false;
let isInputFocused = false;
let inventory = [];
let registeredPeople = JSON.parse(localStorage.getItem("splash-registered-people") || "[]");
let pendingMissingNames = [];
let pendingMissingReasons = {};
let pendingSavePayload = null;
let currentHistoryRecord = null;
const inventoryTab = document.querySelector("#inventory-tab");
const inventoryDrawer = document.querySelector("#inventory-drawer");
const inventoryClose = document.querySelector("#inventory-close");
const inventoryAddToggle = document.querySelector("#inventory-add-toggle");
const inventoryForm = document.querySelector("#inventory-form");
const inventoryList = document.querySelector("#inventory-list");
const drawerMessage = document.querySelector("#drawer-message");
const menuToggle = document.querySelector("#menu-toggle");
const navigationDrawer = document.querySelector("#navigation-drawer");
const navigationClose = document.querySelector("#navigation-close");
const navigationBackdrop = document.querySelector("#navigation-backdrop");
const registerBaseArrival = document.querySelector("#register-base-arrival");
const baseMovements = document.querySelector("#base-movements");
const backupButton = document.querySelector("#backup-button");
const inventoryPageButton = document.querySelector("#inventory-page-button");
let toastTimer;

document.querySelector("#today").textContent = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
}).format(new Date());

function getName() {
  return input.value.trim();
}

function getPersonType() {
  return document.querySelector('input[name="person-type"]:checked').value;
}

function showMessage(message) {
  formMessage.textContent = message;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => { formMessage.textContent = ""; }, 3000);
}

function showToast(message) {
  toastText.textContent = message;
  toast.classList.remove("visible");
  window.clearTimeout(toastTimer);
  void toast.offsetWidth;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3000);
}

function getDate() {
  return document.querySelector("#today").textContent;
}

function getTime() {
  return new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

function normalizePersonName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function buildFullPersonName(firstName, lastName) {
  const first = normalizePersonName(firstName);
  const last = normalizePersonName(lastName);
  return last ? `${first} ${last}` : first;
}

function persistRegisteredPeople() {
  localStorage.setItem("splash-registered-people", JSON.stringify(registeredPeople));
}

function addRegisteredPerson(name) {
  const normalized = normalizePersonName(name);
  if (!normalized) return false;
  if (!registeredPeople.some((person) => person.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
    registeredPeople.push(normalized);
    registeredPeople.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
    persistRegisteredPeople();
    renderPersonSuggestions();
    renderRegisteredPeople(peopleSearch.value);
    return true;
  }
  return false;
}

function removeRegisteredPerson(index) {
  if (!Number.isInteger(index) || !registeredPeople[index]) return;
  registeredPeople.splice(index, 1);
  persistRegisteredPeople();
  renderPersonSuggestions();
  renderRegisteredPeople(peopleSearch.value);
}

function resetRegisteredPeople() {
  if (!registeredPeople.length) return;
  if (!window.confirm("¿Restablecer la lista completa de personas registradas?")) return;
  registeredPeople = [];
  localStorage.removeItem("splash-registered-people");
  renderPersonSuggestions();
  renderRegisteredPeople(peopleSearch.value);
  showToast("Lista de personas restablecida.");
}

function renderPersonSuggestions(query = "") {
  const search = normalizePersonName(query).toLocaleLowerCase();
  const items = [...new Set(registeredPeople.map((person) => normalizePersonName(person)).filter(Boolean))]
    .filter((name) => !search || name.toLocaleLowerCase().includes(search))
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  personNameSuggestions.innerHTML = items.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
}

function renderRegisteredPeople(searchTerm = "") {
  const query = normalizePersonName(searchTerm).toLocaleLowerCase();
  const filtered = query
    ? registeredPeople.filter((person) => person.toLocaleLowerCase().includes(query))
    : registeredPeople;
  peopleList.innerHTML = filtered.length
    ? filtered.map((person, index) => `<div class="people-item"><div class="people-item-name"><span>${escapeHtml(person)}</span></div><div class="people-item-actions"><button type="button" data-person-use="${index}">Usar</button><button type="button" class="people-delete" data-person-delete="${index}">Eliminar</button></div></div>`).join("")
    : '<p class="people-empty">No hay personas registradas todavía.</p>';
}

async function getInventory() {
  const response = await inventoryFetch();
  if (!response.ok) throw new Error("No se pudo consultar el inventario");
  return response.json();
}

async function saveInventoryItem(item) {
  const response = await inventoryFetch({ method: "POST", body: JSON.stringify(item) });
  if (!response.ok) throw new Error("No se pudo guardar la herramienta");
}

async function getSavedRecords() {
  const response = await attendanceFetch("/api/records");
  if (!response.ok) throw new Error("No se pudo consultar el historial");
  return response.json();
}

function buildReport() {
  return buildReportFor(arrivals, getDate());
}

function buildReportFor(people, date) {
  if (!people.length) return "";
  const sections = [];
  const operators = people.filter((arrival) => arrival.type === "Operario");
  const trainees = people.filter((arrival) => arrival.type === "Capacitado");
  if (operators.length) sections.push(`*operarios*\n${formatArrivals(operators)}`);
  if (trainees.length) sections.push(`*Capacitados*\n${formatArrivals(trainees)}`);
  return `${date}\n${sections.join("\n")}`;
}

function formatArrivals(people) {
  return people.map((arrival, index) => `${index + 1}. ${arrival.name}${arrival.late ? "(tarde)" : ""}${arrival.active === false ? " (fuera de servicio)" : ""}`).join("\n");
}

function render() {
  arrivalList.innerHTML = "";
  arrivals.forEach((arrival, index) => {
    const item = document.createElement("li");
    item.className = "arrival-item";
    const active = arrival.active !== false;
    item.innerHTML = `<span class="arrival-name">${escapeHtml(arrival.name)} <small class="person-type">${escapeHtml(arrival.type)}</small>${arrival.late ? '<span class="late-label">(tarde)</span>' : ""}</span><button class="service-switch ${active ? "active" : "inactive"}" type="button" data-service-index="${index}" aria-pressed="${active}" aria-label="${active ? "Sigue en servicio" : "Ya no esta en servicio"}" title="Cambiar estado de servicio"><span aria-hidden="true"></span></button><button class="edit-button" type="button" data-edit-index="${index}" aria-label="Editar a ${escapeHtml(arrival.name)}" title="Editar registro">&#9998;</button><button class="remove-button" type="button" data-index="${index}" aria-label="Eliminar a ${escapeHtml(arrival.name)}" title="Eliminar registro">&times;</button>`;
    arrivalList.append(item);
  });
  count.textContent = arrivals.length;
  emptyState.hidden = arrivals.length > 0;
  report.textContent = loadedReportText || buildReport();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

function appendMissingReport(reportText, entries) {
  const reportable = entries.filter(([, choice]) => choice !== "ok");
  if (!reportable.length) return reportText || "";
  const section = `*Faltas*\n${reportable.map(([name, choice], index) => `${index + 1}. ${name}(${choice === "falta" ? "falta" : "justificado"})`).join("\n")}`;
  return reportText ? `${reportText.trim()}\n\n${section}` : section;
}

function stripMissingReport(reportText) {
  return (reportText || "").replace(/\n*\*Faltas\*\n[\s\S]*$/, "").replace(/\s+$/, "");
}

function parseMissingReasons(reportText) {
  const match = /\*Faltas\*\n([\s\S]*)$/.exec(reportText || "");
  if (!match) return {};
  const reasons = {};
  match[1].split("\n").forEach((line) => {
    const lineMatch = /^\d+\.\s*(.+)\((falta|justificado)\)\s*$/.exec(line.trim());
    if (lineMatch) reasons[lineMatch[1].trim()] = lineMatch[2] === "falta" ? "falta" : "justificacion";
  });
  return reasons;
}

function getAutoMissingNames(savedArrivals) {
  return [...new Set(registeredPeople.map((person) => normalizePersonName(person)).filter(Boolean))].filter((name) => !savedArrivals.some((arrival) => normalizePersonName(arrival.name).toLocaleLowerCase() === normalizePersonName(name).toLocaleLowerCase()));
}

function refreshMissingSurveyIfOpen() {
  if (!missingDialog.open || !pendingMissingNames.length) return;
  const remainingNames = pendingMissingNames.filter((name) => !arrivals.some((arrival) => normalizePersonName(arrival.name).toLocaleLowerCase() === normalizePersonName(name).toLocaleLowerCase()));
  if (remainingNames.length === pendingMissingNames.length) return;
  Object.keys(pendingMissingReasons).forEach((name) => {
    if (!remainingNames.some((item) => normalizePersonName(item).toLocaleLowerCase() === normalizePersonName(name).toLocaleLowerCase())) {
      delete pendingMissingReasons[name];
    }
  });
  pendingMissingNames = remainingNames;
  if (!remainingNames.length) {
    missingDialog.close();
    finishMissingSurvey();
    return;
  }
  openMissingSurvey(remainingNames, pendingSavePayload);
}

function renderInventory() {
  inventoryList.innerHTML = inventory.length ? inventory.map((tool, index) => {
    const loaned = Boolean(tool.borrower);
    return `<article class="tool-card"><div class="tool-card-top"><div><div class="tool-name">${escapeHtml(tool.name)}</div>${tool.owner ? `<div class="tool-owner">Propietario: ${escapeHtml(tool.owner)}</div>` : ""}</div><span class="tool-status${loaned ? " loaned" : ""}">${loaned ? "Prestada" : "Disponible"}</span></div>${loaned ? `<div class="tool-owner">La lleva: ${escapeHtml(tool.borrower)}</div><button class="tool-action return" type="button" data-tool-return="${index}">Marcar como devuelta</button>` : `<div class="tool-loan"><input type="text" data-tool-borrower="${index}" placeholder="Nombre o número de operario" aria-label="Quién lleva ${escapeHtml(tool.name)}"><button class="tool-action" type="button" data-tool-loan="${index}">Registrar salida</button></div>`}</article>`;
  }).join("") : '<p class="inventory-empty">No hay herramientas registradas.</p>';
}

async function loadInventory() {
  try {
    inventory = await getInventory();
    renderInventory();
  } catch {
    inventoryList.innerHTML = '<p class="inventory-empty">Servidor no disponible.</p>';
  }
}

input.addEventListener("input", () => {
  renderPersonSuggestions(input.value);
});
input.addEventListener("focus", () => { isInputFocused = true; });
input.addEventListener("blur", () => { isInputFocused = false; });

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = getName();
  if (!name) {
    showMessage("Escribe el nombre de la persona.");
    return;
  }
  if (arrivals.some((arrival) => arrival.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showMessage("Esa persona ya fue registrada.");
    return;
  }
  const normalizedName = normalizePersonName(name);
  loadedReportText = "";
  addRegisteredPerson(normalizedName);
  arrivals.push({ name: normalizedName, type: getPersonType(), late: lateCheckbox.checked, active: true, arrivalTime: getTime(), departureTime: "" });
  refreshMissingSurveyIfOpen();
  input.value = "";
  lateCheckbox.checked = false;
  showMessage("");
  render();
  showToast(`${normalizedName} registrado correctamente.`);
  notifyAttendance(`Se registró la asistencia de ${normalizedName}.`);
});

arrivalList.addEventListener("click", (event) => {
  const serviceButton = event.target.closest("button[data-service-index]");
  if (serviceButton) {
    const index = Number(serviceButton.dataset.serviceIndex);
    arrivals[index].active = arrivals[index].active === false;
    render();
    return;
  }
  const editButton = event.target.closest("button[data-edit-index]");
  if (editButton) {
    openEdit(Number(editButton.dataset.editIndex));
    return;
  }
  const button = event.target.closest("button[data-index]");
  if (!button) return;
  arrivals.splice(Number(button.dataset.index), 1);
  render();
});

function closeNavigation() {
  navigationDrawer.classList.remove("open");
  navigationDrawer.setAttribute("aria-hidden", "true");
  menuToggle.setAttribute("aria-expanded", "false");
  navigationBackdrop.hidden = true;
}

menuToggle.addEventListener("click", () => {
  const open = navigationDrawer.classList.toggle("open");
  navigationDrawer.setAttribute("aria-hidden", String(!open));
  menuToggle.setAttribute("aria-expanded", String(open));
  navigationBackdrop.hidden = !open;
});

navigationClose.addEventListener("click", closeNavigation);
navigationBackdrop.addEventListener("click", closeNavigation);

registerBaseArrival.addEventListener("click", () => {
  closeNavigation();
  document.querySelector("#arrival-form").scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => input.focus(), 350);
});

function movementMarkup(arrival, date, index, editable) {
  const active = arrival.active !== false;
  const action = !editable ? '<span class="movement-readonly">Solo lectura</span>' : arrival.departureTime ? `<button class="movement-undo" type="button" data-movement-undo="true" data-movement-date="${escapeHtml(date)}" data-movement-index="${index}">Deshacer salida</button>` : `<button class="movement-exit" type="button" data-movement-date="${escapeHtml(date)}" data-movement-index="${index}">Registrar salida</button>`;
  return `<div class="movement-item"><div><strong>${escapeHtml(arrival.name)}</strong><small>${escapeHtml(arrival.type)}</small></div><span class="movement-service ${active ? "active" : "inactive"}">${active ? "En servicio" : "Servicio terminado"}</span><div class="movement-times"><span class="movement-arrival">Llegada <b>${escapeHtml(arrival.arrivalTime || "--:--")}</b></span><span class="movement-departure">Salida <b>${escapeHtml(arrival.departureTime || "Pendiente")}</b></span></div>${action}</div>`;
}

function renderAllMovements(records) {
  const filter = movementsSearch.value.trim().toLocaleLowerCase();
  const filteredRecords = records.map((record) => ({ ...record, arrivals: (record.arrivals || []).filter((arrival) => !filter || `${arrival.name} ${arrival.type} ${record.date}`.toLocaleLowerCase().includes(filter)) })).filter((record) => record.arrivals.length && (record.date === getDate() || filter));
  allMovementsList.innerHTML = filteredRecords.length ? filteredRecords.map((record) => `<section class="movement-log"><div class="movement-heading"><div><p class="section-kicker">${record.date === getDate() ? "Registro de hoy" : "Registro anterior"}</p><h3>${escapeHtml(record.date)}</h3></div><span class="movement-note">${record.date === getDate() ? "Editable" : "Solo lectura"}</span></div><div class="movement-list">${record.arrivals.map((arrival) => movementMarkup(arrival, record.date, (record.arrivals || []).indexOf(arrival), record.date === getDate())).join("")}</div></section>`).join("") : '<p class="movement-empty">No hay servicios de hoy que coincidan.</p>';
}

function openPeopleDialog() {
  renderRegisteredPeople();
  peopleDialog.showModal();
}

function openMissingSurvey(missingNames, savePayload) {
  pendingMissingNames = missingNames;
  pendingSavePayload = savePayload;
  missingList.innerHTML = missingNames.map((name) => {
    const choice = pendingMissingReasons[name];
    return `
    <div class="missing-person">
      <div><strong>${escapeHtml(name)}</strong></div>
      <div class="missing-actions">
        <button type="button" class="missing-falta${choice === "falta" ? " active" : ""}" data-missing-name="${encodeURIComponent(name)}" data-missing-choice="falta">Falta</button>
        <button type="button" class="missing-justificacion${choice === "justificacion" ? " active" : ""}" data-missing-name="${encodeURIComponent(name)}" data-missing-choice="justificacion">Justificación</button>
      </div>
    </div>
  `;
  }).join("");
  missingDialog.showModal();
}

function finishMissingSurvey() {
  if (!pendingSavePayload) return;
  const { savedArrivals, savedReport, date } = pendingSavePayload;
  const targetDate = date || getDate();
  const entries = Object.entries(pendingMissingReasons)
    .filter(([name]) => !savedArrivals.some((arrival) => normalizePersonName(arrival.name).toLocaleLowerCase() === normalizePersonName(name).toLocaleLowerCase()))
    .map(([name, choice]) => [name, choice]);
  const finalReport = entries.length ? appendMissingReport(savedReport, entries) : savedReport;
  pendingMissingNames = [];
  pendingMissingReasons = {};
  pendingSavePayload = null;
  missingDialog.close();
  if (targetDate === getDate()) {
    submitSavedRecord(savedArrivals, finalReport);
  } else {
    saveHistoricalReport(targetDate, savedArrivals, finalReport);
  }
}

function registerMissingChoice(name, choice) {
  pendingMissingReasons[name] = pendingMissingReasons[name] === choice ? undefined : choice;
  if (pendingMissingReasons[name] === undefined) delete pendingMissingReasons[name];
  openMissingSurvey(pendingMissingNames, pendingSavePayload);
}

function cancelMissingSurvey() {
  const editedDate = pendingSavePayload && pendingSavePayload.date !== getDate() ? pendingSavePayload.date : null;
  missingDialog.close();
  pendingMissingNames = [];
  pendingMissingReasons = {};
  pendingSavePayload = null;
  if (editedDate) getTodayRecordByDate(editedDate);
}

let movementRecords = [];
movementsSearch.addEventListener("input", () => renderAllMovements(movementRecords));

function askExactTime() {
  return new Promise((resolve) => {
    const finish = (answer) => {
      exactTimeDialog.close();
      resolve(answer);
    };
    exactTimeYes.onclick = () => finish("exact");
    exactTimeNo.onclick = () => finish("ok");
    exactTimeClose.onclick = () => finish(false);
    exactTimeDialog.showModal();
  });
}

baseMovements.addEventListener("click", async () => {
  closeNavigation();
  try {
    movementRecords = await getSavedRecords();
    movementsSearch.value = "";
    renderAllMovements(movementRecords);
    movementsDialog.showModal();
  } catch {
    showToast("No se pudieron cargar las llegadas y salidas.");
  }
});

peopleRegisteredButton.addEventListener("click", () => {
  closeNavigation();
  openPeopleDialog();
});

peopleClose.addEventListener("click", () => peopleDialog.close());
peopleSearch.addEventListener("input", (event) => renderRegisteredPeople(event.target.value));

personAddButton.addEventListener("click", () => {
  const firstName = normalizePersonName(personFirstName.value);
  const lastName = normalizePersonName(personLastName.value);
  const fullName = buildFullPersonName(firstName, lastName);
  if (!fullName) {
    showToast("Escribe al menos el nombre.");
    personFirstName.focus();
    return;
  }
  if (registeredPeople.some((person) => person.toLocaleLowerCase() === fullName.toLocaleLowerCase())) {
    showToast("Esa persona ya está registrada.");
    return;
  }
  registeredPeople.push(fullName);
  registeredPeople.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  persistRegisteredPeople();
  renderPersonSuggestions();
  renderRegisteredPeople(peopleSearch.value);
  personFirstName.value = "";
  personLastName.value = "";
  personFirstName.focus();
  showToast("Persona agregada.");
});

peopleResetButton.addEventListener("click", resetRegisteredPeople);

peopleList.addEventListener("click", (event) => {
  const useButton = event.target.closest("[data-person-use]");
  if (useButton) {
    const index = Number(useButton.dataset.personUse);
    const selectedName = registeredPeople[index];
    if (!selectedName) return;
    input.value = selectedName;
    input.focus();
    peopleDialog.close();
    return;
  }
  const deleteButton = event.target.closest("[data-person-delete]");
  if (!deleteButton) return;
  const index = Number(deleteButton.dataset.personDelete);
  if (!Number.isInteger(index) || !registeredPeople[index]) return;
  if (!window.confirm(`¿Eliminar a ${registeredPeople[index]} de la lista?`)) return;
  removeRegisteredPerson(index);
});

missingClose.addEventListener("click", cancelMissingSurvey);
missingCancelButton.addEventListener("click", cancelMissingSurvey);
missingSaveButton.addEventListener("click", finishMissingSurvey);

historyEditMissingButton.addEventListener("click", () => {
  if (!currentHistoryRecord) return;
  const { arrivals: savedArrivals, report, date } = currentHistoryRecord;
  const missingNames = getAutoMissingNames(savedArrivals);
  if (!missingNames.length) {
    showToast("No hay personas faltantes para justificar en esta fecha.");
    return;
  }
  pendingMissingReasons = parseMissingReasons(report);
  historyDialog.close();
  openMissingSurvey(missingNames, { savedArrivals, savedReport: stripMissingReport(report), date });
});

missingList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-missing-choice]");
  if (!button) return;
  const name = decodeURIComponent(button.dataset.missingName || "");
  const choice = button.dataset.missingChoice;
  if (!name || !choice) return;
  registerMissingChoice(name, choice);
});

backupButton.addEventListener("click", async () => {
  closeNavigation();
  try {
    const response = await fetch("/api/backup");
    if (!response.ok) throw new Error("No se pudo crear la copia");
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `respaldo-asistencia-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    showToast("Copia de seguridad descargada.");
  } catch {
    showToast("No se pudo crear la copia de seguridad.");
  }
});

inventoryPageButton.addEventListener("click", () => {
  closeNavigation();
  window.location.href = "/inventory.html";
});

movementsClose.addEventListener("click", () => movementsDialog.close());
movementsDialog.addEventListener("click", (event) => {
  if (event.target === movementsDialog) movementsDialog.close();
});

inventoryTab.addEventListener("click", () => {
  closeNavigation();
  const open = inventoryDrawer.classList.toggle("open");
  inventoryDrawer.setAttribute("aria-hidden", String(!open));
  inventoryTab.setAttribute("aria-expanded", String(open));
  if (open) loadInventory();
});

inventoryClose.addEventListener("click", () => {
  inventoryDrawer.classList.remove("open");
  inventoryDrawer.setAttribute("aria-hidden", "true");
  inventoryTab.setAttribute("aria-expanded", "false");
});

inventoryAddToggle.addEventListener("click", () => {
  inventoryForm.hidden = !inventoryForm.hidden;
  if (!inventoryForm.hidden) document.querySelector("#tool-name").focus();
});

inventoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const item = { name: document.querySelector("#tool-name").value.trim(), owner: document.querySelector("#tool-owner").value.trim() };
  try {
    await saveInventoryItem(item);
    inventoryForm.reset();
    inventoryForm.hidden = true;
    drawerMessage.textContent = "Herramienta agregada.";
    loadInventory();
  } catch { drawerMessage.textContent = "No se pudo guardar el inventario."; }
});

inventoryList.addEventListener("click", async (event) => {
  const loanButton = event.target.closest("[data-tool-loan]");
  const returnButton = event.target.closest("[data-tool-return]");
  const index = Number((loanButton || returnButton)?.dataset.toolLoan ?? (returnButton?.dataset.toolReturn));
  if (!Number.isInteger(index) || !inventory[index]) return;
  const borrowerInput = loanButton?.previousElementSibling;
  const borrower = borrowerInput?.value.trim() || "";
  const updated = { ...inventory[index], borrower: returnButton ? "" : borrower };
  if (!returnButton && !borrower) { drawerMessage.textContent = "Escribe quién lleva la herramienta."; return; }
  try {
    await saveInventoryItem(updated);
    drawerMessage.textContent = returnButton ? "Herramienta marcada como devuelta." : "Salida registrada.";
    loadInventory();
  } catch { drawerMessage.textContent = "No se pudo actualizar la herramienta."; }
});

function openEdit(index) {
  const arrival = arrivals[index];
  if (!arrival) return;
  isEditingArrival = true;
  editingIndex = index;
  editingSavedDate = null;
  editName.value = arrival.name;
  document.querySelector(`input[name="edit-person-type"][value="${arrival.type}"]`).checked = true;
  editLate.checked = arrival.late;
  editService.checked = arrival.active !== false;
  editDialog.showModal();
}

editForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = editName.value.trim();
  if (!window.confirm("¿Confirmar los cambios de este registro?")) return;
  if (arrivals.some((arrival, index) => index !== editingIndex && arrival.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showToast("Esa persona ya fue registrada.");
    return;
  }
  const previousArrival = arrivals[editingIndex];
  const updatedArrival = { name, type: document.querySelector('input[name="edit-person-type"]:checked').value, late: editLate.checked, active: editService.checked, arrivalTime: previousArrival?.arrivalTime || getTime(), departureTime: previousArrival?.departureTime || "" };
  if (editingSavedDate) {
    updateSavedArrival(updatedArrival);
    return;
  }
  arrivals[editingIndex] = updatedArrival;
  editDialog.close();
  isEditingArrival = false;
  render();
  showToast("Registro actualizado.");
});

async function updateSavedArrival(updatedArrival) {
  try {
    const response = await attendanceFetch(`/api/records?date=${encodeURIComponent(editingSavedDate)}`);
    const record = await response.json();
    const savedArrivals = record.arrivals || [];
    if (savedArrivals.some((arrival, index) => index !== editingIndex && arrival.name.toLocaleLowerCase() === updatedArrival.name.toLocaleLowerCase())) {
      showToast("Esa persona ya fue registrada.");
      return;
    }
    savedArrivals[editingIndex] = { ...updatedArrival, arrivalTime: savedArrivals[editingIndex]?.arrivalTime || getTime(), departureTime: savedArrivals[editingIndex]?.departureTime || "" };
    const saveResponse = await attendanceFetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: editingSavedDate, arrivals: savedArrivals, report: buildReportFor(savedArrivals, editingSavedDate) }) });
    if (!saveResponse.ok) throw new Error("No se pudo actualizar");
    editDialog.close();
    showHistory({ arrivals: savedArrivals, report: buildReportFor(savedArrivals, editingSavedDate) }, editingSavedDate);
    renderHistory();
    showToast("Registro guardado actualizado.");
  } catch {
    showToast("No se pudo actualizar el registro.");
  }
}

editClose.addEventListener("click", () => { editDialog.close(); isEditingArrival = false; });
editDialog.addEventListener("click", (event) => {
  if (event.target === editDialog) { editDialog.close(); isEditingArrival = false; }
});

document.querySelector("#clear-button").addEventListener("click", () => {
  if (!arrivals.length || window.confirm("¿Eliminar todos los registros?")) {
    arrivals = [];
    loadedReportText = "";
    render();
  }
});

async function submitSavedRecord(savedArrivals, savedReport) {
  try {
    arrivals = savedArrivals.map((arrival) => ({ ...arrival, arrivalTime: arrival.arrivalTime || getTime(), departureTime: arrival.departureTime || "" }));
    loadedReportText = savedReport;
    const response = await attendanceFetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: getDate(), arrivals: arrivals, report: savedReport })
    });
    if (!response.ok) throw new Error("No se pudo guardar");
    lastSyncedReport = savedReport;
    render();
    showToast("Registro guardado correctamente.");
    renderHistory();
  } catch {
    showToast("No se pudo guardar. Comprueba que el servidor este activo.");
  }
}

saveButton.addEventListener("click", async () => {
  if (!arrivals.length) {
    copyMessage.textContent = "Registra al menos una persona antes de guardar.";
    return;
  }
  const savedReport = buildReport();
  const savedArrivals = arrivals.map((arrival) => ({ ...arrival, arrivalTime: arrival.arrivalTime || getTime(), departureTime: arrival.departureTime || "" }));
  const missingNames = getAutoMissingNames(savedArrivals);
  if (missingNames.length) {
    openMissingSurvey(missingNames, { savedArrivals, savedReport, date: getDate() });
    return;
  }
  await submitSavedRecord(savedArrivals, savedReport);
});

async function saveHistoricalReport(date, savedArrivals, savedReport) {
  try {
    const response = await attendanceFetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, arrivals: savedArrivals, report: savedReport })
    });
    if (!response.ok) throw new Error("No se pudo guardar");
    showHistory({ arrivals: savedArrivals, report: savedReport }, date);
    renderHistory();
    showToast("Faltas y justificaciones actualizadas.");
  } catch {
    showToast("No se pudo actualizar el registro.");
  }
}

editMissingButton.addEventListener("click", () => {
  if (!arrivals.length) {
    showToast("Registra al menos una persona antes de editar faltas.");
    return;
  }
  const savedArrivals = arrivals.map((arrival) => ({ ...arrival, arrivalTime: arrival.arrivalTime || getTime(), departureTime: arrival.departureTime || "" }));
  const missingNames = getAutoMissingNames(savedArrivals);
  if (!missingNames.length) {
    showToast("No hay personas faltantes para justificar hoy.");
    return;
  }
  const currentReport = loadedReportText || buildReport();
  pendingMissingReasons = parseMissingReasons(currentReport);
  openMissingSurvey(missingNames, { savedArrivals, savedReport: stripMissingReport(currentReport), date: getDate() });
});

historyButton.addEventListener("click", () => {
  const isHidden = historyList.hidden;
  historyList.hidden = !isHidden;
  historyButton.setAttribute("aria-expanded", String(isHidden));
  if (isHidden) renderHistory();
});

async function renderHistory() {
  try {
    const records = await getSavedRecords();
    const textFilter = historySearch.value.trim().toLocaleLowerCase();
    const calendarFilter = historyCalendar.value
      ? new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${historyCalendar.value}T00:00:00`))
      : "";
    records.forEach((record) => {
      (record.arrivals || []).forEach((arrival) => addRegisteredPerson(arrival.name));
    });
    const filteredRecords = records.filter((record) => {
      const matchesText = record.date.toLocaleLowerCase().includes(textFilter);
      const matchesCalendar = !calendarFilter || record.date === calendarFilter;
      return matchesText && matchesCalendar;
    });
    historyResults.innerHTML = filteredRecords.length ? filteredRecords.map((record) => {
    const savedArrivals = record.arrivals || [];
    const lateCount = savedArrivals.filter((arrival) => arrival.late).length;
    return `<button class="history-item" type="button" data-date="${escapeHtml(record.date)}"><span><span class="history-date">${escapeHtml(record.date)}</span><br><span class="history-count">${savedArrivals.length} llegada${savedArrivals.length === 1 ? "" : "s"}${lateCount ? ` · ${lateCount} tarde${lateCount === 1 ? "" : "s"}` : ""}</span></span><span aria-hidden="true">&#8250;</span></button>`;
    }).join("") : '<p class="history-empty">No hay fechas que coinciden.</p>';
  } catch {
    historyResults.innerHTML = '<p class="history-empty">Servidor no disponible.</p>';
  }
}

historySearch.addEventListener("input", renderHistory);
historyCalendar.addEventListener("input", renderHistory);

historyList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-date]");
  if (!item) return;
  getTodayRecordByDate(item.dataset.date);
});

async function getTodayRecordByDate(date) {
  try {
    const response = await attendanceFetch(`/api/records?date=${encodeURIComponent(date)}`);
    const record = await response.json();
    showHistory(record, date);
  } catch {
    showToast("No se pudo abrir el registro.");
  }
}

function showHistory(record, date) {
  const savedArrivals = record.arrivals || [];
  const lateCount = savedArrivals.filter((arrival) => arrival.late).length;
  currentHistoryRecord = { arrivals: savedArrivals, report: record.report, date };
  historyTitle.textContent = `Llegadas del ${date}`;
  historySummary.innerHTML = `<span class="summary-chip">${savedArrivals.length} registrada${savedArrivals.length === 1 ? "" : "s"}</span><span class="summary-chip late">${lateCount} tardanza${lateCount === 1 ? "" : "s"}</span>`;
  historyReport.textContent = record.report;
  historyPeople.innerHTML = savedArrivals.map((arrival, index) => `<div class="history-person" data-active="${arrival.active === false ? "false" : "true"}"><span>${escapeHtml(arrival.name)}${arrival.late ? " (tarde)" : ""}${arrival.active === false ? " (fuera de servicio)" : ""} <small class="person-type">${escapeHtml(arrival.type)}</small></span><button type="button" data-history-edit-index="${index}" aria-label="Editar a ${escapeHtml(arrival.name)}" title="Editar llegada">&#9998;</button></div>`).join("");
  historyPeople.dataset.date = date;
  historyLoadButton.dataset.report = record.report;
  copyHistoryButton.dataset.report = record.report;
  shareHistoryButton.dataset.report = record.report;
  historyDialog.showModal();
}

historyPeople.addEventListener("click", (event) => {
  const button = event.target.closest("[data-history-edit-index]");
  if (!button) return;
  const date = historyPeople.dataset.date;
  const recordPeople = [...historyPeople.querySelectorAll(".history-person")];
  const person = recordPeople[Number(button.dataset.historyEditIndex)];
  const text = person.querySelector("span").textContent;
  const savedType = text.includes("Capacitado") ? "Capacitado" : "Operario";
  editingIndex = Number(button.dataset.historyEditIndex);
  editingSavedDate = date;
  editName.value = text.replace(/ \(tarde\).*$/, "").replace(/ (Operario|Capacitado)$/, "").trim();
  document.querySelector(`input[name="edit-person-type"][value="${savedType}"]`).checked = true;
  editLate.checked = text.includes("(tarde)");
  editService.checked = person.dataset.active !== "false";
  editDialog.showModal();
});

allMovementsList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-movement-index]");
  if (!button) return;
  const date = button.dataset.movementDate;
  const index = Number(button.dataset.movementIndex);
  const undo = button.dataset.movementUndo === "true";
  const departureChoice = undo ? "undo" : await askExactTime();
  if (!departureChoice) return;
  try {
    const response = await attendanceFetch(`/api/records?date=${encodeURIComponent(date)}`);
    const record = await response.json();
    const savedArrivals = record.arrivals || [];
    if (!savedArrivals[index]) return;
    if (departureChoice === "undo") {
      savedArrivals[index].departureTime = "";
      savedArrivals[index].active = savedArrivals[index].activeBeforeDeparture !== false;
      delete savedArrivals[index].activeBeforeDeparture;
    } else {
      savedArrivals[index].activeBeforeDeparture = savedArrivals[index].active !== false;
      savedArrivals[index].active = false;
      savedArrivals[index].departureTime = departureChoice === "exact" ? getTime() : "OK";
    }
    const saveResponse = await attendanceFetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, arrivals: savedArrivals, report: record.report }) });
    if (!saveResponse.ok) throw new Error("No se pudo registrar la salida");
    movementRecords = await getSavedRecords();
    renderAllMovements(movementRecords);
    const personName = savedArrivals[index].name;
    if (departureChoice === "undo") {
      showToast("Salida deshecha correctamente.");
      notifyAttendance(`Se anuló la salida de ${personName}.`);
    } else {
      const departureTime = savedArrivals[index].departureTime;
      const message = departureTime === "OK"
        ? `Se registró la salida de ${personName}.`
        : `Se registró la salida de ${personName} a las ${departureTime}.`;
      showToast(message);
      notifyAttendance(message);
    }
  } catch {
    showToast("No se pudo registrar la salida.");
  }
});

historyAddButton.addEventListener("click", () => {
  editingSavedDate = historyPeople.dataset.date;
  editingIndex = historyPeople.querySelectorAll(".history-person").length;
  editName.value = "";
  document.querySelector('input[name="edit-person-type"][value="Operario"]').checked = true;
  editLate.checked = false;
  editService.checked = true;
  editDialog.showModal();
});

historyLoadButton.addEventListener("click", () => {
  const reportText = historyLoadButton.dataset.report || "";
  if (!reportText) {
    showToast("Selecciona un registro para cargar.");
    return;
  }
  loadedReportText = reportText;
  report.textContent = reportText;
  historyDialog.close();
  showToast("Registro cargado en el paso 2.");
});

dialogClose.addEventListener("click", () => historyDialog.close());
historyDialog.addEventListener("click", (event) => {
  if (event.target === historyDialog) historyDialog.close();
});

copyHistoryButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(copyHistoryButton.dataset.report || "");
    copyHistoryButton.textContent = "Registro copiado";
  } catch {
    copyHistoryButton.textContent = "No se pudo copiar";
  }
  window.setTimeout(() => { copyHistoryButton.innerHTML = '<span class="copy-icon" aria-hidden="true"></span> Copiar este registro'; }, 2000);
});

shareHistoryButton.addEventListener("click", () => {
  const reportText = shareHistoryButton.dataset.report || "";
  window.open(`https://wa.me/?text=${encodeURIComponent(reportText)}`, "_blank", "noopener,noreferrer");
});

shareReportButton.addEventListener("click", () => {
  const reportText = loadedReportText || buildReport();
  if (!reportText) {
    showToast("Registra al menos una persona antes de compartir.");
    return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(reportText)}`, "_blank", "noopener,noreferrer");
});

copyButton.addEventListener("click", async () => {
  const textToCopy = loadedReportText || buildReport();
  try {
    await navigator.clipboard.writeText(textToCopy);
    showToast("Texto copiado.");
  } catch {
    showToast("No se pudo copiar. Selecciona el texto manualmente.");
  }
  window.clearTimeout(copyMessage.timer);
  copyMessage.timer = window.setTimeout(() => { copyMessage.textContent = ""; }, 3000);
});

renderPersonSuggestions();
renderRegisteredPeople();
render();
renderHistory();

// ========== SINCRONIZACIÓN EN TIEMPO REAL ==========
let lastRecordSyncTime = 0;
let pushTimer = null;

async function autoPushRecord() {
  if (!arrivals.length && !loadedReportText) return;
  try {
    const response = await attendanceFetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: getDate(), arrivals: arrivals, report: loadedReportText || buildReport() })
    });
    if (!response.ok) throw new Error("No se pudo guardar");
    const updated = await attendanceFetch(`/api/records?date=${encodeURIComponent(getDate())}`).then((r) => r.json()).catch(() => null);
    if (updated?.updated_at) lastRecordSyncTime = new Date(updated.updated_at).getTime();
  } catch {
    // Silencioso: se reintentará en el siguiente cambio o polling
  }
}

function scheduleAutoPush() {
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(autoPushRecord, 1500);
}

// Enganchar auto-push a todos los cambios que modifican arrivals
const triggerPushAfterChange = () => scheduleAutoPush();
form.addEventListener("submit", triggerPushAfterChange, true);
arrivalList.addEventListener("click", triggerPushAfterChange, true);

// También auto-push cuando se cierra el diálogo de editar persona (después de cambios)
editDialog.addEventListener("close", () => { if (editingIndex >= 0) triggerPushAfterChange(); });

async function loadCurrentRecord(force = false) {
  if (!force && (isEditingArrival || isInputFocused || editDialog.open || missingDialog.open)) return;
  try {
    const response = await attendanceFetch(`/api/records?date=${encodeURIComponent(getDate())}`);
    if (!response.ok) throw new Error("No se pudo cargar");
    const record = await response.json();
    if (!record) return;

    const serverArrivals = record.arrivals || [];
    const serverReport = record.report || "";
    const serverTime = new Date(record.updated_at || 0).getTime();
    if (!force && serverTime <= lastRecordSyncTime) return;

    arrivals = serverArrivals.map((arrival) => ({ ...arrival, arrivalTime: arrival.arrivalTime || "", departureTime: arrival.departureTime || "" }));
    loadedReportText = serverReport;
    lastRecordSyncTime = serverTime;
    render();
    if (force) showToast("Registro del servidor cargado.");
  } catch {
    if (force) showToast("No se pudo cargar el registro del servidor.");
  }
}

refreshCurrentButton.addEventListener("click", () => {
  refreshCurrentButton.classList.add("spinning");
  loadCurrentRecord(true).finally(() => {
    window.setTimeout(() => refreshCurrentButton.classList.remove("spinning"), 400);
  });
});

// Cargar al iniciar y luego cada 3 segundos
loadCurrentRecord(true);
setInterval(() => loadCurrentRecord(false), 3000);
