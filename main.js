import { Command } from "commander";
import http from "http";
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import bodyParser from "body-parser";

const program = new Command();

program
  .requiredOption("-h, --host <host>", "Server host")
  .requiredOption("-p, --port <port>", "Server port")
  .requiredOption("-c, --cache <dir>", "Cache directory path");

program.parse(process.argv);
const { host, port, cache } = program.opts();

const CACHE_DIR = path.resolve(cache);
const UPLOADS_DIR = path.join(CACHE_DIR, "uploads");
const DB_FILE = path.join(CACHE_DIR, "db.json");

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ items: [] }, null, 2));
}

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function genId() {
  return `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use("/", express.static("./public"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) =>
    cb(
      null,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.originalname}`
    ),
});

const upload = multer({ storage });
//POST /register
app.post("/register", upload.single("photo"), (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name || inventory_name.trim() === "") {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "inventory_name is required" });
  }

  const db = loadDB();
  const id = genId();

  const item = {
    id,
    name: inventory_name,
    description: description || "",
    photo: req.file ? path.basename(req.file.path) : null,
    createdAt: new Date().toISOString(),
  };

  db.items.push(item);
  saveDB(db);

  return res.status(201).json(item);
});

//GET /inventory
app.get("/inventory", (req, res) => {
  const db = loadDB();

  const enriched = db.items.map((it) => ({
    ...it,
    photo_url: it.photo
      ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo`
      : null,
  }));

  res.status(200).json(enriched);
});

//GET /inventory/:id
app.get("/inventory/:id", (req, res) => {
  const db = loadDB();
  const it = db.items.find((x) => x.id === req.params.id);

  if (!it) return res.status(404).json({ error: "Not found" });

  return res.status(200).json({
    ...it,
    photo_url: it.photo
      ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo`
      : null,
  });
});

//PUT /inventory/:id
app.put("/inventory/:id", (req, res) => {
  const db = loadDB();
  const idx = db.items.findIndex((x) => x.id === req.params.id);

  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const { name, description } = req.body;

  if (name !== undefined) db.items[idx].name = name;
  if (description !== undefined) db.items[idx].description = description;

  db.items[idx].updatedAt = new Date().toISOString();
  saveDB(db);

  return res.status(200).json(db.items[idx]);
});

//GET /inventory/:id/photo
app.get("/inventory/:id/photo", (req, res) => {
  const db = loadDB();
  const it = db.items.find((x) => x.id === req.params.id);

  if (!it || !it.photo) return res.status(404).send("Photo not found");

  const fpath = path.join(UPLOADS_DIR, it.photo);

  if (!fs.existsSync(fpath)) return res.status(404).send("Photo not found");

  res.setHeader("Content-Type", "image/jpeg");
  fs.createReadStream(fpath).pipe(res);
});

//PUT /inventory/:id/photo
app.put("/inventory/:id/photo", upload.single("photo"), (req, res) => {
  const db = loadDB();
  const idx = db.items.findIndex((x) => x.id === req.params.id);

  if (idx === -1) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: "Not found" });
  }

  if (!req.file)
    return res.status(400).json({ error: "photo file is required" });

  const oldPhoto = db.items[idx].photo;
  if (oldPhoto && fs.existsSync(path.join(UPLOADS_DIR, oldPhoto))) {
    fs.unlinkSync(path.join(UPLOADS_DIR, oldPhoto));
  }

  db.items[idx].photo = req.file.filename;
  db.items[idx].updatedAt = new Date().toISOString();
  saveDB(db);

  return res.status(200).json(db.items[idx]);
});

//DELETE /inventory/:id
app.delete("/inventory/:id", (req, res) => {
  const db = loadDB();
  const idx = db.items.findIndex((x) => x.id === req.params.id);

  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const photo = db.items[idx].photo;
  if (photo) {
    const p = path.join(UPLOADS_DIR, photo);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const deleted = db.items.splice(idx, 1)[0];
  saveDB(db);

  return res.status(200).json({ deleted: deleted.id });
});

//GET /search
app.get("/search", (req, res) => {
  const { id, includePhoto } = req.query;

  if (!id) return res.status(400).json({ error: "id is required" });

  const db = loadDB();
  const it = db.items.find((x) => x.id === id);

  if (!it) return res.status(404).json({ error: "Not found" });

  return res.status(200).json({
    ...it,
    photo_url:
      includePhoto && it.photo
        ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo`
        : null,
  });
});

//POST /search
app.post("/search", (req, res) => {
  const { id, has_photo } = req.body;

  if (!id) return res.status(400).json({ error: "id is required" });

  const db = loadDB();
  const it = db.items.find((x) => x.id === id);

  if (!it) return res.status(404).json({ error: "Not found" });

  return res.status(200).json({
    ...it,
    photo_url:
      has_photo && it.photo
        ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo`
        : null,
  });
});

//405
function allow(allowed) {
  return (req, res) => {
    if (!allowed.includes(req.method)) {
      res.setHeader("Allow", allowed.join(", "));
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    res.status(404).end();
  };
}

app.all("/register", allow(["POST"]));
app.all("/inventory", allow(["GET"]));
app.all("/inventory/:id", allow(["GET", "PUT", "DELETE"]));
app.all("/inventory/:id/photo", allow(["GET", "PUT"]));
app.all("/search", allow(["GET", "POST"]));

const server = http.createServer(app);

server.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});
