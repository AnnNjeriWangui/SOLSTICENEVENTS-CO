# Solstice Events Co. — Asynchronous Kiosk Check-In Pivot

> **Pivot Architecture**: Transitioning from a synchronous REST print model to an asynchronous, event-driven queue + webhook model for high-throughput tech conference kiosks.

**GitHub Repository**: [https://github.com/AnnNjeriWangui/SOLSTICENEVENTS-CO](https://github.com/AnnNjeriWangui/SOLSTICENEVENTS-CO)

---

## 🌟 Overview & Key Innovations

During peak check-in rushes, synchronous print models cause HTTP timeouts, kiosk freezes, and duplicate badges if attendees scan multiple times. 

This pivot implements:
1. **Atomic Scan & Duplicate Protection**: Checks attendee status synchronously before queuing; instantly rejects duplicate scans (`409 Conflict`) if already checked in or pending.
2. **Asynchronous Mock Vendor Queue**: Offloads physical badge printing to a background queue worker with a realistic 2.5s vendor hardware delay.
3. **Idempotent Webhook Callback (`POST /api/printer/webhook`)**: Ingests print completion events from vendor hardware, updating state to `CHECKED_IN` and safely absorbing duplicate/out-of-order deliveries (`200 OK`).
4. **Deep Eggplant & Plum Kiosk Interface**: Modern, luxury tech conference UI with live badge ejection animations, laser viewfinder, attendee roster filters, and real-time SSE telemetry logs.

---

## 📐 Architecture Diagram

```
+--------------------------------------------------------------------------------+
|                             KIOSK FRONTEND UI                                  |
|   (Interactive Scanner, Attendee Roster, Real-Time Badging, Live Event Stream)|
+--------------------------------------------------------------------------------+
             |                                              ^
       [1] POST /api/kiosk/scan                             | [SSE / Event Stream]
             |                                              |
             v                                              |
+--------------------------------------------------------------------------------+
|                         EXPRESS CHECK-IN BACKEND                               |
|                                                                                |
|  * Atomic State Guard:                                                         |
|    - If status == 'CHECKED_IN' or 'PENDING_PRINT' -> Reject Duplicate (409)   |
|    - Else -> Status = 'PENDING_PRINT', enqueue print job, Return 202 Accepted  |
+--------------------------------------------------------------------------------+
        |                                                   ^
        | [2] Push Job                                      | [4] POST /api/printer/webhook
        v                                                   |     (Idempotent Ingestion)
+------------------------------------+                      |
|      ASYNC PRINTER QUEUE           |                      |
|                                    |                      |
|  * 2-3s realistic vendor delay     |                      |
|  * Badge render & print processing | ---------------------+
|  * Emits Webhook Callback          | [3] Trigger Webhook Callback
+------------------------------------+
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Kiosk Server
```bash
npm start
```
The server will start at `http://localhost:3000`.

### 3. Open Kiosk UI
Navigate to [http://localhost:3000](http://localhost:3000) in your web browser.

---

## 🧪 Automated Test Suite

Run the end-to-end simulation test suite:
```bash
npm test
```

### Verified Test Cases:
1. **Initial Valid Scan**: Elena Vance scans &rarr; 202 Accepted &rarr; 2.5s vendor queue &rarr; Webhook delivered &rarr; `CHECKED_IN`.
2. **Duplicate Scan Protection**: Elena Vance scans again &rarr; 409 Conflict blocked with clear notice.
3. **Concurrent Multi-Attendee Scans**: Marcus Holloway & Aria Sterling scanned simultaneously &rarr; both enqueued & processed safely.
4. **Idempotent Webhook Delivery**: Redundant webhook callback sent &rarr; 200 OK returned safely without state corruption.

---

## 📡 API Endpoints

### 1. Scan Attendee Ticket
* **Endpoint**: `POST /api/kiosk/scan`
* **Body**: `{ "ticketId": "SOL-2026-VIP-8821" }`
* **Responses**:
  * `202 Accepted`: Job enqueued (`PENDING_PRINT`)
  * `409 Conflict`: Duplicate scan blocked (Already checked in or pending)
  * `404 Not Found`: Invalid ticket ID

### 2. Printer Webhook Callback
* **Endpoint**: `POST /api/printer/webhook`
* **Body**:
```json
{
  "jobId": "PRN-170000000-123",
  "attendeeId": "att_001",
  "status": "SUCCESS",
  "vendorTimestamp": "2026-08-20T19:00:00.000Z"
}
```
* **Responses**:
  * `200 OK`: Status updated to `CHECKED_IN` or idempotent safe return if already processed.

### 3. Real-Time Event Stream
* **Endpoint**: `GET /api/events`
* **Format**: Server-Sent Events (`text/event-stream`)

### 4. Attendee Roster & Stats
* **Endpoint**: `GET /api/attendees`

### 5. System Reset
* **Endpoint**: `POST /api/kiosk/reset`

---

## 🎨 Theme & Styling
* **Palette**: Deep Eggplant (`#0a040f`, `#13071a`, `#1c0b26`), Rich Plum (`#280f37`, `#8c1d6b`, `#b8268c`), Neon Accents (`#e03ba8`, `#d8b4fe`).
* **Typography**: Plus Jakarta Sans & JetBrains Mono.
