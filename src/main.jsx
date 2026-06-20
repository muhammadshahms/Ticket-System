import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { io } from "socket.io-client";
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Copy, DoorOpen, Download,
  FileSpreadsheet, Hash, LockKeyhole, LogOut, MessageSquare, Monitor, Pencil,
  Link2, Phone, Play, Plus, Power, Printer, QrCode, RefreshCw, Save, Search, ShieldCheck,
  SkipForward, Sparkles, Star, Ticket, Trash2, UserRound, UsersRound, Volume2, Wifi
} from "lucide-react";
import QRCode from "qrcode";
import bqLogo from "../assets/banoqabil-logo.png";
import { OFFICIAL_BANOQABIL_COURSES } from "./banoqabilCourses.js";
import "./styles.css";

const api = async (path, options = {}) => {
  const token = localStorage.getItem("bq_token");
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong.");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
};

const formatTime = (value) => value
  ? new Date(`${value.replace(" ", "T")}Z`).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  : "—";

const statusLabels = {
  waiting: "Waiting", called: "Called", in_interview: "In interview",
  completed: "Completed", skipped: "Skipped"
};

const DEFAULT_SUPER_ADMIN = {
  username: "admin",
  password: "BanoQabil@2026"
};

const localDate = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

async function downloadExport(date, format, filters = {}) {
  const token = localStorage.getItem("bq_token");
  const parameters = new URLSearchParams({ date, format });
  for (const [key, value] of Object.entries(filters)) if (value !== "" && value !== undefined && value !== null) parameters.set(key, value);
  const response = await fetch(`/api/exports/tickets?${parameters}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Could not export candidate data.");
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `banoqabil-candidates-${date}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const field = document.createElement("textarea");
  field.value = value;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

function BrandLogo({ className = "" }) {
  return <img className={`bq-logo ${className}`} src={bqLogo} alt="Bano Qabil" />;
}

function useLiveUpdates() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const socket = io();
    socket.on("queue:update", () => setVersion((value) => value + 1));
    return () => socket.disconnect();
  }, []);
  return [version, () => setVersion((value) => value + 1)];
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onClose, 4500);
    return () => clearTimeout(timer);
  }, [toast, onClose]);
  if (!toast) return null;
  return <div className={`toast ${toast.type || "success"}`}><CheckCircle2 size={19} />{toast.message}</div>;
}

function SetupWizard({ onComplete }) {
  const [form, setForm] = useState({
    receptionName: "", receptionUsername: "", receptionPassword: ""
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const submit = async (event) => {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const result = await api("/setup/initialize", { method: "POST", body: JSON.stringify(form) });
      localStorage.setItem("bq_token", result.token);
      onComplete(result.user);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  return <main className="setup-page">
    <section className="setup-intro"><div className="brand-mark bq-brand-mark"><BrandLogo /></div><div className="eyebrow light">Bano Qabil Ticket System</div><h1>Make the system yours.</h1><p>Made by Bano Qabil Incubation. Super Admin login is already fixed; create your first Reception desk, then add exactly the panels and extra desks you need.</p><div className="setup-points"><span><CheckCircle2 size={18} /> Runs locally without internet</span><span><CheckCircle2 size={18} /> Fixed Super Admin for event-day access</span><span><CheckCircle2 size={18} /> Panels and desks are created by you</span></div></section>
    <section className="setup-form-side"><form className="setup-card" onSubmit={submit}>
      <div className="eyebrow">System initialization</div><h2>Create first Reception</h2><p className="muted">This setup appears only once on a new database. Super Admin is already available.</p>
      <div className="setup-account default-admin-card"><div className="setup-account-title"><ShieldCheck size={19} /><span><strong>Super Admin Login</strong><small>Creates panels, Reception desks, and manages the system</small></span></div><div className="credential-grid"><span>Username<strong>{DEFAULT_SUPER_ADMIN.username}</strong></span><span>Password<strong>{DEFAULT_SUPER_ADMIN.password}</strong></span></div></div>
      <div className="setup-account"><div className="setup-account-title"><UserRound size={19} /><span><strong>Reception Desk</strong><small>Registers candidates and prints tickets</small></span></div><div className="setup-fields"><label>Display name<input required placeholder="e.g. Registration Desk" value={form.receptionName} onChange={update("receptionName")} /></label><label>Username<input required pattern="[a-zA-Z0-9._-]{3,30}" placeholder="Choose username" value={form.receptionUsername} onChange={update("receptionUsername")} /></label><label className="full">Password<input required minLength="8" type="password" placeholder="Minimum 8 characters" value={form.receptionPassword} onChange={update("receptionPassword")} /></label></div></div>
      {error && <div className="form-error">{error}</div>}
      <button className="button primary wide" disabled={loading}>{loading ? "Creating workspace…" : <>Finish setup <ArrowRight size={18} /></>}</button>
    </form></section>
  </main>;
}

function Login({ onLogin, scope = null, onUseRegular }) {
  const [form, setForm] = useState({ username: scope?.username || "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const body = scope ? { slug: scope.slug, password: form.password } : form;
      const result = await api("/auth/login", { method: "POST", body: JSON.stringify(body) });
      localStorage.setItem("bq_token", result.token);
      onLogin(result.user);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  return <main className="login-page">
    <section className="login-brand">
      <div className="brand-mark bq-brand-mark"><BrandLogo /></div>
      <div className="eyebrow light">{scope ? `${scope.role} access link` : "Bano Qabil Ticket System"}</div>
      <h1>{scope ? <>{scope.displayName}<br />is ready.</> : <>Interviews, flowing<br />without the chaos.</>}</h1>
      <p>{scope ? "You opened a dedicated workspace link. Enter its password to continue securely." : "A focused queue system for registration desks and interview panels—fast, fair, and live."}</p>
      <div className="brand-stat">{scope ? <><Wifi size={22} /><span><strong>Same network required</strong><small>Stay connected to the host laptop’s Wi-Fi or hotspot</small></span></> : <><UsersRound size={22} /><span><strong>Flexible panels</strong><small>Create and name every interview queue</small></span></>}</div>
      <div className="made-by">Made by Bano Qabil Incubation</div>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="mobile-logo"><BrandLogo /> <span>Bano Qabil<small>Ticket System</small></span></div>
        <div className="eyebrow">{scope ? `${scope.role} workspace` : "Secure access"}</div>
        <h2>{scope ? scope.displayName : "Welcome back"}</h2>
        <p className="muted">{scope ? "Your username is already selected. Enter the account password." : "Sign in to your assigned workspace."}</p>
        {scope ? <div className="scoped-login-note"><QrCode size={18} /><span><strong>Dedicated account link</strong><small>Connected devices still need this account’s password.</small></span></div> : <div className="default-login-note"><ShieldCheck size={17} /><span>Super Admin: <strong>{DEFAULT_SUPER_ADMIN.username}</strong> / <strong>{DEFAULT_SUPER_ADMIN.password}</strong></span></div>}
        <label>Username<input required readOnly={Boolean(scope)} autoFocus={!scope} autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
        <label>Password<input required autoFocus={Boolean(scope)} type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="button primary wide" disabled={loading}>{loading ? "Signing in…" : <>Open {scope ? scope.role : "workspace"} <ArrowRight size={18} /></>}</button>
        {scope && <button type="button" className="regular-login-link" onClick={onUseRegular}>Use regular login instead</button>}
      </form>
    </section>
  </main>;
}

function PasswordDialog({ user, onClose }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError("");
    if (form.newPassword !== form.confirmPassword) return setError("New passwords do not match.");
    setBusy(true);
    try {
      await api("/auth/password", { method: "PATCH", body: JSON.stringify(form) });
      window.alert("Password changed successfully.");
      onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Change password">
    <form className="form-dialog" onSubmit={submit}>
      <button type="button" className="dialog-close" onClick={onClose}>×</button>
      <div className="eyebrow">Account security</div><h2>Change password</h2><p className="muted">Enter your current password, then choose a new one.</p>
      <label>Current password<input required autoFocus type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} /></label>
      <label>New password<input required minLength={user.role === "reception" ? 8 : 6} type="password" autoComplete="new-password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} /></label>
      <label>Confirm new password<input required type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></label>
      {error && <div className="form-error">{error}</div>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Changing…" : "Change password"}</button></div>
    </form>
  </div>;
}

function Shell({ user, onLogout, children, connection }) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-brand"><span><BrandLogo /></span><div>Bano Qabil Ticket System<small>Made by Bano Qabil Incubation</small></div></div>
      <div className="topbar-right">
        {connection && <div className="network-chip"><Wifi size={15} /><span>{connection}</span></div>}
        <div className="user-chip"><div>{user.displayName?.charAt(0)}</div><span>{user.displayName}<small>{user.role === "panel" ? (user.panelName || `Panel ${user.panelId}`) : user.role === "admin" ? "Super Admin" : user.role}</small></span></div>
        {user.role !== "admin" && <button className="icon-button" title="Change password" onClick={() => setPasswordOpen(true)}><LockKeyhole size={18} /></button>}
        <button className="icon-button" title="Log out" onClick={onLogout}><LogOut size={19} /></button>
      </div>
    </header>
    {children}
    {passwordOpen && <PasswordDialog user={user} onClose={() => setPasswordOpen(false)} />}
  </div>;
}

function StatCard({ icon: Icon, label, value, tone, detail }) {
  return <article className={`stat-card ${tone || ""}`}>
    <div className="stat-icon"><Icon size={21} /></div>
    <div><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>
  </article>;
}

function TicketPrint({ ticket, onClose }) {
  if (!ticket) return null;
  return <div className="modal-backdrop">
    <div className="ticket-dialog">
      <button className="dialog-close no-print" onClick={onClose}>×</button>
      <div className="print-ticket">
        <div className="ticket-logo"><BrandLogo /><span>BANO QABIL TICKET SYSTEM<small>MADE BY BANO QABIL INCUBATION</small></span></div>
        <div className="ticket-rule" />
        <p>Your interview token</p>
        <h2>{ticket.tokenCode}</h2>
        <div className="ticket-panel">Please proceed to <strong>{ticket.panelName}</strong></div>
        <dl>
          <div><dt>Candidate</dt><dd>{ticket.fullName}</dd></div>
          <div><dt>Course</dt><dd>{ticket.course}</dd></div>
          {ticket.banoqabilId && <div><dt>BQ ID</dt><dd>{ticket.banoqabilId}</dd></div>}
        </dl>
        <div className="ticket-rule" />
        <small>Keep this ticket with you until your interview is complete.</small>
      </div>
      <div className="dialog-actions no-print">
        <button className="button secondary" onClick={onClose}>Close</button>
        <button className="button primary" onClick={() => window.print()}><Printer size={17} /> Print ticket</button>
      </div>
    </div>
  </div>;
}

function RegistrationForm({ panels, onCreated, setToast }) {
  const initial = { fullName: "", phone: "", banoqabilId: "", course: "", panelId: "" };
  const [form, setForm] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const submit = async (event) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const result = await api("/tickets", { method: "POST", body: JSON.stringify(form) });
      setForm(initial); onCreated(result.ticket);
      setToast({ message: `${result.ticket.tokenCode} generated for ${result.ticket.fullName}.` });
    } catch (err) {
      setError(err.message + (err.data?.ticket ? ` Existing token: ${err.data.ticket.tokenCode}` : ""));
    } finally { setLoading(false); }
  };
  return <form className="registration-form" onSubmit={submit}>
    <div className="section-heading"><div><div className="eyebrow">New candidate</div><h2>Generate interview ticket</h2><p>Phone number is checked across all registrations.</p></div><div className="step-badge">01</div></div>
    <div className="form-grid">
      <label className="span-2">Candidate name <span>*</span><div className="input-wrap"><UserRound size={18} /><input required placeholder="e.g. Muhammad Ali" value={form.fullName} onChange={update("fullName")} /></div></label>
      <label>Phone number <span>*</span><div className="input-wrap"><Phone size={18} /><input required inputMode="tel" placeholder="0300 1234567" value={form.phone} onChange={update("phone")} /></div></label>
      <label>Bano Qabil ID<div className="input-wrap"><Hash size={18} /><input placeholder="Optional" value={form.banoqabilId} onChange={update("banoqabilId")} /></div></label>
      <label>Course <span>*</span><div className="input-wrap"><Ticket size={18} /><input required list="banoqabil-course-list" placeholder="Select or type course" value={form.course} onChange={update("course")} /></div><small className="field-note">{OFFICIAL_BANOQABIL_COURSES.length} Bano Qabil courses loaded</small></label>
      <datalist id="banoqabil-course-list">{OFFICIAL_BANOQABIL_COURSES.map((course) => <option key={course} value={course} />)}</datalist>
      <label>Assign panel<div className="input-wrap"><DoorOpen size={18} /><select value={form.panelId} onChange={update("panelId")}><option value="">Auto — shortest queue</option>{panels.map((panel) => <option key={panel.id} value={panel.id}>{panel.name}</option>)}</select></div></label>
    </div>
    {error && <div className="form-error">{error}</div>}
    <div className="form-footer"><span><Sparkles size={15} /> Auto assignment keeps all panels balanced.</span><button className="button primary" disabled={loading}><Plus size={18} />{loading ? "Generating…" : "Generate ticket"}</button></div>
  </form>;
}

function DataExport({ date, onDateChange, setToast }) {
  const [busy, setBusy] = useState("");
  const run = async (format) => {
    setBusy(format);
    try {
      await downloadExport(date, format);
      setToast?.({ message: `${format === "xls" ? "Excel" : "CSV"} export downloaded for ${date}.` });
    } catch (err) { setToast?.({ type: "error", message: err.message }); } finally { setBusy(""); }
  };
  return <div className="export-controls">
    <label>Event date<input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} /></label>
    <button className="button secondary" disabled={Boolean(busy)} onClick={() => run("csv")}><Download size={17} />{busy === "csv" ? "Exporting…" : "CSV"}</button>
    <button className="button secondary" disabled={Boolean(busy)} onClick={() => run("xls")}><FileSpreadsheet size={17} />{busy === "xls" ? "Exporting…" : "Excel"}</button>
  </div>;
}

function CandidateEditor({ ticket, panels, onClose, onSaved, onDeleted, setToast, allowAnyDelete = false }) {
  const [form, setForm] = useState({ fullName: ticket.fullName, phone: ticket.phone, banoqabilId: ticket.banoqabilId || "", course: ticket.course, panelId: String(ticket.panelId) });
  const [busy, setBusy] = useState(false);
  const editableQueue = ["waiting", "skipped"].includes(ticket.status);
  const panelOptions = panels.some((panel) => Number(panel.id) === Number(ticket.panelId)) ? panels : [{ id: ticket.panelId, name: ticket.panelName }, ...panels];
  const save = async (event) => {
    event.preventDefault();
    const reassigned = Number(form.panelId) !== Number(ticket.panelId);
    if (reassigned && !window.confirm(`Move ${ticket.fullName} to another panel? A new token will be issued.`)) return;
    setBusy(true);
    try {
      const result = await api(`/tickets/${ticket.id}`, { method: "PATCH", body: JSON.stringify(form) });
      setToast({ message: reassigned ? `${result.ticket.tokenCode} issued after reassignment.` : "Candidate details updated." });
      onSaved(result.ticket, reassigned);
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setBusy(false); }
  };
  const regenerate = async () => {
    if (!window.confirm(`Regenerate ${ticket.tokenCode}? The old token will no longer be used.`)) return;
    setBusy(true);
    try {
      const result = await api(`/tickets/${ticket.id}/regenerate`, { method: "POST" });
      setToast({ message: `Fresh token ${result.ticket.tokenCode} generated.` });
      onSaved(result.ticket, true);
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (allowAnyDelete) {
      const confirmation = window.prompt(`Type ${ticket.tokenCode} to permanently delete ${ticket.fullName}.`);
      if (confirmation !== ticket.tokenCode) {
        if (confirmation !== null) setToast({ type: "error", message: `Deletion cancelled. Type ${ticket.tokenCode} exactly.` });
        return;
      }
    } else if (!window.confirm(`Delete ${ticket.fullName} (${ticket.tokenCode})? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api(`/tickets/${ticket.id}`, { method: "DELETE" });
      setToast({ message: `${ticket.tokenCode} deleted.` }); onDeleted();
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit candidate">
    <form className="form-dialog candidate-dialog" onSubmit={save}>
      <button type="button" className="dialog-close" onClick={onClose}>×</button>
      <div className="eyebrow">{ticket.tokenCode}</div><h2>Edit candidate</h2><p className="muted">Changing the panel automatically issues the next token in that queue.</p>
      <div className="form-grid">
        <label className="span-2">Candidate name<input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
        <label>Phone number<input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <label>Bano Qabil ID<input value={form.banoqabilId} onChange={(event) => setForm({ ...form, banoqabilId: event.target.value })} /></label>
        <label>Course<input required list="banoqabil-course-list" value={form.course} onChange={(event) => setForm({ ...form, course: event.target.value })} /></label>
        <label>Assigned panel<select disabled={!editableQueue} value={form.panelId} onChange={(event) => setForm({ ...form, panelId: event.target.value })}>{panelOptions.map((panel) => <option key={panel.id} value={panel.id}>{panel.name}</option>)}</select></label>
      </div>
      {!editableQueue && <div className="form-note">This candidate is active or completed, so panel reassignment and ticket regeneration are locked.{allowAnyDelete ? " Super Admin can still edit details or permanently delete the record." : ""}</div>}
      <div className="dialog-footer split"><div><button type="button" className="button danger-quiet" disabled={busy || (!editableQueue && !allowAnyDelete)} onClick={remove}><Trash2 size={16} /> Delete</button><button type="button" className="button secondary" disabled={busy || !editableQueue} onClick={regenerate}><RefreshCw size={16} /> Regenerate</button></div><div><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}><Save size={16} /> Save</button></div></div>
    </form>
  </div>;
}

function QueueTable({ tickets, panels, date, onDateChange, onChanged, onPrint, setToast }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const filtered = tickets.filter((ticket) => [ticket.tokenCode, ticket.fullName, ticket.phone, ticket.course].some((value) => value?.toLowerCase().includes(query.toLowerCase())));
  return <section className="table-card">
    <div className="table-head"><div><h3>Candidates · {date}</h3><p>{tickets.length} registrations</p></div><div className="table-tools"><DataExport date={date} onDateChange={onDateChange} setToast={setToast} /><div className="search"><Search size={17} /><input placeholder="Search name, token, phone…" value={query} onChange={(e) => setQuery(e.target.value)} /></div></div></div>
    <div className="table-scroll"><table><thead><tr><th>Token</th><th>Candidate</th><th>Course</th><th>Panel</th><th>Status</th><th>Score</th><th>Time</th><th>Actions</th></tr></thead>
      <tbody>{filtered.length ? filtered.map((ticket) => <tr key={ticket.id}><td><strong className="token-mini">{ticket.tokenCode}</strong></td><td><strong>{ticket.fullName}</strong><small>{ticket.phone}</small></td><td>{ticket.course}</td><td>{ticket.panelName}</td><td><span className={`status ${ticket.status}`}>{statusLabels[ticket.status]}</span></td><td>{ticket.interviewScore ? `${ticket.interviewScore}/10` : "—"}</td><td>{formatTime(ticket.createdAt)}</td><td><div className="row-actions"><button title="Print ticket" onClick={() => onPrint(ticket)}><Printer size={15} /></button><button title="Edit candidate" onClick={() => setEditing(ticket)}><Pencil size={15} /></button></div></td></tr>) : <tr><td colSpan="8" className="empty-cell">No candidates found.</td></tr>}</tbody>
    </table></div>
    {editing && <CandidateEditor ticket={editing} panels={panels} onClose={() => setEditing(null)} onSaved={(updated, shouldPrint) => { setEditing(null); onChanged(); if (shouldPrint) onPrint(updated); }} onDeleted={() => { setEditing(null); onChanged(); }} setToast={setToast} />}
  </section>;
}

function DeleteAllCandidatesDialog({ total, onClose, onDeleted, setToast }) {
  const phrase = "DELETE ALL CANDIDATES";
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const result = await api("/admin/candidates", { method: "DELETE", body: JSON.stringify({ confirmation }) });
      setToast({ message: `${result.deleted} candidate record${result.deleted === 1 ? "" : "s"} permanently deleted.` });
      onDeleted();
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete all candidate data">
    <form className="form-dialog danger-dialog" onSubmit={submit}>
      <button type="button" className="dialog-close" onClick={onClose}>×</button>
      <div className="danger-icon"><AlertTriangle size={25} /></div><div className="eyebrow danger-text">Permanent danger zone</div><h2>Delete all candidate data?</h2>
      <p className="muted">This permanently removes all <strong>{total}</strong> candidate records across every event date, including scores and remarks. Accounts and panels will remain.</p>
      <div className="danger-callout">This action cannot be undone. Export a backup before continuing.</div>
      <label>Type <strong>{phrase}</strong> to confirm<input required autoFocus autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button destructive" disabled={busy || confirmation !== phrase}><Trash2 size={17} />{busy ? "Deleting…" : "Delete all data"}</button></div>
    </form>
  </div>;
}

function AdminCandidateManager({ panels, version, refresh, setToast }) {
  const [tickets, setTickets] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ query: "", date: "", status: "", panelId: "" });
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState("");
  useEffect(() => { const timer = setTimeout(() => { setDebouncedQuery(filters.query); setPage(1); }, 300); return () => clearTimeout(timer); }, [filters.query]);
  useEffect(() => {
    let active = true;
    const parameters = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (debouncedQuery) parameters.set("query", debouncedQuery);
    if (filters.date) parameters.set("date", filters.date);
    if (filters.status) parameters.set("status", filters.status);
    if (filters.panelId) parameters.set("panelId", filters.panelId);
    setLoading(true);
    api(`/admin/candidates?${parameters}`).then((result) => {
      if (!active) return;
      setTickets(result.tickets); setPagination(result.pagination);
      if (result.pagination.page !== page) setPage(result.pagination.page);
    }).catch((err) => setToast({ type: "error", message: err.message })).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, debouncedQuery, filters.date, filters.status, filters.panelId, version]);
  const updateFilter = (key) => (event) => { setFilters((current) => ({ ...current, [key]: event.target.value })); if (key !== "query") setPage(1); };
  const exportData = async (format) => {
    setExporting(format);
    try {
      await downloadExport(filters.date || "all", format, { query: debouncedQuery, status: filters.status, panelId: filters.panelId });
      setToast({ message: `${format === "xls" ? "Excel" : "CSV"} candidate export downloaded.` });
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setExporting(""); }
  };
  const deleteTicket = async (ticket) => {
    const confirmation = window.prompt(`Type ${ticket.tokenCode} to permanently delete ${ticket.fullName}.`);
    if (confirmation !== ticket.tokenCode) {
      if (confirmation !== null) setToast({ type: "error", message: `Deletion cancelled. Type ${ticket.tokenCode} exactly.` });
      return;
    }
    try {
      await api(`/tickets/${ticket.id}`, { method: "DELETE" });
      setToast({ message: `${ticket.tokenCode} permanently deleted.` }); refresh();
    } catch (err) { setToast({ type: "error", message: err.message }); }
  };
  const firstRecord = pagination.total ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const lastRecord = Math.min(pagination.page * pagination.pageSize, pagination.total);
  return <section className="table-card admin-candidate-manager">
    <div className="admin-candidate-head"><div><div className="eyebrow">Candidate database</div><h2>All candidate records</h2><p>Search, edit, export, or remove candidates across every event date.</p></div><div className="admin-data-actions"><button className="button secondary" disabled={Boolean(exporting)} onClick={() => exportData("csv")}><Download size={17} />{exporting === "csv" ? "Exporting…" : "CSV"}</button><button className="button secondary" disabled={Boolean(exporting)} onClick={() => exportData("xls")}><FileSpreadsheet size={17} />{exporting === "xls" ? "Exporting…" : "Excel"}</button><button className="button danger-quiet" disabled={!pagination.total} onClick={() => setDeleteAllOpen(true)}><Trash2 size={17} /> Delete all</button></div></div>
    <div className="admin-candidate-filters"><div className="search admin-search"><Search size={17} /><input placeholder="Search token, name, phone, ID, course…" value={filters.query} onChange={updateFilter("query")} /></div><label>Event date<input type="date" value={filters.date} onChange={updateFilter("date")} /><small>{filters.date ? "Selected date" : "All dates"}</small></label><label>Status<select value={filters.status} onChange={updateFilter("status")}><option value="">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Panel<select value={filters.panelId} onChange={updateFilter("panelId")}><option value="">All panels</option>{panels.map((panel) => <option key={panel.id} value={panel.id}>{panel.name}{panel.active ? "" : " (inactive)"}</option>)}</select></label></div>
    <div className="table-scroll"><table><thead><tr><th>Date</th><th>Token</th><th>Candidate</th><th>Course</th><th>Panel</th><th>Status</th><th>Score</th><th>Actions</th></tr></thead><tbody>{loading ? <tr><td colSpan="8" className="empty-cell">Loading candidate records…</td></tr> : tickets.length ? tickets.map((ticket) => <tr key={ticket.id}><td>{ticket.eventDate}</td><td><strong className="token-mini">{ticket.tokenCode}</strong></td><td><strong>{ticket.fullName}</strong><small>{ticket.phone}{ticket.banoqabilId ? ` · ${ticket.banoqabilId}` : ""}</small></td><td>{ticket.course}</td><td>{ticket.panelName}</td><td><span className={`status ${ticket.status}`}>{statusLabels[ticket.status]}</span></td><td>{ticket.interviewScore ? `${ticket.interviewScore}/10` : "—"}</td><td><div className="row-actions"><button title="Print ticket" onClick={() => setPrinting(ticket)}><Printer size={15} /></button><button title="Edit candidate" onClick={() => setEditing(ticket)}><Pencil size={15} /></button><button className="delete-row" title="Delete candidate" onClick={() => deleteTicket(ticket)}><Trash2 size={15} /></button></div></td></tr>) : <tr><td colSpan="8" className="empty-cell">No candidates match these filters.</td></tr>}</tbody></table></div>
    <div className="pagination-bar"><span>Showing <strong>{firstRecord}–{lastRecord}</strong> of <strong>{pagination.total}</strong></span><div><button className="button secondary" disabled={pagination.page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /> Previous</button><span>Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong></span><button className="button secondary" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={16} /></button></div></div>
    {editing && <CandidateEditor ticket={editing} panels={panels} allowAnyDelete onClose={() => setEditing(null)} onSaved={(updated, shouldPrint) => { setEditing(null); refresh(); if (shouldPrint) setPrinting(updated); }} onDeleted={() => { setEditing(null); refresh(); }} setToast={setToast} />}
    <TicketPrint ticket={printing} onClose={() => setPrinting(null)} />
    {deleteAllOpen && <DeleteAllCandidatesDialog total={pagination.total} onClose={() => setDeleteAllOpen(false)} onDeleted={() => { setDeleteAllOpen(false); setPage(1); refresh(); }} setToast={setToast} />}
  </section>;
}

function ReceptionDashboard({ user, onLogout, version, refresh }) {
  const [data, setData] = useState({ panels: [], tickets: [], stats: {}, byPanel: [], network: [] });
  const [ticket, setTicket] = useState(null);
  const [toast, setToast] = useState(null);
  const [eventDate, setEventDate] = useState(localDate());
  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => {
    Promise.all([api("/panels"), api(`/tickets?date=${eventDate}`), api("/stats"), api("/network")]).then(([p, t, s, n]) => setData({ panels: p.panels, tickets: t.tickets, stats: s.stats, byPanel: s.byPanel, network: n.addresses })).catch(console.error);
  }, [version, eventDate]);
  const created = (newTicket) => { setTicket(newTicket); refresh(); };
  const copyDisplay = async () => {
    const url = `${data.network[0] || window.location.origin}/?display=1`;
    await navigator.clipboard.writeText(url); setToast({ message: "Display screen link copied." });
  };
  return <Shell user={user} onLogout={onLogout} connection={data.network[0]?.replace("http://", "") || "Local host"}>
    <main className="dashboard">
      <section className="welcome-row"><div><div className="eyebrow">Interview operations</div><h1>Good day, let’s keep things moving.</h1><p>Register candidates and watch every panel queue in real time.</p></div><button className="button secondary" onClick={copyDisplay}><Monitor size={18} /> Copy display link</button></section>
      <section className="stats-grid">
        <StatCard icon={UsersRound} label="Registered today" value={data.stats.total || 0} detail="Across all panels" />
        <StatCard icon={Clock3} label="Waiting" value={data.stats.waiting || 0} tone="amber" detail="Ready to be called" />
        <StatCard icon={Play} label="In progress" value={(data.stats.called || 0) + (data.stats.in_interview || 0)} tone="blue" detail="Called or interviewing" />
        <StatCard icon={CheckCircle2} label="Completed" value={data.stats.completed || 0} tone="green" detail="Interviews finished" />
      </section>
      <section className="reception-layout">
        <RegistrationForm panels={data.panels} onCreated={created} setToast={setToast} />
        <aside className="panel-load-card"><div className="section-heading compact"><div><div className="eyebrow">Live load</div><h2>Panel queues</h2></div><span className="live-dot">LIVE</span></div>
          <div className="panel-list">{data.byPanel.map((panel) => <div className="panel-load" key={panel.id}><span className={`panel-number p${panel.id}`}>P{panel.id}</span><div><strong>{panel.name}</strong><small>{panel.active ? "Interview in progress" : "Ready for next"}</small></div><div className="load-count"><strong>{panel.waiting}</strong><small>waiting</small></div><ChevronRight size={18} /></div>)}</div>
          <div className="balance-note"><Sparkles size={18} /><span><strong>Smart balancing is on</strong><small>Auto-assigned candidates go to the shortest active queue.</small></span></div>
        </aside>
      </section>
      <QueueTable tickets={data.tickets} panels={data.panels} date={eventDate} onDateChange={setEventDate} onChanged={refresh} onPrint={setTicket} setToast={setToast} />
    </main>
    <TicketPrint ticket={ticket} onClose={() => setTicket(null)} />
    <Toast toast={toast} onClose={() => setToast(null)} />
  </Shell>;
}

function AccessLinkDialog({ account, onClose, setToast }) {
  const [network, setNetwork] = useState({ addresses: [], interfaces: [], preferredAddress: null });
  const [selectedAddress, setSelectedAddress] = useState("");
  const [qrData, setQrData] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loadNetwork = async () => {
    setLoading(true); setError("");
    try {
      const result = await api("/network");
      setNetwork(result);
      setSelectedAddress((current) => result.addresses.includes(current) ? current : (result.preferredAddress || result.addresses[0] || ""));
      if (!result.addresses.length) setError("No LAN or hotspot address was detected. Connect the host laptop to the event network first.");
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  useEffect(() => { loadNetwork(); }, [account.accessSlug]);
  const accessUrl = selectedAddress ? `${selectedAddress}/?role=${encodeURIComponent(account.role)}&id=${encodeURIComponent(account.accessSlug)}` : "";
  useEffect(() => {
    let active = true;
    if (!accessUrl) { setQrData(""); return () => { active = false; }; }
    QRCode.toDataURL(accessUrl, { width: 300, margin: 1, errorCorrectionLevel: "M", color: { dark: "#081e19", light: "#ffffff" } })
      .then((value) => { if (active) setQrData(value); })
      .catch(() => { if (active) setError("Could not generate the QR code."); });
    return () => { active = false; };
  }, [accessUrl]);
  const copy = async () => {
    try { await copyText(accessUrl); setToast({ message: `${account.displayName} login link copied.` }); }
    catch { setToast({ type: "error", message: "Could not copy the link. Select it manually instead." }); }
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${account.displayName} access link`}>
    <div className="form-dialog access-link-dialog">
      <button type="button" className="dialog-close" onClick={onClose}>×</button>
      <div className="eyebrow">Dedicated login · {account.role}</div><h2>{account.displayName}</h2><p className="muted">Scan this QR code or open the link on a device connected to the same Wi-Fi or hotspot.</p>
      {network.addresses.length > 0 && <label>Host network address<select value={selectedAddress} onChange={(event) => setSelectedAddress(event.target.value)}>{network.addresses.map((address) => { const item = network.interfaces?.find((entry) => entry.address === address); return <option key={address} value={address}>{address.replace("http://", "")}{item?.interfaceName ? ` · ${item.interfaceName}` : ""}</option>; })}</select></label>}
      {error && <div className="form-error">{error}</div>}
      {loading ? <div className="qr-loading"><RefreshCw size={25} /> Detecting current network…</div> : accessUrl && <div className="access-link-content">
        <div className="qr-frame">{qrData ? <img src={qrData} alt={`QR code for ${account.displayName}`} /> : <RefreshCw size={28} />}</div>
        <div className="access-link-details"><span className="role-pill">{account.role}</span><strong>@{account.username}</strong><label>Direct login URL<input readOnly value={accessUrl} onFocus={(event) => event.target.select()} /></label><button className="button primary" onClick={copy}><Copy size={17} /> Copy link</button><button className="button secondary" onClick={loadNetwork}><RefreshCw size={17} /> Refresh IP</button></div>
      </div>}
      <div className="network-warning"><Wifi size={19} /><span><strong>Same network only</strong><small>First connect the device to this host laptop’s Wi-Fi/hotspot, then scan or open the link. The password is still required.</small></span></div>
    </div>
  </div>;
}

function ManagedPanel({ panel, onUpdated, setToast, onGetLink }) {
  const [name, setName] = useState(panel.name);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(panel.name), [panel.name]);

  const updatePanel = async (changes, success) => {
    if (changes.active === false && !window.confirm(`Deactivate ${panel.name}? Its login will stop working.`)) return;
    setBusy(true);
    try {
      await api(`/admin/panels/${panel.id}`, { method: "PATCH", body: JSON.stringify(changes) });
      setToast({ message: success }); onUpdated();
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setBusy(false); }
  };
  const resetPassword = async () => {
    if (password.length < 6) { setToast({ type: "error", message: "Password must be at least 6 characters." }); return; }
    if (!window.confirm(`Reset ${panel.name}'s login password? Existing panel sessions will be signed out.`)) return;
    setBusy(true);
    try {
      await api(`/admin/panels/${panel.id}/password`, { method: "PATCH", body: JSON.stringify({ password }) });
      setPassword(""); setToast({ message: `${panel.name} password updated.` });
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setBusy(false); }
  };

  return <article className={`managed-panel ${panel.active ? "" : "inactive"}`}>
    <div className="managed-panel-head">
      <span className="admin-panel-number">P{panel.id}</span>
      <div><strong>{panel.name}</strong><small>@{panel.username || "no-login"}</small></div>
      <span className={`panel-state ${panel.active ? "active" : "inactive"}`}>{panel.active ? "Active" : "Inactive"}</span>
    </div>
    <div className="managed-stats"><span><strong>{panel.waiting}</strong>Waiting</span><span><strong>{panel.current}</strong>Current</span><span><strong>{panel.completed}</strong>Completed</span></div>
    <button className="button access-link-button" disabled={!panel.active || !panel.access_slug} onClick={onGetLink}><Link2 size={16} /> Get login link & QR</button>
    <label>Panel display name<div className="input-wrap"><Pencil size={16} /><input value={name} onChange={(event) => setName(event.target.value)} /></div></label>
    <button className="button secondary wide-small" disabled={busy || name.trim() === panel.name} onClick={() => updatePanel({ name }, "Panel name updated everywhere.")}><Save size={16} /> Save name</button>
    <div className="password-reset"><label>New login password<div className="input-wrap"><LockKeyhole size={16} /><input type="password" placeholder="At least 6 characters" value={password} onChange={(event) => setPassword(event.target.value)} /></div></label><button className="button secondary" disabled={busy || !password} onClick={resetPassword}>Reset</button></div>
    <button className={`button panel-toggle ${panel.active ? "deactivate" : "activate"}`} disabled={busy} onClick={() => updatePanel({ active: !panel.active }, `${panel.name} ${panel.active ? "deactivated" : "activated"}.`)}><Power size={16} /> {panel.active ? "Deactivate panel" : "Activate panel"}</button>
  </article>;
}

function ManagedReception({ reception, onUpdated, setToast, onGetLink }) {
  const [displayName, setDisplayName] = useState(reception.display_name);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setDisplayName(reception.display_name), [reception.display_name]);
  const updateReception = async (changes, success) => {
    if (changes.active === false && !window.confirm(`Deactivate ${reception.display_name}? This Reception will be signed out.`)) return;
    setBusy(true);
    try {
      await api(`/admin/receptions/${reception.id}`, { method: "PATCH", body: JSON.stringify(changes) });
      setToast({ message: success }); onUpdated();
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setBusy(false); }
  };
  const resetPassword = async () => {
    if (password.length < 8) { setToast({ type: "error", message: "Password must be at least 8 characters." }); return; }
    if (!window.confirm(`Reset ${reception.display_name}'s password? Existing sessions will be signed out.`)) return;
    setBusy(true);
    try {
      await api(`/admin/receptions/${reception.id}/password`, { method: "PATCH", body: JSON.stringify({ password }) });
      setPassword(""); setToast({ message: `${reception.display_name} password updated.` });
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setBusy(false); }
  };
  return <article className={`managed-panel managed-reception ${reception.active ? "" : "inactive"}`}>
    <div className="managed-panel-head"><span className="admin-panel-number reception-number">R</span><div><strong>{reception.display_name}</strong><small>@{reception.username}</small></div><span className={`panel-state ${reception.active ? "active" : "inactive"}`}>{reception.active ? "Active" : "Inactive"}</span></div>
    <div className="reception-activity"><Ticket size={17} /><span><strong>{reception.tickets_today}</strong> tickets generated today</span></div>
    <button className="button access-link-button" disabled={!reception.active || !reception.access_slug} onClick={onGetLink}><Link2 size={16} /> Get login link & QR</button>
    <label>Reception display name<div className="input-wrap"><Pencil size={16} /><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></div></label>
    <button className="button secondary wide-small" disabled={busy || displayName.trim() === reception.display_name} onClick={() => updateReception({ displayName }, "Reception name updated.")}><Save size={16} /> Save name</button>
    <div className="password-reset"><label>New login password<div className="input-wrap"><LockKeyhole size={16} /><input type="password" placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} /></div></label><button className="button secondary" disabled={busy || !password} onClick={resetPassword}>Reset</button></div>
    <button className={`button panel-toggle ${reception.active ? "deactivate" : "activate"}`} disabled={busy} onClick={() => updateReception({ active: !reception.active }, `${reception.display_name} ${reception.active ? "deactivated" : "activated"}.`)}><Power size={16} /> {reception.active ? "Deactivate Reception" : "Activate Reception"}</button>
  </article>;
}

function SuperAdminDashboard({ user, onLogout, version, refresh }) {
  const emptyForm = { name: "", username: "", password: "" };
  const emptyReceptionForm = { displayName: "", username: "", password: "" };
  const [panels, setPanels] = useState([]);
  const [receptions, setReceptions] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [receptionForm, setReceptionForm] = useState(emptyReceptionForm);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [receptionBusy, setReceptionBusy] = useState(false);
  const [linkAccount, setLinkAccount] = useState(null);
  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => {
    Promise.all([api("/admin/panels"), api("/admin/receptions")])
      .then(([panelResult, receptionResult]) => { setPanels(panelResult.panels); setReceptions(receptionResult.receptions); })
      .catch((err) => setToast({ type: "error", message: err.message }));
  }, [version]);
  const createPanel = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const result = await api("/admin/panels", { method: "POST", body: JSON.stringify(form) });
      setForm(emptyForm); setToast({ message: `${result.panel.name} created with login @${result.panel.username}.` }); refresh();
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setBusy(false); }
  };
  const createReception = async (event) => {
    event.preventDefault(); setReceptionBusy(true);
    try {
      const result = await api("/admin/receptions", { method: "POST", body: JSON.stringify(receptionForm) });
      setReceptionForm(emptyReceptionForm); setToast({ message: `${result.reception.display_name} Reception account created.` }); refresh();
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setReceptionBusy(false); }
  };
  const active = panels.filter((panel) => panel.active).length;
  const activeReceptions = receptions.filter((reception) => reception.active).length;
  const waiting = panels.reduce((sum, panel) => sum + Number(panel.waiting || 0), 0);
  return <Shell user={user} onLogout={onLogout} connection="System control">
    <main className="dashboard admin-dashboard">
      <section className="welcome-row"><div><div className="eyebrow">Bano Qabil · Super Admin</div><h1>Ticket system control center</h1><p>Create interview panels and multiple Reception desks with their own secure logins.</p></div><div className="admin-badge"><ShieldCheck size={20} /> Full system access</div></section>
      <section className="stats-grid admin-stats">
        <StatCard icon={DoorOpen} label="Total panels" value={panels.length} detail="Created workspaces" />
        <StatCard icon={Wifi} label="Active panels" value={active} tone="green" detail="Available for tickets" />
        <StatCard icon={UserRound} label="Reception desks" value={activeReceptions} tone="blue" detail="Active login accounts" />
        <StatCard icon={Clock3} label="Waiting now" value={waiting} tone="amber" detail="Across active queues" />
      </section>
      <AdminCandidateManager panels={panels} version={version} refresh={refresh} setToast={setToast} />
      <section className="admin-create-card">
        <div className="section-heading"><div><div className="eyebrow">Add workspace</div><h2>Create a new panel</h2><p>The panel receives its own queue and interviewer login immediately.</p></div><div className="step-badge"><Plus size={17} /></div></div>
        <form onSubmit={createPanel} className="admin-create-form">
          <label>Panel name <span>*</span><div className="input-wrap"><DoorOpen size={17} /><input required placeholder="e.g. Web Development Panel" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div></label>
          <label>Login username <span>*</span><div className="input-wrap"><UserRound size={17} /><input required placeholder="e.g. web-panel" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></div></label>
          <label>Login password <span>*</span><div className="input-wrap"><LockKeyhole size={17} /><input required minLength="6" type="password" placeholder="At least 6 characters" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></div></label>
          <button className="button primary" disabled={busy}><Plus size={18} />{busy ? "Creating…" : "Create panel"}</button>
        </form>
      </section>
      <section className="admin-create-card reception-create-card">
        <div className="section-heading"><div><div className="eyebrow">Add registration desk</div><h2>Create a Reception account</h2><p>Each Reception gets a separate login and shares the same live ticket database.</p></div><div className="step-badge"><UserRound size={17} /></div></div>
        <form onSubmit={createReception} className="admin-create-form">
          <label>Reception name <span>*</span><div className="input-wrap"><UserRound size={17} /><input required placeholder="e.g. Gate 1 Registration" value={receptionForm.displayName} onChange={(event) => setReceptionForm({ ...receptionForm, displayName: event.target.value })} /></div></label>
          <label>Login username <span>*</span><div className="input-wrap"><UserRound size={17} /><input required placeholder="e.g. reception-gate1" value={receptionForm.username} onChange={(event) => setReceptionForm({ ...receptionForm, username: event.target.value })} /></div></label>
          <label>Login password <span>*</span><div className="input-wrap"><LockKeyhole size={17} /><input required minLength="8" type="password" placeholder="At least 8 characters" value={receptionForm.password} onChange={(event) => setReceptionForm({ ...receptionForm, password: event.target.value })} /></div></label>
          <button className="button primary" disabled={receptionBusy}><Plus size={18} />{receptionBusy ? "Creating…" : "Create Reception"}</button>
        </form>
      </section>
      <section className="managed-section"><div className="managed-title"><div><h2>All interview panels</h2><p>Names update on tickets, registration, panel screens, and the public display.</p></div><span>{active} active</span></div>
        <div className="managed-grid">{panels.map((panel) => <ManagedPanel key={panel.id} panel={panel} onUpdated={refresh} setToast={setToast} onGetLink={() => setLinkAccount({ role: "panel", accessSlug: panel.access_slug, displayName: panel.name, username: panel.username })} />)}</div>
      </section>
      <section className="managed-section"><div className="managed-title"><div><h2>Reception accounts</h2><p>Every active Reception can register candidates and print tickets simultaneously.</p></div><span>{activeReceptions} active</span></div>
        <div className="managed-grid">{receptions.map((reception) => <ManagedReception key={reception.id} reception={reception} onUpdated={refresh} setToast={setToast} onGetLink={() => setLinkAccount({ role: "reception", accessSlug: reception.access_slug, displayName: reception.display_name, username: reception.username })} />)}</div>
      </section>
    </main>
    {linkAccount && <AccessLinkDialog account={linkAccount} onClose={() => setLinkAccount(null)} setToast={setToast} />}
    <Toast toast={toast} onClose={() => setToast(null)} />
  </Shell>;
}

function speakTicket(ticket) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const token = ticket.tokenCode.replace("-", " ").replace(/0/g, " zero ");
  const speech = new SpeechSynthesisUtterance(`Token ${token}. Please proceed to panel ${ticket.panelId}.`);
  speech.rate = 0.82; speech.pitch = 1;
  window.speechSynthesis.speak(speech);
}

function PanelDashboard({ user, onLogout, version, refresh }) {
  const [data, setData] = useState({ tickets: [], stats: {} });
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState("");
  const [remarks, setRemarks] = useState("");
  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => { Promise.all([api(`/tickets?panelId=${user.panelId}`), api("/stats")]).then(([t, s]) => setData({ tickets: t.tickets, stats: s.stats })).catch(console.error); }, [version, user.panelId]);
  const current = data.tickets.find((ticket) => ["called", "in_interview"].includes(ticket.status));
  const waiting = data.tickets.filter((ticket) => ticket.status === "waiting").sort((a, b) => a.id - b.id);
  const completed = data.tickets.filter((ticket) => ticket.status === "completed");
  useEffect(() => {
    setScore(current?.interviewScore ? String(current.interviewScore) : "");
    setRemarks(current?.interviewRemarks || "");
  }, [current?.id]);
  const act = async (action, status) => {
    if (status === "skipped" && !window.confirm(`Skip ${current.fullName}? They can be returned to the waiting queue later.`)) return;
    if (status === "completed" && !window.confirm(`Complete ${current.fullName}'s interview with a score of ${score}/10?`)) return;
    setBusy(true);
    try {
      const result = action === "call" ? await api(`/panels/${user.panelId}/call-next`, { method: "POST" })
        : await api(`/tickets/${current.id}/status`, { method: "PATCH", body: JSON.stringify({ status, score, remarks }) });
      if (action === "call") speakTicket(result.ticket);
      setToast({ message: action === "call" ? `${result.ticket.tokenCode} has been called.` : `Candidate marked ${statusLabels[status].toLowerCase()}.` });
      refresh();
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setBusy(false); }
  };
  const saveInterview = async () => {
    setBusy(true);
    try {
      await api(`/tickets/${current.id}/interview`, { method: "PATCH", body: JSON.stringify({ score, remarks }) });
      setToast({ message: "Score and remarks saved." }); refresh();
    } catch (err) { setToast({ type: "error", message: err.message }); } finally { setBusy(false); }
  };
  return <Shell user={user} onLogout={onLogout} connection="Live queue">
    <main className="dashboard panel-dashboard">
      <section className="panel-title-row"><div><div className="eyebrow">Interviewer workspace · Panel {user.panelId}</div><h1>{user.panelName || `Panel ${user.panelId}`}</h1><p>One candidate at a time. Keep the queue moving.</p></div><div className="panel-day-stat"><span>{completed.length}</span><small>completed today</small></div></section>
      <section className="panel-workspace">
        <article className="current-card">
          <div className="current-head"><span><span className="pulse" /> Current candidate</span>{current && <span className={`status ${current.status}`}>{statusLabels[current.status]}</span>}</div>
          {current ? <div className="current-body">
            <div className="giant-token">{current.tokenCode}</div><h2>{current.fullName}</h2><p>{current.course}</p>
            <div className="candidate-details"><span><Hash size={16} />{current.banoqabilId || "No BQ ID"}</span><span><Clock3 size={16} />Called {formatTime(current.calledAt)}</span></div>
            {current.status === "in_interview" && <div className="interview-form"><label><Star size={17} /> Interview score<select value={score} onChange={(event) => setScore(event.target.value)}><option value="">Choose 1–10</option>{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} / 10</option>)}</select></label><label><MessageSquare size={17} /> Remarks<textarea maxLength="2000" placeholder="Strengths, observations, recommendation…" value={remarks} onChange={(event) => setRemarks(event.target.value)} /></label><small>{remarks.length}/2000</small></div>}
            <div className="current-actions">
              <button className="button secondary" onClick={() => speakTicket(current)}><Volume2 size={18} /> Call again</button>
              {current.status === "called" && <button className="button primary" disabled={busy} onClick={() => act("status", "in_interview")}><Play size={18} /> Start interview</button>}
              {current.status === "in_interview" && <button className="button secondary" disabled={busy || !score} onClick={saveInterview}><Save size={18} /> Save notes</button>}
              {current.status === "in_interview" && <button className="button success" disabled={busy || !score} onClick={() => act("status", "completed")}><Check size={19} /> Complete & finish</button>}
              <button className="button danger-quiet" disabled={busy} onClick={() => act("status", "skipped")}><SkipForward size={18} /> Skip</button>
            </div>
          </div> : <div className="current-empty"><div><UserRound size={42} /></div><h2>Ready for the next candidate</h2><p>{waiting.length ? `${waiting.length} candidate${waiting.length === 1 ? " is" : "s are"} waiting.` : "Your queue is clear for now."}</p><button className="button primary large" disabled={busy || !waiting.length} onClick={() => act("call")}><Volume2 size={20} /> Call next candidate</button></div>}
        </article>
        <aside className="waiting-card">
          <div className="waiting-head"><div><div className="eyebrow">Up next</div><h2>Waiting queue</h2></div><span>{waiting.length}</span></div>
          <div className="waiting-list">{waiting.length ? waiting.map((ticket, index) => <div className="waiting-item" key={ticket.id}><span className="queue-pos">{index + 1}</span><div><strong>{ticket.tokenCode}</strong><span>{ticket.fullName}</span><small>{ticket.course}</small></div><Clock3 size={17} /></div>) : <div className="mini-empty"><CheckCircle2 size={28} /><span>No one waiting</span></div>}</div>
        </aside>
      </section>
      <section className="recent-completed"><div className="table-head"><div><h3>Completed today</h3><p>Your latest finished interviews</p></div></div><div className="completion-strip">{completed.slice(0, 6).map((ticket) => <div key={ticket.id}><CheckCircle2 size={17} /><span><strong>{ticket.tokenCode}</strong><small>{ticket.fullName}</small></span><b>{ticket.interviewScore ? `${ticket.interviewScore}/10` : "—"}</b><time>{formatTime(ticket.completedAt)}</time></div>)}{!completed.length && <p className="muted">Completed interviews will appear here.</p>}</div></section>
    </main>
    <Toast toast={toast} onClose={() => setToast(null)} />
  </Shell>;
}

function DisplayBoard() {
  const [panels, setPanels] = useState([]);
  const [clock, setClock] = useState(new Date());
  const [version] = useLiveUpdates();
  useEffect(() => { fetch("/api/display").then((r) => r.json()).then((data) => setPanels(data.panels)); }, [version]);
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(timer); }, []);
  return <main className="display-board">
    <header><div className="display-logo"><BrandLogo /><span>BANO QABIL TICKET SYSTEM<small>MADE BY BANO QABIL INCUBATION</small></span></div><div><strong>{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong><small>{clock.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</small></div></header>
    <div className="display-intro"><div className="eyebrow light">Now interviewing</div><h1>Please watch for your token</h1></div>
    <section className="display-grid">{panels.map((panel) => <article key={panel.id} className={panel.current_token ? "active" : ""}><div className="display-panel-head"><span>Panel {panel.id}</span><small>{panel.waiting} waiting</small></div>{panel.current_token ? <><div className="display-token">{panel.current_token}</div><p>{panel.current_name}</p><div className="proceed"><ArrowRight size={18} /> Proceed to Panel {panel.id}</div></> : <div className="display-ready"><Clock3 size={38} /><strong>Ready</strong><span>Next token will appear here</span></div>}</article>)}</section>
    <footer><Volume2 size={20} /> When your token is called, please proceed to the assigned panel.</footer>
  </main>;
}

function AccessLinkMessage({ title, message, actionLabel, onAction, secondaryLabel, onSecondary }) {
  return <main className="login-page access-message-page"><section className="login-brand"><div className="brand-mark bq-brand-mark"><BrandLogo /></div><div className="eyebrow light">Dedicated access</div><h1>{title}</h1><p>{message}</p><div className="brand-stat"><Wifi size={22} /><span><strong>Check the event network</strong><small>This link works only on the host laptop’s Wi-Fi or hotspot.</small></span></div></section><section className="login-panel"><div className="login-card access-message-card"><div className="mobile-logo"><BrandLogo /> <span>Bano Qabil<small>Ticket System</small></span></div><div className="eyebrow">Account link</div><h2>{title}</h2><p className="muted">{message}</p><button className="button primary wide" onClick={onAction}>{actionLabel} <ArrowRight size={18} /></button>{secondaryLabel && <button className="regular-login-link" onClick={onSecondary}>{secondaryLabel}</button>}</div></section></main>;
}

function App() {
  const parameters = new URLSearchParams(window.location.search);
  const isDisplay = parameters.get("display") === "1";
  const requestedRole = parameters.get("role")?.toLowerCase() || "";
  const requestedSlug = parameters.get("id")?.toLowerCase() || "";
  const [user, setUser] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checking, setChecking] = useState(!isDisplay);
  const [scope, setScope] = useState(null);
  const [scopeError, setScopeError] = useState("");
  const [version, refresh] = useLiveUpdates();
  useEffect(() => {
    if (isDisplay) return;
    let active = true;
    const boot = async () => {
      try {
        const { initialized } = await api("/setup/status");
        if (!initialized) {
          localStorage.removeItem("bq_token");
          if (active) { setNeedsSetup(true); setChecking(false); }
          return;
        }
        if ((requestedRole && !requestedSlug) || (!requestedRole && requestedSlug)) {
          if (active) setScopeError("This login link is incomplete. Ask the Super Admin for a fresh QR code or link.");
        } else if (requestedRole && requestedSlug) {
          try {
            const result = await api(`/access/${encodeURIComponent(requestedSlug)}?role=${encodeURIComponent(requestedRole)}`);
            if (active) setScope(result.account);
          } catch (err) { if (active) setScopeError(err.message); }
        }
        if (localStorage.getItem("bq_token")) {
          try {
            const result = await api("/auth/me");
            if (active) setUser(result.user);
          } catch { localStorage.removeItem("bq_token"); }
        }
      } finally { if (active) setChecking(false); }
    };
    boot();
    return () => { active = false; };
  }, [isDisplay]);
  const endSession = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    localStorage.removeItem("bq_token"); setUser(null);
  };
  const logout = async () => {
    if (!window.confirm("Log out of the Bano Qabil Ticket System?")) return;
    await endSession();
  };
  const clearScope = () => {
    window.history.replaceState({}, "", window.location.pathname);
    setScope(null); setScopeError("");
  };
  if (isDisplay) return <DisplayBoard />;
  if (checking) return <div className="loading-screen"><BrandLogo /><span>Loading Bano Qabil Ticket System…</span></div>;
  if (needsSetup) return <SetupWizard onComplete={(createdUser) => { setNeedsSetup(false); setUser(createdUser); }} />;
  if (scopeError) return <AccessLinkMessage title="Link unavailable" message={scopeError} actionLabel={user ? "Continue to current workspace" : "Open regular login"} onAction={clearScope} />;
  if (user && scope && user.accessSlug !== scope.slug) return <AccessLinkMessage title="Different account is signed in" message={`${user.displayName} is currently signed in, but this link belongs to ${scope.displayName}.`} actionLabel={`Switch to ${scope.displayName}`} onAction={endSession} secondaryLabel="Keep current account" onSecondary={clearScope} />;
  if (!user) return <Login onLogin={setUser} scope={scope} onUseRegular={clearScope} />;
  if (user.role === "admin") return <SuperAdminDashboard user={user} onLogout={logout} version={version} refresh={refresh} />;
  if (user.role === "panel") return <PanelDashboard user={user} onLogout={logout} version={version} refresh={refresh} />;
  return <ReceptionDashboard user={user} onLogout={logout} version={version} refresh={refresh} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
