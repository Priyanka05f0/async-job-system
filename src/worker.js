const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const redis = require("./redis");
const pool = require("./db");

const MAX_RETRIES = 2;

/* =========================
   STRUCTURED LOGGER
   ========================= */
function log(level, event, data = {}) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...data
    })
  );
}

/* =========================
   GRACEFUL SHUTDOWN
   ========================= */
let shuttingDown = false;

process.on("SIGTERM", () => {
  log("info", "shutdown_signal_received", { signal: "SIGTERM" });
  shuttingDown = true;
});

process.on("SIGINT", () => {
  log("info", "shutdown_signal_received", { signal: "SIGINT" });
  shuttingDown = true;
});

log("info", "worker_started");

/* =========================
   WORKER LOOP
   ========================= */
async function startWorker() {
  while (!shuttingDown) {
    try {
      const result = await redis.brpop("job_queue", 0);
      const jobId = result[1];

      log("info", "job_received", { jobId });

      const jobResult = await pool.query(
        "SELECT * FROM jobs WHERE id = $1",
        [jobId]
      );

      if (jobResult.rows.length === 0) {
        log("error", "job_not_found", { jobId });
        continue;
      }

      const job = jobResult.rows[0];

      /* =================
         IDEMPOTENCY CHECK
         ================= */
      if (job.status === "completed") {
        log("info", "job_skipped_completed", { jobId });
        continue;
      }

      await pool.query(
        "UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2",
        ["processing", jobId]
      );

      log("info", "job_processing_started", {
        jobId,
        jobType: job.type,
        attempt: job.attempts
      });

      try {
        /* =================
           JOB EXECUTION
           ================= */
        if (job.payload?.fail === true) {
          throw new Error("Intentional failure for retry test");
        }

        /* ============================
           CSV_EXPORT / csv-generation
           ============================ */
        if (job.type === "CSV_EXPORT" || job.type === "csv-generation") {
          const rows = job.payload.data;

          if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error("CSV_EXPORT payload must contain non-empty data array");
          }

          const headers = Object.keys(rows[0]);
          let csv = headers.join(",") + "\n";

          for (const row of rows) {
            csv += headers.map(h => row[h]).join(",") + "\n";
          }

          const fileName = `${jobId}.csv`;
          const filePath = path.join("/usr/src/app/output", fileName);

          if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, csv);
          }

          await pool.query(
            "UPDATE jobs SET status = $1, result = $2, updated_at = NOW() WHERE id = $3",
            ["completed", JSON.stringify({ filePath: `output/${fileName}` }), jobId]
          );

          log("info", "csv_export_completed", {
            jobId,
            filePath: `output/${fileName}`
          });
        }

        /* ============================
           EMAIL_SEND
           ============================ */
        if (job.type === "EMAIL_SEND") {
          const transporter = nodemailer.createTransport({
            host: process.env.MAIL_HOST || "mailhog",
            port: 1025,
            secure: false
          });

          const info = await transporter.sendMail({
            from: "no-reply@test.com",
            to: job.payload.to,
            subject: job.payload.subject,
            text: job.payload.body
          });

          await pool.query(
            "UPDATE jobs SET status = $1, result = $2, updated_at = NOW() WHERE id = $3",
            ["completed", JSON.stringify({ messageId: info.messageId }), jobId]
          );

          log("info", "email_sent", {
            jobId,
            to: job.payload.to,
            messageId: info.messageId
          });
        }

      } catch (err) {
        /* =================
           RETRY + DLQ
           ================= */
        const attempts = job.attempts + 1;

        log("error", "job_failed", {
          jobId,
          jobType: job.type,
          attempt: attempts,
          error: err.message
        });

        if (attempts < MAX_RETRIES) {
          await pool.query(
            "UPDATE jobs SET attempts = $1, status = $2 WHERE id = $3",
            [attempts, "pending", jobId]
          );

          await redis.lpush("job_queue", jobId);

          log("warn", "job_requeued", { jobId, attempt: attempts });
        } else {
          await pool.query(
            "UPDATE jobs SET attempts = $1, status = $2 WHERE id = $3",
            [attempts, "failed", jobId]
          );

          await redis.lpush("job_dlq", jobId);

          log("error", "job_moved_to_dlq", {
            jobId,
            attempts,
            dlq: "job_dlq"
          });
        }
      }
    } catch (err) {
      if (!shuttingDown) {
        log("error", "worker_loop_error", { error: err.message });
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  log("info", "worker_shutdown_complete");
  process.exit(0);
}

startWorker();
