import crypto from "node:crypto";
import { db } from "./db.js";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, datetime('now', '+24 hours'))
  `).run(sha256(token), userId);
  return token;
}

export function authRequired(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Login required" });

  const user = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.panel_id, p.name AS panel_name
    FROM sessions s JOIN users u ON u.id = s.user_id
    LEFT JOIN panels p ON p.id = u.panel_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1
      AND (u.role != 'panel' OR p.active = 1)
  `).get(sha256(token));
  if (!user) return res.status(401).json({ error: "Session expired. Please log in again." });
  req.user = user;
  req.sessionHash = sha256(token);
  next();
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "You do not have access to this action." });
    next();
  };
}

export function canAccessPanel(user, panelId) {
  return user.role !== "panel" || Number(user.panel_id) === Number(panelId);
}
