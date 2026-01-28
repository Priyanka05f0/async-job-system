const express = require("express");
const { v4: uuidv4 } = require("uuid");
const pool = require("../db");
const redis = require("../redis");

const router = express.Router();

// POST /jobs  -> Create a new job
router.post("/", async (req, res) => {
  try {
    const { type, payload } = req.body;

    if (!type) {
      return res.status(400).json({ error: "Job type is required" });
    }

    const jobId = uuidv4();

    await pool.query(
      `INSERT INTO jobs (id, type, status, payload)
       VALUES ($1, $2, $3, $4)`,
      [jobId, type, "pending", payload || {}]
    );

    await redis.lpush("job_queue", jobId);

    res.status(201).json({
      job_id: jobId,
      status: "pending",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create job" });
  }
});

// GET /jobs/:id  -> Get job status
router.get("/:id", async (req, res) => {
  try {
    const jobId = req.params.id;

    const result = await pool.query(
      "SELECT id, type, status, result FROM jobs WHERE id = $1",
      [jobId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    const job = result.rows[0];

    res.json({
      job_id: job.id,
      type: job.type,
      status: job.status,
      result: job.result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch job status" });
  }
});

module.exports = router;
