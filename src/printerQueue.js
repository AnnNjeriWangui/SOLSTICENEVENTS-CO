/**
 * Solstice Events Co. - Asynchronous Mock Printer Queue Simulator
 * 
 * Simulates real-world hardware thermal badge printers with:
 * - Built-in realistic 2-3 second vendor processing delay
 * - Asynchronous background queue worker
 * - Automatic Webhook dispatch to POST /api/printer/webhook
 */

class MockPrinterQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.defaultDelayMs = 2500; // 2.5 second vendor delay
    this.webhookUrl = null;
    this.eventEmitter = null;
  }

  setWebhookUrl(url) {
    this.webhookUrl = url;
  }

  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }

  log(tag, message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] \x1b[35m${tag}\x1b[0m ${message}`;
    console.log(formatted);
    if (this.eventEmitter) {
      this.eventEmitter({
        type: "LOG",
        tag,
        message,
        data,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Enqueue a new print job
   */
  enqueue(job) {
    const enrichedJob = {
      jobId: job.jobId || `PRN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      attendeeId: job.attendeeId,
      attendeeName: job.attendeeName,
      ticketId: job.ticketId,
      tier: job.tier,
      enqueuedAt: new Date().toISOString(),
      delayMs: job.delayMs || this.defaultDelayMs
    };

    this.queue.push(enrichedJob);
    this.log(
      "[QUEUE]",
      `Enqueued Print Job #${enrichedJob.jobId} for "${enrichedJob.attendeeName}" (${enrichedJob.ticketId}). Queue size: ${this.queue.length}`,
      enrichedJob
    );

    if (this.eventEmitter) {
      this.eventEmitter({
        type: "JOB_ENQUEUED",
        job: enrichedJob
      });
    }

    // Trigger queue processing worker
    this.processQueue();
    return enrichedJob;
  }

  /**
   * Background queue worker loop
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const currentJob = this.queue.shift();

      this.log(
        "[PRINTING]",
        `Transmitting to Thermal Printer Hardware for "${currentJob.attendeeName}" (Simulating ${currentJob.delayMs / 1000}s vendor cycle)...`,
        currentJob
      );

      if (this.eventEmitter) {
        this.eventEmitter({
          type: "PRINT_STARTED",
          job: currentJob
        });
      }

      // Simulate vendor hardware print delay (2-3 seconds)
      await new Promise((resolve) => setTimeout(resolve, currentJob.delayMs));

      // Trigger Webhook callback to backend
      await this.dispatchWebhook(currentJob);
    }

    this.isProcessing = false;
  }

  /**
   * Dispatch Webhook Callback
   */
  async dispatchWebhook(job) {
    const webhookPayload = {
      jobId: job.jobId,
      attendeeId: job.attendeeId,
      status: "SUCCESS",
      vendorTimestamp: new Date().toISOString(),
      deviceInfo: {
        vendor: "Zebra ZD621 Thermal Card Printer",
        serial: "SN-SOLSTICE-9004",
        firmware: "v4.2.1-badge-fastpass",
        dpi: 300,
        cutterEngaged: true
      }
    };

    this.log(
      "[WEBHOOK_DISPATCH]",
      `Vendor hardware finished print for "${job.attendeeName}". Dispatching webhook callback to ${this.webhookUrl || "local handler"}...`,
      webhookPayload
    );

    if (this.webhookUrl) {
      try {
        const response = await fetch(this.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Solstice-Printer-Signature": "sha256-mock-vendor-sig-verified"
          },
          body: JSON.stringify(webhookPayload)
        });

        const data = await response.json();
        this.log(
          "[WEBHOOK_ACK]",
          `Webhook ACK received: HTTP ${response.status} -> ${JSON.stringify(data.message || data)}`
        );
      } catch (err) {
        this.log("[ERROR]", `Failed to deliver webhook to ${this.webhookUrl}: ${err.message}`);
      }
    }
  }
}

export const printerQueue = new MockPrinterQueue();
