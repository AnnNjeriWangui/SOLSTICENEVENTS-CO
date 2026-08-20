/**
 * Solstice Events Co. - In-Memory Database Store with Atomic State Transitions
 * 
 * Provides thread-safe / atomic status guards for kiosk check-in:
 * - Status transitions: 'NOT_CHECKED_IN' -> 'PENDING_PRINT' -> 'CHECKED_IN'
 * - Atomic scan locking to prevent race conditions and duplicate badge prints.
 * - Idempotent completion handlers for printer webhook callbacks.
 */

const SEED_ATTENDEES = [
  {
    id: "att_001",
    ticketId: "SOL-2026-VIP-8821",
    name: "Dr. Wanjiku Muthoni",
    email: "wanjiku.muthoni@safaricom.co.ke",
    company: "Safaricom AI Research",
    role: "Keynote Speaker",
    tier: "VIP Speaker",
    avatarSeed: "wanjiku",
    status: "NOT_CHECKED_IN",
    badgeType: "Holographic VIP",
    checkedInAt: null,
    printJobId: null,
    printAttempts: 0
  },
  {
    id: "att_002",
    ticketId: "SOL-2026-DEV-3304",
    name: "Brian Kipchumba",
    email: "brian.k@cybersec.co.ke",
    company: "Nairobi CyberSec Hub",
    role: "Lead Systems Architect",
    tier: "All-Access Pass",
    avatarSeed: "brian",
    status: "NOT_CHECKED_IN",
    badgeType: "Standard Conference",
    checkedInAt: null,
    printJobId: null,
    printAttempts: 0
  },
  {
    id: "att_003",
    ticketId: "SOL-2026-PRS-9120",
    name: "Faith Mwangi",
    email: "faith.mwangi@techtrends.ke",
    company: "TechTrends Kenya",
    role: "Senior Tech Journalist",
    tier: "Press / Media",
    avatarSeed: "faith",
    status: "NOT_CHECKED_IN",
    badgeType: "Press Pass",
    checkedInAt: null,
    printJobId: null,
    printAttempts: 0
  },
  {
    id: "att_004",
    ticketId: "SOL-2026-DEV-7749",
    name: "Kevin Ochieng",
    email: "kevin.ochieng@moringalabs.ke",
    company: "Moringa Tech Labs",
    role: "AI Research Fellow",
    tier: "All-Access Pass",
    avatarSeed: "kevin",
    status: "NOT_CHECKED_IN",
    badgeType: "Standard Conference",
    checkedInAt: null,
    printJobId: null,
    printAttempts: 0
  },
  {
    id: "att_005",
    ticketId: "SOL-2026-VIP-1092",
    name: "Stacy Nyambura",
    email: "stacy.nyambura@savannah.vc",
    company: "Savannah Tech Ventures",
    role: "Managing Partner",
    tier: "VIP Executive",
    avatarSeed: "stacy",
    status: "NOT_CHECKED_IN",
    badgeType: "Holographic VIP",
    checkedInAt: null,
    printJobId: null,
    printAttempts: 0
  }
];

class AttendeeStore {
  constructor() {
    this.attendees = new Map();
    this.ticketIndex = new Map();
    this.jobIndex = new Map();
    this.auditLogs = [];
    this.reset();
  }

  reset() {
    this.attendees.clear();
    this.ticketIndex.clear();
    this.jobIndex.clear();
    this.auditLogs = [];

    for (const item of SEED_ATTENDEES) {
      const copy = { ...item };
      this.attendees.set(copy.id, copy);
      this.ticketIndex.set(copy.ticketId.toUpperCase(), copy.id);
    }
  }

  getAll() {
    return Array.from(this.attendees.values());
  }

  getStats() {
    const list = this.getAll();
    return {
      total: list.length,
      notCheckedIn: list.filter((a) => a.status === "NOT_CHECKED_IN").length,
      pendingPrint: list.filter((a) => a.status === "PENDING_PRINT").length,
      checkedIn: list.filter((a) => a.status === "CHECKED_IN").length
    };
  }

  findById(id) {
    return this.attendees.get(id) || null;
  }

  findByTicketOrScan(query) {
    if (!query) return null;
    const clean = query.trim().toUpperCase();
    // Direct ID match
    if (this.attendees.has(query)) return this.attendees.get(query);
    // Ticket match
    if (this.ticketIndex.has(clean)) {
      const id = this.ticketIndex.get(clean);
      return this.attendees.get(id);
    }
    // Partial search / fuzzy search by name or ticket
    for (const att of this.attendees.values()) {
      if (
        att.ticketId.toUpperCase() === clean ||
        att.id.toUpperCase() === clean ||
        att.email.toUpperCase() === clean ||
        att.name.toUpperCase().includes(clean)
      ) {
        return att;
      }
    }
    return null;
  }

  /**
   * ATOMIC SCAN OPERATION
   * Checks status and locks into PENDING_PRINT synchronously.
   * Returns: { success: boolean, attendee?: object, error?: string, code?: string }
   */
  atomicScanAndLock(identifier, jobId) {
    const attendee = this.findByTicketOrScan(identifier);

    if (!attendee) {
      return {
        success: false,
        error: `No registered attendee found matching ticket code "${identifier}".`,
        code: "ATTENDEE_NOT_FOUND",
        status: 404
      };
    }

    // DUPLICATE CHECK: If already checked in
    if (attendee.status === "CHECKED_IN") {
      return {
        success: false,
        error: `Duplicate scan blocked: ${attendee.name} was already checked in at ${new Date(attendee.checkedInAt).toLocaleTimeString()}. Badge has already been printed.`,
        code: "DUPLICATE_SCAN_ALREADY_CHECKED_IN",
        attendee,
        status: 409
      };
    }

    // DUPLICATE CHECK: If print job is already currently in progress
    if (attendee.status === "PENDING_PRINT") {
      return {
        success: false,
        error: `Print in progress: A badge print job (${attendee.printJobId}) is already queued for ${attendee.name}. Please wait for the vendor printer.`,
        code: "DUPLICATE_SCAN_PRINT_PENDING",
        attendee,
        status: 409
      };
    }

    // Atomic State Transition: NOT_CHECKED_IN -> PENDING_PRINT
    attendee.status = "PENDING_PRINT";
    attendee.printJobId = jobId;
    attendee.printAttempts += 1;
    this.jobIndex.set(jobId, attendee.id);

    return {
      success: true,
      attendee,
      status: 202
    };
  }

  /**
   * IDEMPOTENT WEBHOOK COMPLETION
   * Receives printer webhook callback.
   * If already CHECKED_IN, safely returns 200 without duplicate actions.
   */
  atomicCompletePrint(jobId, attendeeId, vendorTimestamp) {
    let attendee = null;

    if (attendeeId && this.attendees.has(attendeeId)) {
      attendee = this.attendees.get(attendeeId);
    } else if (jobId && this.jobIndex.has(jobId)) {
      const id = this.jobIndex.get(jobId);
      attendee = this.attendees.get(id);
    }

    if (!attendee) {
      return {
        success: false,
        error: `Webhook resolution failed: No attendee matching jobId "${jobId}" or attendeeId "${attendeeId}".`,
        code: "JOB_NOT_FOUND",
        status: 404
      };
    }

    // IDEMPOTENCY GUARD:
    // If attendee is already marked CHECKED_IN, do not throw an error; return idempotent success.
    if (attendee.status === "CHECKED_IN") {
      return {
        success: true,
        idempotent: true,
        message: `Idempotent acknowledgment: Attendee ${attendee.name} (${attendee.id}) is already CHECKED_IN.`,
        attendee,
        status: 200
      };
    }

    // Transition from PENDING_PRINT -> CHECKED_IN
    attendee.status = "CHECKED_IN";
    attendee.checkedInAt = vendorTimestamp || new Date().toISOString();

    return {
      success: true,
      idempotent: false,
      message: `Print completed successfully. Attendee ${attendee.name} marked as CHECKED_IN.`,
      attendee,
      status: 200
    };
  }
}

export const db = new AttendeeStore();
