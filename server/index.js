import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { DEFAULT_SUPER_ADMIN, db, hashPassword, initDatabase, todayLocal, verifyPassword } from "./db.js";
import { allowRoles, authRequired, canAccessPanel, createSession } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = Number(process.env.PORT || 4173);

initDatabase();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.display_name,
  role: user.role,
  panelId: user.panel_id,
  panelName: user.panel_name || null
});

const normalizePhone = (raw = "") => {
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("0092")) digits = digits.slice(2);
  if (digits.startsWith("92") && digits.length === 12) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("3")) digits = `0${digits}`;
  return digits;
};

const ticketSelect = `
  SELECT t.*, p.name AS panel_name
  FROM tickets t JOIN panels p ON p.id = t.panel_id
`;

const mapTicket = (ticket) => ticket && ({
  id: ticket.id,
  tokenNumber: ticket.token_number,
  tokenCode: ticket.token_code,
  fullName: ticket.full_name,
  phone: ticket.phone_display,
  banoqabilId: ticket.banoqabil_id,
  course: ticket.course,
  panelId: ticket.panel_id,
  panelName: ticket.panel_name,
  status: ticket.status,
  calledAt: ticket.called_at,
  startedAt: ticket.started_at,
  completedAt: ticket.completed_at,
  createdAt: ticket.created_at
});

function audit(userId, action, ticketId = null, details = null) {
  db.prepare("INSERT INTO audit_log (user_id, action, ticket_id, details) VALUES (?, ?, ?, ?)")
    .run(userId, action, ticketId, details ? JSON.stringify(details) : null);
}

function broadcastUpdate(type, payload = {}) {
  io.emit("queue:update", { type, ...payload, at: new Date().toISOString() });
}

app.get("/api/health", (_req, res) => res.json({ ok: true, date: todayLocal() }));

app.get("/api/setup/status", (_req, res) => {
  const initialized = Boolean(db.prepare("SELECT 1 FROM users WHERE role = 'reception' LIMIT 1").get());
  res.json({ initialized, superAdminUsername: DEFAULT_SUPER_ADMIN.username });
});

app.post("/api/setup/initialize", (req, res) => {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'reception' LIMIT 1").get()) {
    return res.status(409).json({ error: "System setup has already been completed." });
  }
  const receptionName = String(req.body.receptionName || "").trim().replace(/\s+/g, " ");
  const receptionUsername = String(req.body.receptionUsername || "").trim().toLowerCase();
  const receptionPassword = String(req.body.receptionPassword || "");
  const validUsername = /^[a-z0-9._-]{3,30}$/;
  if (receptionName.length < 2) return res.status(400).json({ error: "Enter a valid Reception display name." });
  if (!validUsername.test(receptionUsername)) return res.status(400).json({ error: "Username must be 3–30 characters using letters, numbers, dot, dash or underscore." });
  if (receptionUsername === DEFAULT_SUPER_ADMIN.username) return res.status(400).json({ error: "Reception username cannot be the Super Admin username." });
  if (receptionPassword.length < 8) return res.status(400).json({ error: "Reception password must be at least 8 characters." });

  try {
    const admin = db.transaction(() => {
      db.prepare(`
        INSERT INTO users (username, password_hash, display_name, role, panel_id)
        VALUES (?, ?, ?, 'reception', NULL)
      `).run(receptionUsername, hashPassword(receptionPassword), receptionName);
      return db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND role = 'admin'").get(DEFAULT_SUPER_ADMIN.username);
    })();
    const token = createSession(admin.id);
    audit(admin.id, "system_initialized", null, { receptionUsername });
    res.status(201).json({ token, user: publicUser(admin) });
  } catch (error) {
    if (String(error.code).includes("UNIQUE")) return res.status(409).json({ error: "One of those usernames is already in use." });
    console.error(error);
    res.status(500).json({ error: "Could not initialize the system." });
  }
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.prepare(`
    SELECT u.*, p.name AS panel_name, p.active AS panel_active
    FROM users u LEFT JOIN panels p ON p.id = u.panel_id
    WHERE u.username = ? COLLATE NOCASE AND u.active = 1
  `).get(username);
  if (user?.role === "panel" && !user.panel_active) {
    return res.status(403).json({ error: "This panel is currently inactive." });
  }
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Username or password is incorrect." });
  }
  const token = createSession(user.id);
  audit(user.id, "login");
  res.json({ token, user: publicUser(user) });
});

app.get("/api/auth/me", authRequired, (req, res) => res.json({ user: publicUser(req.user) }));

app.post("/api/auth/logout", authRequired, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(req.sessionHash);
  res.status(204).end();
});

app.get("/api/panels", authRequired, (_req, res) => {
  res.json({ panels: db.prepare("SELECT id, name FROM panels WHERE active = 1 ORDER BY id").all() });
});

app.get("/api/admin/panels", authRequired, allowRoles("admin"), (_req, res) => {
  const date = todayLocal();
  const panels = db.prepare(`
    SELECT p.id, p.name, p.active, u.username, u.display_name,
      (SELECT COUNT(*) FROM tickets t WHERE t.panel_id = p.id AND t.event_date = ? AND t.status = 'waiting') AS waiting,
      (SELECT COUNT(*) FROM tickets t WHERE t.panel_id = p.id AND t.event_date = ? AND t.status IN ('called','in_interview')) AS current,
      (SELECT COUNT(*) FROM tickets t WHERE t.panel_id = p.id AND t.event_date = ? AND t.status = 'completed') AS completed
    FROM panels p
    LEFT JOIN users u ON u.panel_id = p.id AND u.role = 'panel'
    ORDER BY p.id
  `).all(date, date, date);
  res.json({ panels });
});

app.post("/api/admin/panels", authRequired, allowRoles("admin"), (req, res) => {
  const name = String(req.body.name || "").trim().replace(/\s+/g, " ");
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2 || name.length > 50) return res.status(400).json({ error: "Panel name must be 2–50 characters." });
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return res.status(400).json({ error: "Username must be 3–30 characters using letters, numbers, dot, dash or underscore." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

  try {
    const panel = db.transaction(() => {
      const created = db.prepare("INSERT INTO panels (name, active) VALUES (?, 1)").run(name);
      const panelId = Number(created.lastInsertRowid);
      db.prepare(`
        INSERT INTO users (username, password_hash, display_name, role, panel_id)
        VALUES (?, ?, ?, 'panel', ?)
      `).run(username, hashPassword(password), `${name} Interviewer`, panelId);
      audit(req.user.id, "panel_created", null, { panelId, name, username });
      return db.prepare(`
        SELECT p.id, p.name, p.active, u.username, u.display_name, 0 AS waiting, 0 AS current, 0 AS completed
        FROM panels p JOIN users u ON u.panel_id = p.id AND u.role = 'panel' WHERE p.id = ?
      `).get(panelId);
    })();
    broadcastUpdate("panel_created", { panelId: panel.id });
    res.status(201).json({ panel });
  } catch (error) {
    if (String(error.code).includes("UNIQUE")) return res.status(409).json({ error: "That username is already in use." });
    console.error(error);
    res.status(500).json({ error: "Could not create the panel." });
  }
});

app.patch("/api/admin/panels/:panelId", authRequired, allowRoles("admin"), (req, res) => {
  const panelId = Number(req.params.panelId);
  const panel = db.prepare("SELECT * FROM panels WHERE id = ?").get(panelId);
  if (!panel) return res.status(404).json({ error: "Panel not found." });
  const name = req.body.name === undefined ? panel.name : String(req.body.name).trim().replace(/\s+/g, " ");
  const active = req.body.active === undefined ? panel.active : (req.body.active ? 1 : 0);
  if (name.length < 2 || name.length > 50) return res.status(400).json({ error: "Panel name must be 2–50 characters." });
  if (!active && panel.active) {
    const inQueue = db.prepare("SELECT COUNT(*) AS count FROM tickets WHERE panel_id = ? AND event_date = ? AND status IN ('waiting','called','in_interview')").get(panelId, todayLocal()).count;
    if (inQueue) return res.status(409).json({ error: "Complete or move this panel’s active queue before deactivating it." });
  }
  db.transaction(() => {
    db.prepare("UPDATE panels SET name = ?, active = ? WHERE id = ?").run(name, active, panelId);
    db.prepare("UPDATE users SET display_name = ?, active = ? WHERE panel_id = ? AND role = 'panel'").run(`${name} Interviewer`, active, panelId);
    audit(req.user.id, "panel_updated", null, { panelId, name, active: Boolean(active) });
  })();
  broadcastUpdate("panel_updated", { panelId });
  res.json({ panel: { id: panelId, name, active } });
});

app.patch("/api/admin/panels/:panelId/password", authRequired, allowRoles("admin"), (req, res) => {
  const panelId = Number(req.params.panelId);
  const password = String(req.body.password || "");
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  const result = db.prepare("UPDATE users SET password_hash = ? WHERE panel_id = ? AND role = 'panel'").run(hashPassword(password), panelId);
  if (!result.changes) return res.status(404).json({ error: "Panel login not found." });
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE panel_id = ? AND role = 'panel')").run(panelId);
  audit(req.user.id, "panel_password_reset", null, { panelId });
  res.status(204).end();
});

app.get("/api/admin/receptions", authRequired, allowRoles("admin"), (_req, res) => {
  const receptions = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.active, u.created_at,
      (SELECT COUNT(*) FROM tickets t WHERE t.created_by = u.id AND t.event_date = ?) AS tickets_today
    FROM users u WHERE u.role = 'reception' ORDER BY u.id
  `).all(todayLocal());
  res.json({ receptions });
});

app.post("/api/admin/receptions", authRequired, allowRoles("admin"), (req, res) => {
  const displayName = String(req.body.displayName || "").trim().replace(/\s+/g, " ");
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (displayName.length < 2 || displayName.length > 50) return res.status(400).json({ error: "Reception name must be 2–50 characters." });
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return res.status(400).json({ error: "Username must be 3–30 characters using letters, numbers, dot, dash or underscore." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  try {
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, panel_id)
      VALUES (?, ?, ?, 'reception', NULL)
    `).run(username, hashPassword(password), displayName);
    audit(req.user.id, "reception_created", null, { receptionId: Number(result.lastInsertRowid), username });
    const reception = db.prepare(`
      SELECT id, username, display_name, active, created_at, 0 AS tickets_today FROM users WHERE id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json({ reception });
  } catch (error) {
    if (String(error.code).includes("UNIQUE")) return res.status(409).json({ error: "That username is already in use." });
    console.error(error);
    res.status(500).json({ error: "Could not create the Reception account." });
  }
});

app.patch("/api/admin/receptions/:userId", authRequired, allowRoles("admin"), (req, res) => {
  const userId = Number(req.params.userId);
  const reception = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'reception'").get(userId);
  if (!reception) return res.status(404).json({ error: "Reception account not found." });
  const displayName = req.body.displayName === undefined ? reception.display_name : String(req.body.displayName).trim().replace(/\s+/g, " ");
  const active = req.body.active === undefined ? reception.active : (req.body.active ? 1 : 0);
  if (displayName.length < 2 || displayName.length > 50) return res.status(400).json({ error: "Reception name must be 2–50 characters." });
  db.prepare("UPDATE users SET display_name = ?, active = ? WHERE id = ?").run(displayName, active, userId);
  if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  audit(req.user.id, "reception_updated", null, { receptionId: userId, displayName, active: Boolean(active) });
  res.json({ reception: { id: userId, display_name: displayName, active } });
});

app.patch("/api/admin/receptions/:userId/password", authRequired, allowRoles("admin"), (req, res) => {
  const userId = Number(req.params.userId);
  const password = String(req.body.password || "");
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const result = db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND role = 'reception'").run(hashPassword(password), userId);
  if (!result.changes) return res.status(404).json({ error: "Reception account not found." });
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  audit(req.user.id, "reception_password_reset", null, { receptionId: userId });
  res.status(204).end();
});

app.get("/api/stats", authRequired, (req, res) => {
  const date = todayLocal();
  const panelFilter = req.user.role === "panel" ? "AND panel_id = @panelId" : "";
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count FROM tickets
    WHERE event_date = @date ${panelFilter}
    GROUP BY status
  `).all({ date, panelId: req.user.panel_id });
  const stats = { total: 0, waiting: 0, called: 0, in_interview: 0, completed: 0, skipped: 0 };
  for (const row of rows) { stats[row.status] = row.count; stats.total += row.count; }
  const byPanel = db.prepare(`
    SELECT p.id, p.name,
      SUM(CASE WHEN t.status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN t.status IN ('called','in_interview') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed
    FROM panels p LEFT JOIN tickets t ON t.panel_id = p.id AND t.event_date = ?
    WHERE p.active = 1 GROUP BY p.id ORDER BY p.id
  `).all(date);
  res.json({ stats, byPanel });
});

app.get("/api/tickets", authRequired, (req, res) => {
  const date = String(req.query.date || todayLocal());
  const panelId = req.user.role === "panel" ? req.user.panel_id : Number(req.query.panelId || 0);
  const status = String(req.query.status || "");
  const clauses = ["t.event_date = ?"];
  const params = [date];
  if (panelId) { clauses.push("t.panel_id = ?"); params.push(panelId); }
  if (status) { clauses.push("t.status = ?"); params.push(status); }
  const tickets = db.prepare(`${ticketSelect} WHERE ${clauses.join(" AND ")} ORDER BY t.id DESC LIMIT 300`).all(...params);
  res.json({ tickets: tickets.map(mapTicket) });
});

app.post("/api/tickets", authRequired, allowRoles("admin", "reception"), (req, res) => {
  const fullName = String(req.body.fullName || "").trim().replace(/\s+/g, " ");
  const phoneDisplay = String(req.body.phone || "").trim();
  const phone = normalizePhone(phoneDisplay);
  const banoqabilId = String(req.body.banoqabilId || "").trim();
  const course = String(req.body.course || "").trim();
  let panelId = Number(req.body.panelId || 0);

  if (fullName.length < 2) return res.status(400).json({ error: "Please enter the candidate's full name." });
  if (!/^03\d{9}$/.test(phone)) return res.status(400).json({ error: "Enter a valid Pakistani mobile number, e.g. 03001234567." });
  if (!course) return res.status(400).json({ error: "Please enter or select a course." });

  const duplicate = db.prepare(`${ticketSelect} WHERE t.phone = ?`).get(phone);
  if (duplicate) return res.status(409).json({ error: "This phone number is already registered.", ticket: mapTicket(duplicate) });

  const date = todayLocal();
  if (!panelId) {
    const best = db.prepare(`
      SELECT p.id, COUNT(t.id) AS load
      FROM panels p LEFT JOIN tickets t ON t.panel_id = p.id
        AND t.event_date = ? AND t.status IN ('waiting','called','in_interview')
      WHERE p.active = 1 GROUP BY p.id ORDER BY load ASC, p.id ASC LIMIT 1
    `).get(date);
    panelId = best.id;
  }
  if (!db.prepare("SELECT id FROM panels WHERE id = ? AND active = 1").get(panelId)) {
    return res.status(400).json({ error: "Please choose a valid active panel." });
  }

  const createTicket = db.transaction(() => {
    const row = db.prepare("SELECT COALESCE(MAX(token_number), 0) + 1 AS next FROM tickets WHERE panel_id = ? AND event_date = ?")
      .get(panelId, date);
    const tokenCode = `P${panelId}-${String(row.next).padStart(3, "0")}`;
    const result = db.prepare(`
      INSERT INTO tickets
        (token_number, token_code, full_name, phone, phone_display, banoqabil_id, course, panel_id, event_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.next, tokenCode, fullName, phone, phoneDisplay, banoqabilId || null, course, panelId, date, req.user.id);
    audit(req.user.id, "ticket_created", result.lastInsertRowid, { panelId });
    return db.prepare(`${ticketSelect} WHERE t.id = ?`).get(result.lastInsertRowid);
  });

  try {
    const ticket = createTicket();
    broadcastUpdate("ticket_created", { ticketId: ticket.id, panelId });
    res.status(201).json({ ticket: mapTicket(ticket) });
  } catch (error) {
    if (String(error.code).includes("UNIQUE")) return res.status(409).json({ error: "This phone number is already registered." });
    console.error(error);
    res.status(500).json({ error: "Could not create the ticket." });
  }
});

app.post("/api/panels/:panelId/call-next", authRequired, allowRoles("admin", "panel"), (req, res) => {
  const panelId = Number(req.params.panelId);
  if (!canAccessPanel(req.user, panelId)) return res.status(403).json({ error: "You can only operate your assigned panel." });

  const callNext = db.transaction(() => {
    const existing = db.prepare(`${ticketSelect} WHERE t.panel_id = ? AND t.event_date = ? AND t.status IN ('called','in_interview') ORDER BY t.id LIMIT 1`)
      .get(panelId, todayLocal());
    if (existing) return { existing };
    const next = db.prepare(`${ticketSelect} WHERE t.panel_id = ? AND t.event_date = ? AND t.status = 'waiting' ORDER BY t.id LIMIT 1`)
      .get(panelId, todayLocal());
    if (!next) return {};
    db.prepare("UPDATE tickets SET status = 'called', called_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(next.id);
    audit(req.user.id, "ticket_called", next.id);
    return { ticket: db.prepare(`${ticketSelect} WHERE t.id = ?`).get(next.id) };
  });
  const result = callNext();
  if (result.existing) return res.status(409).json({ error: "Finish or skip the current candidate first.", ticket: mapTicket(result.existing) });
  if (!result.ticket) return res.status(404).json({ error: "No candidates are waiting in this panel." });
  broadcastUpdate("ticket_called", { ticketId: result.ticket.id, panelId });
  res.json({ ticket: mapTicket(result.ticket) });
});

app.patch("/api/tickets/:id/status", authRequired, allowRoles("admin", "panel"), (req, res) => {
  const id = Number(req.params.id);
  const nextStatus = String(req.body.status || "");
  const ticket = db.prepare(`${ticketSelect} WHERE t.id = ?`).get(id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });
  if (!canAccessPanel(req.user, ticket.panel_id)) return res.status(403).json({ error: "You can only operate your assigned panel." });

  const allowed = {
    waiting: ["called", "skipped"], called: ["in_interview", "skipped", "waiting"],
    in_interview: ["completed", "skipped"], skipped: ["waiting"], completed: []
  };
  if (!allowed[ticket.status]?.includes(nextStatus)) {
    return res.status(400).json({ error: `Cannot change ${ticket.status} to ${nextStatus}.` });
  }

  const timestamps = nextStatus === "in_interview" ? ", started_at = CURRENT_TIMESTAMP"
    : nextStatus === "completed" ? ", completed_at = CURRENT_TIMESTAMP" : "";
  db.prepare(`UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP ${timestamps} WHERE id = ?`).run(nextStatus, id);
  audit(req.user.id, `status_${nextStatus}`, id);
  const updated = db.prepare(`${ticketSelect} WHERE t.id = ?`).get(id);
  broadcastUpdate("status_changed", { ticketId: id, panelId: ticket.panel_id, status: nextStatus });
  res.json({ ticket: mapTicket(updated) });
});

app.get("/api/display", (_req, res) => {
  const date = todayLocal();
  const panels = db.prepare(`
    SELECT p.id, p.name,
      (SELECT token_code FROM tickets c WHERE c.panel_id = p.id AND c.event_date = ? AND c.status IN ('called','in_interview') ORDER BY c.id LIMIT 1) AS current_token,
      (SELECT full_name FROM tickets c WHERE c.panel_id = p.id AND c.event_date = ? AND c.status IN ('called','in_interview') ORDER BY c.id LIMIT 1) AS current_name,
      (SELECT status FROM tickets c WHERE c.panel_id = p.id AND c.event_date = ? AND c.status IN ('called','in_interview') ORDER BY c.id LIMIT 1) AS current_status,
      (SELECT COUNT(*) FROM tickets w WHERE w.panel_id = p.id AND w.event_date = ? AND w.status = 'waiting') AS waiting
    FROM panels p WHERE p.active = 1 ORDER BY p.id
  `).all(date, date, date, date);
  res.json({ panels, updatedAt: new Date().toISOString() });
});

app.get("/api/network", authRequired, allowRoles("admin", "reception"), (_req, res) => {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) if (item.family === "IPv4" && !item.internal) addresses.push(`http://${item.address}:${PORT}`);
  }
  res.json({ addresses, displayPath: "/?display=1" });
});

if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "..", "dist");
  app.use(express.static(dist));
  app.get("*splat", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

export function startServer() {
  return new Promise((resolve) => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Bano Qabil Queue running at http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();

export { app, server, normalizePhone };
