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
  createdAt: ticket.created_at,
  eventDate: ticket.event_date,
  interviewScore: ticket.interview_score,
  interviewRemarks: ticket.interview_remarks || ""
});

const cleanCandidate = (body) => ({
  fullName: String(body.fullName || "").trim().replace(/\s+/g, " "),
  phoneDisplay: String(body.phone || "").trim(),
  phone: normalizePhone(body.phone),
  banoqabilId: String(body.banoqabilId || "").trim(),
  course: String(body.course || "").trim(),
  panelId: Number(body.panelId || 0)
});

function candidateError(candidate) {
  if (candidate.fullName.length < 2) return "Please enter the candidate's full name.";
  if (!/^03\d{9}$/.test(candidate.phone)) return "Enter a valid Pakistani mobile number, e.g. 03001234567.";
  if (!candidate.course) return "Please enter or select a course.";
  return null;
}

function nextToken(panelId, date) {
  const row = db.prepare("SELECT COALESCE(MAX(token_number), 0) + 1 AS next FROM tickets WHERE panel_id = ? AND event_date = ?")
    .get(panelId, date);
  return { tokenNumber: row.next, tokenCode: `P${panelId}-${String(row.next).padStart(3, "0")}` };
}

const exportColumns = [
  ["Event Date", "event_date"], ["Token", "token_code"], ["Candidate Name", "full_name"],
  ["Phone", "phone_display"], ["Bano Qabil ID", "banoqabil_id"], ["Course", "course"],
  ["Panel", "panel_name"], ["Status", "status"], ["Score (1-10)", "interview_score"],
  ["Remarks", "interview_remarks"], ["Registered At", "created_at"], ["Called At", "called_at"],
  ["Interview Started At", "started_at"], ["Completed At", "completed_at"]
];

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
export function ticketsToCsv(rows) {
  return [exportColumns.map(([label]) => csvCell(label)).join(","), ...rows.map((row) => exportColumns.map(([, key]) => csvCell(row[key])).join(","))].join("\r\n");
}

const xmlCell = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
export function ticketsToExcelXml(rows) {
  const tableRows = [exportColumns.map(([label]) => label), ...rows.map((row) => exportColumns.map(([, key]) => row[key]))]
    .map((values, index) => `<Row>${values.map((value) => `<Cell${index === 0 ? ' ss:StyleID="Header"' : ""}><Data ss:Type="String">${xmlCell(value)}</Data></Cell>`).join("")}</Row>`).join("");
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#DDEFE8" ss:Pattern="Solid"/></Style></Styles><Worksheet ss:Name="Candidates"><Table>${tableRows}</Table></Worksheet></Workbook>`;
}

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

app.patch("/api/auth/password", authRequired, allowRoles("panel", "reception"), (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const minimum = user.role === "reception" ? 8 : 6;
  if (!verifyPassword(currentPassword, user.password_hash)) return res.status(400).json({ error: "Current password is incorrect." });
  if (newPassword.length < minimum) return res.status(400).json({ error: `New password must be at least ${minimum} characters.` });
  if (currentPassword === newPassword) return res.status(400).json({ error: "Choose a password different from your current password." });
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(newPassword), user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(user.id, req.sessionHash);
    audit(user.id, "password_changed");
  })();
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

app.get("/api/exports/tickets", authRequired, allowRoles("admin", "reception"), (req, res) => {
  const date = String(req.query.date || todayLocal());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Choose a valid event date." });
  const rows = db.prepare(`${ticketSelect} WHERE t.event_date = ? ORDER BY t.panel_id, t.token_number`).all(date);
  const format = String(req.query.format || "csv").toLowerCase();
  if (format === "xls") {
    res.set({ "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="banoqabil-candidates-${date}.xls"` });
    return res.send(ticketsToExcelXml(rows));
  }
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="banoqabil-candidates-${date}.csv"` });
  res.send(`\uFEFF${ticketsToCsv(rows)}`);
});

app.post("/api/tickets", authRequired, allowRoles("admin", "reception"), (req, res) => {
  const candidate = cleanCandidate(req.body);
  let { panelId } = candidate;
  const validationError = candidateError(candidate);
  if (validationError) return res.status(400).json({ error: validationError });

  const duplicate = db.prepare(`${ticketSelect} WHERE t.phone = ?`).get(candidate.phone);
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
    const token = nextToken(panelId, date);
    const result = db.prepare(`
      INSERT INTO tickets
        (token_number, token_code, full_name, phone, phone_display, banoqabil_id, course, panel_id, event_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(token.tokenNumber, token.tokenCode, candidate.fullName, candidate.phone, candidate.phoneDisplay, candidate.banoqabilId || null, candidate.course, panelId, date, req.user.id);
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

app.patch("/api/tickets/:id", authRequired, allowRoles("admin", "reception"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`${ticketSelect} WHERE t.id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: "Ticket not found." });
  const candidate = cleanCandidate(req.body);
  const validationError = candidateError(candidate);
  if (validationError) return res.status(400).json({ error: validationError });
  if (db.prepare("SELECT id FROM tickets WHERE phone = ? AND id != ?").get(candidate.phone, id)) return res.status(409).json({ error: "This phone number is already registered." });
  const reassigned = candidate.panelId !== existing.panel_id;
  if (reassigned && !db.prepare("SELECT id FROM panels WHERE id = ? AND active = 1").get(candidate.panelId)) return res.status(400).json({ error: "Please choose a valid active panel." });
  if (reassigned && !["waiting", "skipped"].includes(existing.status)) return res.status(409).json({ error: "Only waiting or skipped candidates can be reassigned." });
  db.transaction(() => {
    if (reassigned) {
      const token = nextToken(candidate.panelId, existing.event_date);
      db.prepare(`UPDATE tickets SET full_name = ?, phone = ?, phone_display = ?, banoqabil_id = ?, course = ?, panel_id = ?, token_number = ?, token_code = ?, status = 'waiting', called_at = NULL, started_at = NULL, completed_at = NULL, interview_score = NULL, interview_remarks = NULL, interviewed_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(candidate.fullName, candidate.phone, candidate.phoneDisplay, candidate.banoqabilId || null, candidate.course, candidate.panelId, token.tokenNumber, token.tokenCode, id);
    } else {
      db.prepare("UPDATE tickets SET full_name = ?, phone = ?, phone_display = ?, banoqabil_id = ?, course = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(candidate.fullName, candidate.phone, candidate.phoneDisplay, candidate.banoqabilId || null, candidate.course, id);
    }
    audit(req.user.id, reassigned ? "ticket_reassigned" : "ticket_updated", id, { fromPanelId: existing.panel_id, toPanelId: candidate.panelId });
  })();
  const updated = db.prepare(`${ticketSelect} WHERE t.id = ?`).get(id);
  broadcastUpdate(reassigned ? "ticket_reassigned" : "ticket_updated", { ticketId: id, panelId: candidate.panelId });
  res.json({ ticket: mapTicket(updated) });
});

app.post("/api/tickets/:id/regenerate", authRequired, allowRoles("admin", "reception"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`${ticketSelect} WHERE t.id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: "Ticket not found." });
  if (!["waiting", "skipped"].includes(existing.status)) return res.status(409).json({ error: "Only waiting or skipped tickets can be regenerated." });
  const token = nextToken(existing.panel_id, existing.event_date);
  db.prepare(`UPDATE tickets SET token_number = ?, token_code = ?, status = 'waiting', called_at = NULL, started_at = NULL, completed_at = NULL, interview_score = NULL, interview_remarks = NULL, interviewed_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(token.tokenNumber, token.tokenCode, id);
  audit(req.user.id, "ticket_regenerated", id, { previousToken: existing.token_code, tokenCode: token.tokenCode });
  const updated = db.prepare(`${ticketSelect} WHERE t.id = ?`).get(id);
  broadcastUpdate("ticket_regenerated", { ticketId: id, panelId: existing.panel_id });
  res.json({ ticket: mapTicket(updated) });
});

app.delete("/api/tickets/:id", authRequired, allowRoles("admin", "reception"), (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });
  if (!["waiting", "skipped"].includes(ticket.status)) return res.status(409).json({ error: "Only waiting or skipped tickets can be deleted." });
  db.transaction(() => {
    audit(req.user.id, "ticket_deleted", null, { ticketId: id, tokenCode: ticket.token_code, candidate: ticket.full_name });
    db.prepare("DELETE FROM tickets WHERE id = ?").run(id);
  })();
  broadcastUpdate("ticket_deleted", { ticketId: id, panelId: ticket.panel_id });
  res.status(204).end();
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

  let score = ticket.interview_score;
  let remarks = ticket.interview_remarks;
  if (nextStatus === "completed") {
    score = Number(req.body.score ?? ticket.interview_score);
    remarks = String(req.body.remarks ?? ticket.interview_remarks ?? "").trim();
    if (!Number.isInteger(score) || score < 1 || score > 10) return res.status(400).json({ error: "Choose an interview score from 1 to 10 before completing." });
    if (remarks.length > 2000) return res.status(400).json({ error: "Remarks must be 2,000 characters or fewer." });
  }

  const timestamps = nextStatus === "in_interview" ? ", started_at = CURRENT_TIMESTAMP"
    : nextStatus === "completed" ? ", completed_at = CURRENT_TIMESTAMP" : "";
  db.prepare(`UPDATE tickets SET status = ?, interview_score = ?, interview_remarks = ?, interviewed_by = CASE WHEN ? = 'completed' THEN ? ELSE interviewed_by END, updated_at = CURRENT_TIMESTAMP ${timestamps} WHERE id = ?`)
    .run(nextStatus, score, remarks, nextStatus, req.user.id, id);
  audit(req.user.id, `status_${nextStatus}`, id);
  const updated = db.prepare(`${ticketSelect} WHERE t.id = ?`).get(id);
  broadcastUpdate("status_changed", { ticketId: id, panelId: ticket.panel_id, status: nextStatus });
  res.json({ ticket: mapTicket(updated) });
});

app.patch("/api/tickets/:id/interview", authRequired, allowRoles("admin", "panel"), (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.prepare(`${ticketSelect} WHERE t.id = ?`).get(id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });
  if (!canAccessPanel(req.user, ticket.panel_id)) return res.status(403).json({ error: "You can only score candidates assigned to your panel." });
  if (!["in_interview", "completed"].includes(ticket.status)) return res.status(409).json({ error: "Start the interview before saving a score." });
  const score = Number(req.body.score);
  const remarks = String(req.body.remarks || "").trim();
  if (!Number.isInteger(score) || score < 1 || score > 10) return res.status(400).json({ error: "Score must be a whole number from 1 to 10." });
  if (remarks.length > 2000) return res.status(400).json({ error: "Remarks must be 2,000 characters or fewer." });
  db.prepare("UPDATE tickets SET interview_score = ?, interview_remarks = ?, interviewed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(score, remarks, req.user.id, id);
  audit(req.user.id, "interview_scored", id, { score });
  const updated = db.prepare(`${ticketSelect} WHERE t.id = ?`).get(id);
  broadcastUpdate("interview_scored", { ticketId: id, panelId: ticket.panel_id });
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
