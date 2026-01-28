const express = require("express");

const app = express();
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// IMPORTANT: Mount jobs routes here
const jobRoutes = require("./routes/jobs");
app.use("/jobs", jobRoutes);

const PORT = process.env.API_PORT || 3000;

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
