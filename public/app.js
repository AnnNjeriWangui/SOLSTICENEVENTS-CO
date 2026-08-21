/**
 * Solstice Events Co. - Kiosk Client Controller
 * 
 * Manages:
 * - Real-Time Server-Sent Events (SSE) stream
 * - Ticket scanning & duplicate error banners
 * - Dynamic Badge Renderer & Thermal Print Animation
 * - Real-Time Attendee Roster & Filter Tabs
 * - Live System Activity Feed & Telemetry
 * - Interactive Emerald Glow Action Feedback
 */

let attendees = [];
let currentFilter = "ALL";
let activePrintingAttendeeId = null;

// DOM Elements
const scanForm = document.getElementById("scan-form");
const ticketInput = document.getElementById("ticket-input");
const btnSubmitScan = document.getElementById("btn-submit-scan");
const statusAlert = document.getElementById("status-alert");
const presetButtonsContainer = document.getElementById("preset-buttons");
const attendeeListContainer = document.getElementById("attendee-list");
const terminalLogs = document.getElementById("terminal-logs");
const btnClearLogs = document.getElementById("btn-clear-logs");
const btnResetDb = document.getElementById("btn-reset-db");
const liveTimeDisplay = document.getElementById("live-time-display");

// Metrics
const statTotal = document.getElementById("stat-total");
const statChecked = document.getElementById("stat-checked");
const statPending = document.getElementById("stat-pending");
const statCheckedRate = document.getElementById("stat-checked-rate");

// Badge Elements
const badgeElement = document.getElementById("badge-element");
const badgeTier = document.getElementById("badge-tier");
const badgeAvatar = document.getElementById("badge-avatar");
const badgeName = document.getElementById("badge-name");
const badgeRole = document.getElementById("badge-role");
const badgeCompany = document.getElementById("badge-company");
const badgeTicketNum = document.getElementById("badge-ticket-num");
const printingOverlay = document.getElementById("printing-overlay");
const scanStatusTitle = document.getElementById("scan-status-title");
const scanStatusSub = document.getElementById("scan-status-sub");

// -----------------------------------------------------------------------------
// Live Clock
// -----------------------------------------------------------------------------
function updateLiveClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-KE", { hour12: false });
  if (liveTimeDisplay) {
    liveTimeDisplay.textContent = `${timeStr} EAT`;
  }
}
setInterval(updateLiveClock, 1000);
updateLiveClock();

// -----------------------------------------------------------------------------
// Interactive Emerald Glow Feedback
// -----------------------------------------------------------------------------
function triggerInteractiveFlash() {
  // Flash badge card
  if (badgeElement) {
    badgeElement.classList.remove("flash-emerald");
    void badgeElement.offsetWidth; // force reflow
    badgeElement.classList.add("flash-emerald");
  }

  // Flash ticket input
  if (ticketInput) {
    ticketInput.classList.remove("flash-input-emerald");
    void ticketInput.offsetWidth; // force reflow
    ticketInput.classList.add("flash-input-emerald");
  }
}

// -----------------------------------------------------------------------------
// Initialize App & SSE Stream
// -----------------------------------------------------------------------------
function initSSE() {
  const eventSource = new EventSource("/api/events");

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerEvent(data);
    } catch (e) {
      console.error("Failed to parse SSE event:", e);
    }
  };

  eventSource.onerror = (err) => {
    console.warn("SSE connection error. Retrying in 3s...", err);
  };
}

function handleServerEvent(data) {
  switch (data.type) {
    case "INIT":
      attendees = data.attendees || [];
      updateMetrics(data.stats);
      renderPresets();
      renderAttendees();
      if (attendees.length > 0) {
        updateBadgePreview(attendees[0]);
      }
      break;

    case "ATTENDEE_UPDATED":
      updateOrInsertAttendee(data.attendee);
      updateMetrics(data.stats);
      renderAttendees();
      if (data.attendee.status === "PENDING_PRINT") {
        setPrintingState(data.attendee, true);
      }
      break;

    case "PRINT_COMPLETED":
      updateOrInsertAttendee(data.attendee);
      updateMetrics(data.stats);
      renderAttendees();
      setPrintingState(data.attendee, false);
      showBadgeEjection(data.attendee);
      break;

    case "SCAN_REJECTED":
      showAlert(data.error || "Scan rejected.", "error");
      break;

    case "RESET_COMPLETED":
      attendees = data.attendees || [];
      updateMetrics(data.stats);
      renderPresets();
      renderAttendees();
      showAlert("System reset to seed state.", "pending");
      break;

    case "LOG":
      appendTerminalLog(data.tag, data.message, data.timestamp);
      break;

    default:
      break;
  }
}

function updateOrInsertAttendee(updated) {
  const index = attendees.findIndex((a) => a.id === updated.id);
  if (index >= 0) {
    attendees[index] = updated;
  } else {
    attendees.push(updated);
  }
}

// -----------------------------------------------------------------------------
// UI Renderers
// -----------------------------------------------------------------------------
function updateMetrics(stats) {
  if (!stats) return;
  const total = stats.total ?? attendees.length;
  const checked = stats.checkedIn ?? 0;
  const pending = stats.pendingPrint ?? 0;

  if (statTotal) statTotal.textContent = total;
  if (statChecked) statChecked.textContent = checked;
  if (statPending) statPending.textContent = pending;

  if (statCheckedRate && total > 0) {
    const pct = Math.round((checked / total) * 100);
    statCheckedRate.textContent = `${pct}% Badges Printed`;
  }
}

function renderPresets() {
  presetButtonsContainer.innerHTML = "";
  attendees.slice(0, 6).forEach((att) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-btn";
    btn.innerHTML = `<span class="preset-dot"></span><span>${att.name.split(" ")[0]} (${att.ticketId.split("-")[2]})</span>`;
    btn.addEventListener("click", () => {
      ticketInput.value = att.ticketId;
      triggerInteractiveFlash();
      triggerScan(att.ticketId);
    });
    presetButtonsContainer.appendChild(btn);
  });
}

function renderAttendees() {
  attendeeListContainer.innerHTML = "";

  const filtered = attendees.filter((a) => {
    if (currentFilter === "ALL") return true;
    return a.status === currentFilter;
  });

  if (filtered.length === 0) {
    attendeeListContainer.innerHTML = `<div style="text-align: center; color: var(--text-slate-subtle); padding: 24px; font-size: 0.85rem;">No attendees matching "${currentFilter}" filter.</div>`;
    return;
  }

  filtered.forEach((att) => {
    const row = document.createElement("div");
    const isPending = att.status === "PENDING_PRINT";
    const isChecked = att.status === "CHECKED_IN";
    row.className = `attendee-row ${isPending ? "row-pending" : ""} ${isChecked ? "row-checked" : ""}`;

    const badgeStatusLabel = 
      att.status === "CHECKED_IN" ? "CHECKED IN" :
      att.status === "PENDING_PRINT" ? "PRINTING (2.5s)" : "UNCHECKED";

    row.innerHTML = `
      <div class="row-left">
        <div class="row-avatar">
          <img src="https://api.dicebear.com/7.x/bottts/svg?seed=${att.avatarSeed || att.id}" alt="${att.name}">
        </div>
        <div class="row-info">
          <div class="row-name">${att.name}</div>
          <div class="row-meta">${att.ticketId} &bull; ${att.company}</div>
        </div>
      </div>
      <div class="row-right">
        <span class="status-badge ${att.status}">
          ${isPending ? '<span class="pulse-dot" style="background:#fbbf24;box-shadow:0 0 8px #fbbf24;"></span>' : ''}
          ${badgeStatusLabel}
        </span>
      </div>
    `;

    row.addEventListener("click", () => {
      ticketInput.value = att.ticketId;
      triggerInteractiveFlash();
      updateBadgePreview(att);
    });

    attendeeListContainer.appendChild(row);
  });
}

function updateBadgePreview(att) {
  if (!att) return;
  badgeName.textContent = att.name;
  badgeRole.textContent = att.role;
  badgeCompany.textContent = att.company;
  badgeTier.textContent = att.tier.toUpperCase();
  badgeTicketNum.textContent = att.ticketId;
  badgeAvatar.src = `https://api.dicebear.com/7.x/bottts/svg?seed=${att.avatarSeed || att.id}`;
}

function setPrintingState(att, isPrinting) {
  updateBadgePreview(att);
  if (isPrinting) {
    activePrintingAttendeeId = att.id;
    printingOverlay.classList.add("active");
    scanStatusTitle.textContent = `Printing Badge for ${att.name}...`;
    scanStatusSub.textContent = `Async printer queue working (Job: ${att.printJobId || 'Pending'})`;
    showAlert(`Processing check-in for <strong>${att.name}</strong>. Print job dispatched to queue.`, "pending");
  } else {
    if (activePrintingAttendeeId === att.id) {
      printingOverlay.classList.remove("active");
      scanStatusTitle.textContent = "Ready for Next QR Ticket";
      scanStatusSub.textContent = "Scan camera active or choose preset Kenyan attendee below";
      activePrintingAttendeeId = null;
    }
  }
}

function showBadgeEjection(att) {
  updateBadgePreview(att);
  badgeElement.classList.remove("eject-badge");
  void badgeElement.offsetWidth; // Force reflow
  badgeElement.classList.add("eject-badge");
  triggerInteractiveFlash();
  showAlert(`🎉 <strong>${att.name}</strong> successfully checked in! Badge printed and ejected.`, "success");
}

function showAlert(message, type = "success") {
  statusAlert.className = `status-alert ${type}`;
  statusAlert.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
      ${
        type === "error" 
          ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
          : type === "pending"
          ? '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
          : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
      }
    </svg>
    <div>${message}</div>
  `;
  statusAlert.classList.remove("hidden");
}

// -----------------------------------------------------------------------------
// Scan Actions & API Invocations
// -----------------------------------------------------------------------------
async function triggerScan(ticketId) {
  if (!ticketId) return;

  triggerInteractiveFlash();
  btnSubmitScan.disabled = true;
  btnSubmitScan.innerHTML = `<span>CHECKING...</span>`;

  try {
    const response = await fetch("/api/kiosk/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId })
    });

    const data = await response.json();

    if (!response.ok) {
      showAlert(data.error || "Scan failed.", "error");
      if (data.attendee) {
        updateBadgePreview(data.attendee);
      }
    } else {
      updateBadgePreview(data.attendee);
      ticketInput.value = "";
    }
  } catch (err) {
    showAlert(`Connection error: ${err.message}`, "error");
  } finally {
    btnSubmitScan.disabled = false;
    btnSubmitScan.innerHTML = `
      <span>SCAN TICKET</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
    `;
  }
}

scanForm.addEventListener("submit", (e) => {
  e.preventDefault();
  triggerScan(ticketInput.value.trim());
});

// Filter Tabs
document.querySelectorAll(".filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentFilter = tab.getAttribute("data-filter");
    renderAttendees();
  });
});

// Live System Activity Feed Stream
function appendTerminalLog(tag, message, timestamp) {
  const cleanTag = tag.replace(/[\[\]]/g, "").replace(/\s+/g, "_");
  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `
    <span class="log-time">[${timeStr}]</span>
    <span class="log-tag ${cleanTag}">[${cleanTag}]</span>
    <span class="log-message">${escapeHtml(message)}</span>
  `;

  terminalLogs.appendChild(entry);
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

btnClearLogs.addEventListener("click", () => {
  terminalLogs.innerHTML = "";
});

btnResetDb.addEventListener("click", async () => {
  try {
    await fetch("/api/kiosk/reset", { method: "POST" });
  } catch (err) {
    console.error("Reset failed:", err);
  }
});

// Start Real-Time Connection
initSSE();
