/**
 * Solstice Events Co. - Asynchronous Kiosk Check-In Server
 * 
 * Express backend implementing:
 * 1. POST /api/kiosk/scan (Atomic duplicate protection & job queue dispatch)
 * 2. POST /api/printer/webhook (Idempotent vendor callback ingestion)
 * 3. GET /api/attendees (Attendee list & kiosk metrics)
 * 4. GET /api/events (SSE stream for live UI synchronization)
 * 5. POST /api/kiosk/reset (Testing & demo reset endpoint)
 */

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./db.js";
import { printerQueue } from "./printerQueue.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// Active SSE client connections for real-time UI updates
const sseClients = new Set();

function broadcastEvent(eventData) {
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// Connect printerQueue event broadcaster
printerQueue.setEventEmitter((event) => {
  broadcastEvent(event);
});

// Rich terminal logger with distinct ANSI color codes
const LOG_COLORS = {
  SCAN: "\x1b[36m", // Cyan
  QUEUE: "\x1b[33m", // Yellow
  PRINTING: "\x1b[35m", // Magenta
  WEBHOOK: "\x1b[32m", // Green
  DUPLICATE_BLOCKED: "\x1b[41m\x1b[37m", // Red BG / White FG
  IDEMPOTENT: "\x1b[34m", // Blue
  SUCCESS: "\x1b[92m", // Bright Green
  RESET: "\x1b[0m"
};

function sysLog(tag, message, extra = null) {
  const timestamp = new Date().toLocaleTimeString();
  const color = LOG_COLORS[tag.replace(/[\[\]\s]/g, "")] || "\x1b[35m";
  console.log(`[${timestamp}] ${color}${tag}${LOG_COLORS.RESET} ${message}`);

  broadcastEvent({
    type: "LOG",
    tag,
    message,
    extra,
    timestamp: new Date().toISOString()
  });
}

// -----------------------------------------------------------------------------
// SSE STREAM FOR REAL-TIME KIOSK UI
// -----------------------------------------------------------------------------
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);
  sysLog("[SYSTEM]", `Kiosk client connected to real-time event stream. Active clients: ${sseClients.size}`);

  // Send initial snapshot
  res.write(`data: ${JSON.stringify({
    type: "INIT",
    attendees: db.getAll(),
    stats: db.getStats()
  })}\n\n`);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

// -----------------------------------------------------------------------------
// 1. QR SCAN & ATOMIC DUPLICATE PROTECTION
// -----------------------------------------------------------------------------
app.post("/api/kiosk/scan", (req, res) => {
  const { ticketId, qrData, scanInput } = req.body;
  const scanQuery = ticketId || qrData || scanInput;

  if (!scanQuery) {
    return res.status(400).json({
      error: "Missing ticket or QR code payload.",
      code: "INVALID_REQUEST"
    });
  }

  const generatedJobId = `PRN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;

  sysLog("[SCAN]", `Incoming QR/Ticket scan: "${scanQuery}" (Generated Print Job ID: ${generatedJobId})`);

  // ATOMIC CHECK & LOCK
  const lockResult = db.atomicScanAndLock(scanQuery, generatedJobId);

  if (!lockResult.success) {
    // DUPLICATE OR NOT FOUND
    if (lockResult.status === 409) {
      sysLog(
        "[DUPLICATE BLOCKED]",
        `Rejected check-in for "${lockResult.attendee?.name || scanQuery}": ${lockResult.error}`,
        { attendee: lockResult.attendee, code: lockResult.code }
      );
    } else {
      sysLog("[SCAN_ERROR]", `Scan failed for "${scanQuery}": ${lockResult.error}`);
    }

    broadcastEvent({
      type: "SCAN_REJECTED",
      query: scanQuery,
      attendee: lockResult.attendee,
      error: lockResult.error,
      code: lockResult.code
    });

    return res.status(lockResult.status).json({
      success: false,
      error: lockResult.error,
      code: lockResult.code,
      attendee: lockResult.attendee
    });
  }

  // ATOMIC LOCK ACQUIRED -> ENQUEUE TO ASYNC PRINTER
  const attendee = lockResult.attendee;
  sysLog(
    "[SCAN]",
    `Valid scan verified for "${attendee.name}" (${attendee.tier}). Status transitioned to PENDING_PRINT.`
  );

  const printJob = printerQueue.enqueue({
    jobId: generatedJobId,
    attendeeId: attendee.id,
    attendeeName: attendee.name,
    ticketId: attendee.ticketId,
    tier: attendee.tier
  });

  // Broadcast state update to all kiosk screens
  broadcastEvent({
    type: "ATTENDEE_UPDATED",
    attendee,
    job: printJob,
    stats: db.getStats()
  });

  return res.status(202).json({
    success: true,
    message: `Attendee scan accepted. Badge print job ${printJob.jobId} enqueued.`,
    status: "PENDING_PRINT",
    jobId: printJob.jobId,
    attendee: attendee
  });
});

// -----------------------------------------------------------------------------
// 2. IDEMPOTENT WEBHOOK CALLBACK ENDPOINT
// -----------------------------------------------------------------------------
app.post("/api/printer/webhook", (req, res) => {
  const { jobId, attendeeId, status, vendorTimestamp, deviceInfo } = req.body;

  sysLog(
    "[WEBHOOK]",
    `Received printer vendor callback for Job #${jobId || "N/A"} (Attendee ID: ${attendeeId || "N/A"}), status="${status}"`,
    req.body
  );

  if (!jobId && !attendeeId) {
    return res.status(400).json({
      error: "Webhook payload must provide jobId or attendeeId.",
      code: "INVALID_WEBHOOK_PAYLOAD"
    });
  }

  // ATOMIC & IDEMPOTENT STATE TRANSITION
  const completeResult = db.atomicCompletePrint(jobId, attendeeId, vendorTimestamp);

  if (!completeResult.success) {
    sysLog("[WEBHOOK_ERROR]", `Webhook processing failed: ${completeResult.error}`);
    return res.status(completeResult.status).json({
      error: completeResult.error,
      code: completeResult.code
    });
  }

  const { attendee, idempotent } = completeResult;

  if (idempotent) {
    sysLog(
      "[IDEMPOTENT WEBHOOK]",
      `Redundant webhook received for Job #${jobId} (${attendee.name}). Safe 200 OK returned without side effects.`
    );
  } else {
    sysLog(
      "[PRINT SUCCESS]",
      `Thermal badge printed and ejected for "${attendee.name}"! Status updated to CHECKED_IN.`
    );
  }

  // Broadcast real-time badge completion to Kiosks
  broadcastEvent({
    type: "PRINT_COMPLETED",
    attendee,
    jobId,
    idempotent,
    stats: db.getStats()
  });

  return res.status(200).json({
    success: true,
    idempotent,
    message: completeResult.message,
    attendee: attendee
  });
});

// -----------------------------------------------------------------------------
// 3. ATTENDEES & STATS ENDPOINT
// -----------------------------------------------------------------------------
app.get("/api/attendees", (req, res) => {
  res.json({
    attendees: db.getAll(),
    stats: db.getStats()
  });
});

// -----------------------------------------------------------------------------
// 4. KIOSK RESET (For interactive testing and demos)
// -----------------------------------------------------------------------------
app.post("/api/kiosk/reset", (req, res) => {
  db.reset();
  sysLog("[RESET]", "All attendee check-in records have been reset to default NOT_CHECKED_IN state.");

  broadcastEvent({
    type: "RESET_COMPLETED",
    attendees: db.getAll(),
    stats: db.getStats()
  });

  res.json({
    success: true,
    message: "Attendee database reset to initial seed state.",
    stats: db.getStats()
  });
});

// Start Server (only if executed directly as the main process)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const serverInstance = app.listen(PORT, () => {
    printerQueue.setWebhookUrl(`http://localhost:${PORT}/api/printer/webhook`);
    sysLog("[SERVER_INIT]", `🚀 Solstice Events Kiosk Server listening on http://localhost:${PORT}`);
    sysLog("[PRINTER_SIM]", `🖨️ Mock thermal printer vendor worker ready with 2.5s simulated cycle.`);
  });
}

export { app };
export default app;


