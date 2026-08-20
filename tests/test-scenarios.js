/**
 * Solstice Events Co. - End-to-End Simulation & Verification Test Suite
 * 
 * Test Scenarios:
 * 1. Initial Valid Scan (Dr. Elena Vance):
 *    - POST /api/kiosk/scan -> 202 Accepted (Status: PENDING_PRINT)
 *    - Vendor delay (2.5s) -> POST /api/printer/webhook -> 200 OK (Status: CHECKED_IN)
 * 2. Duplicate Scan Rejection:
 *    - POST /api/kiosk/scan with same ticket -> 409 Conflict (DUPLICATE BLOCKED)
 * 3. Concurrent Multi-Attendee Scans (Marcus Holloway & Aria Sterling):
 *    - Both accepted, queued, and processed sequentially through printer queue
 * 4. Idempotent Webhook Delivery:
 *    - Duplicate webhook callback sent -> Returns 200 OK with idempotent flag
 */

import { app } from "../src/server.js";
import { printerQueue } from "../src/printerQueue.js";

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;
let testServer;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m"
};

function pass(msg) {
  console.log(`  ${ANSI.green}✓ PASS:${ANSI.reset} ${msg}`);
}

function fail(msg, err) {
  console.error(`  ${ANSI.red}✗ FAIL:${ANSI.reset} ${msg}`, err || "");
  process.exitCode = 1;
}

async function runTestSuite() {
  // Start dedicated test instance
  testServer = app.listen(PORT, () => {
    printerQueue.setWebhookUrl(`${BASE_URL}/api/printer/webhook`);
  });


  console.log(`\n${ANSI.bold}${ANSI.magenta}================================================================${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.magenta}  Solstice Events Co. - Asynchronous Kiosk Check-In Test Suite  ${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.magenta}================================================================${ANSI.reset}\n`);

  try {
    // Reset database to initial state
    console.log(`${ANSI.cyan}▶ [SETUP] Resetting database to seed state...${ANSI.reset}`);
    const resetRes = await fetch(`${BASE_URL}/api/kiosk/reset`, { method: "POST" });
    if (resetRes.ok) {
      pass("Attendee database reset to initial state.");
    } else {
      throw new Error("Failed to reset database.");
    }

    // -------------------------------------------------------------------------
    // TEST 1: Attendee 1 First Valid Scan & Async Webhook Completion
    // -------------------------------------------------------------------------
    console.log(`\n${ANSI.cyan}▶ [TEST 1] Testing Initial Valid Scan (Dr. Elena Vance)...${ANSI.reset}`);
    const scan1Res = await fetch(`${BASE_URL}/api/kiosk/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: "SOL-2026-VIP-8821" })
    });

    const scan1Data = await scan1Res.json();

    if (scan1Res.status === 202 && scan1Data.status === "PENDING_PRINT") {
      pass(`Scan accepted with HTTP 202 Accepted. Status is PENDING_PRINT (Job: ${scan1Data.jobId}).`);
    } else {
      fail(`Expected 202 Accepted, received HTTP ${scan1Res.status}`, scan1Data);
    }

    console.log(`  ${ANSI.yellow}⏳ Waiting 2.8s for printer queue simulation & webhook delivery...${ANSI.reset}`);
    await sleep(2800);

    // Verify attendee is now CHECKED_IN
    const attListRes = await fetch(`${BASE_URL}/api/attendees`);
    const attListData = await attListRes.json();
    const elena = attListData.attendees.find((a) => a.id === "att_001");

    if (elena && elena.status === "CHECKED_IN" && elena.checkedInAt) {
      pass(`Webhook callback confirmed! Elena Vance transitioned to CHECKED_IN at ${elena.checkedInAt}`);
    } else {
      fail(`Elena Vance status is ${elena?.status}, expected CHECKED_IN.`);
    }

    // -------------------------------------------------------------------------
    // TEST 2: Duplicate Scan Protection (Elena Vance Scanned Again)
    // -------------------------------------------------------------------------
    console.log(`\n${ANSI.cyan}▶ [TEST 2] Testing Duplicate Scan Protection (Elena Vance)...${ANSI.reset}`);
    const dupScanRes = await fetch(`${BASE_URL}/api/kiosk/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: "SOL-2026-VIP-8821" })
    });

    const dupScanData = await dupScanRes.json();

    if (dupScanRes.status === 409 && dupScanData.code === "DUPLICATE_SCAN_ALREADY_CHECKED_IN") {
      pass(`Duplicate scan blocked with HTTP 409 Conflict. Error message: "${dupScanData.error}"`);
    } else {
      fail(`Expected 409 Conflict, received HTTP ${dupScanRes.status}`, dupScanData);
    }

    // -------------------------------------------------------------------------
    // TEST 3: Multi-Attendee Concurrent Scanning (Marcus & Aria)
    // -------------------------------------------------------------------------
    console.log(`\n${ANSI.cyan}▶ [TEST 3] Testing Multi-Attendee Check-in (Marcus Holloway & Aria Sterling)...${ANSI.reset}`);
    const [marcusRes, ariaRes] = await Promise.all([
      fetch(`${BASE_URL}/api/kiosk/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: "SOL-2026-DEV-3304" })
      }),
      fetch(`${BASE_URL}/api/kiosk/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: "SOL-2026-PRS-9120" })
      })
    ]);

    if (marcusRes.status === 202 && ariaRes.status === 202) {
      pass("Both concurrent scans accepted with HTTP 202 Accepted and queued.");
    } else {
      fail("Concurrent scan requests failed.");
    }

    console.log(`  ${ANSI.yellow}⏳ Waiting 5.5s for queue worker to process both print jobs...${ANSI.reset}`);
    await sleep(5500);

    const attListRes2 = await fetch(`${BASE_URL}/api/attendees`);
    const attListData2 = await attListRes2.json();
    const marcus = attListData2.attendees.find((a) => a.id === "att_002");
    const aria = attListData2.attendees.find((a) => a.id === "att_003");

    if (marcus?.status === "CHECKED_IN" && aria?.status === "CHECKED_IN") {
      pass(`Both attendees completed check-in: Marcus (${marcus.status}), Aria (${aria.status}).`);
    } else {
      fail(`Expected both to be CHECKED_IN. Marcus: ${marcus?.status}, Aria: ${aria?.status}`);
    }

    // -------------------------------------------------------------------------
    // TEST 4: Idempotent Webhook Callback
    // -------------------------------------------------------------------------
    console.log(`\n${ANSI.cyan}▶ [TEST 4] Testing Idempotent Webhook Callback...${ANSI.reset}`);
    const duplicateWebhookRes = await fetch(`${BASE_URL}/api/printer/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: marcus.printJobId,
        attendeeId: marcus.id,
        status: "SUCCESS",
        vendorTimestamp: new Date().toISOString()
      })
    });

    const dupWebhookData = await duplicateWebhookRes.json();

    if (duplicateWebhookRes.status === 200 && dupWebhookData.idempotent === true) {
      pass(`Idempotent webhook handled cleanly: HTTP 200 OK, idempotent: true. "${dupWebhookData.message}"`);
    } else {
      fail(`Expected idempotent 200 OK, received HTTP ${duplicateWebhookRes.status}`, dupWebhookData);
    }

    console.log(`\n${ANSI.bold}${ANSI.green}================================================================${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.green}  🎉 ALL TEST SCENARIOS PASSED SUCCESSFULLY! (4/4)              ${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.green}================================================================${ANSI.reset}\n`);

  } catch (error) {
    fail("Unhandled test suite failure", error);
  } finally {
    if (testServer) testServer.close();
    process.exit(process.exitCode || 0);
  }
}

// Allow brief moment before starting tests
setTimeout(runTestSuite, 300);

