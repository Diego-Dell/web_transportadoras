const express = require("express");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use("/uploads", express.static(uploadsDir));

app.get("/health", (req, res) => {
  res.json({ ok: true, app: process.env.APP_NAME || "Sistema de Envios" });
});

app.listen(PORT, () => {
  console.log(`Sistema de envios activo en puerto ${PORT}`);
});