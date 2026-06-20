import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("candidate management, scoring, password change, and exports work together", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bq-ticket-test-"));
  process.env.DATA_DIR = dataDir;
  const { server } = await import("../server/index.js");
  const { db } = await import("../server/db.js");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const request = async (route, { token, body, ...options } = {}) => {
    const response = await fetch(`${base}${route}`, {
      ...options,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    return { response, data };
  };

  try {
    const setup = await request("/setup/initialize", { method: "POST", body: { receptionName: "Main Desk", receptionUsername: "reception", receptionPassword: "Reception123" } });
    assert.equal(setup.response.status, 201);
    const adminToken = setup.data.token;

    for (const panel of [
      { name: "Panel One", username: "panel-one", password: "panel123" },
      { name: "Panel Two", username: "panel-two", password: "panel234" }
    ]) {
      const created = await request("/admin/panels", { method: "POST", token: adminToken, body: panel });
      assert.equal(created.response.status, 201);
    }

    const receptionLogin = await request("/auth/login", { method: "POST", body: { username: "reception", password: "Reception123" } });
    const receptionToken = receptionLogin.data.token;
    const created = await request("/tickets", { method: "POST", token: receptionToken, body: { fullName: "Test Candidate", phone: "03001234567", banoqabilId: "BQ-100", course: "Web Development", panelId: 1 } });
    assert.equal(created.response.status, 201);

    const reassigned = await request(`/tickets/${created.data.ticket.id}`, { method: "PATCH", token: receptionToken, body: { fullName: "Test Candidate Edited", phone: "03001234567", banoqabilId: "BQ-100", course: "Web Development", panelId: 2 } });
    assert.equal(reassigned.data.ticket.tokenCode, "P2-001");
    const regenerated = await request(`/tickets/${created.data.ticket.id}/regenerate`, { method: "POST", token: receptionToken });
    assert.equal(regenerated.data.ticket.tokenCode, "P2-002");

    const panelLogin = await request("/auth/login", { method: "POST", body: { username: "panel-two", password: "panel234" } });
    const panelToken = panelLogin.data.token;
    const called = await request("/panels/2/call-next", { method: "POST", token: panelToken });
    await request(`/tickets/${called.data.ticket.id}/status`, { method: "PATCH", token: panelToken, body: { status: "in_interview" } });
    const missingScore = await request(`/tickets/${called.data.ticket.id}/status`, { method: "PATCH", token: panelToken, body: { status: "completed" } });
    assert.equal(missingScore.response.status, 400);
    const completed = await request(`/tickets/${called.data.ticket.id}/status`, { method: "PATCH", token: panelToken, body: { status: "completed", score: 9, remarks: "Recommended" } });
    assert.equal(completed.data.ticket.interviewScore, 9);

    const exportResponse = await fetch(`${base}/exports/tickets?date=${completed.data.ticket.eventDate}&format=csv`, { headers: { Authorization: `Bearer ${receptionToken}` } });
    const csv = await exportResponse.text();
    assert.equal(exportResponse.status, 200);
    assert.match(csv, /Test Candidate Edited/);
    assert.match(csv, /Recommended/);

    const changed = await request("/auth/password", { method: "PATCH", token: receptionToken, body: { currentPassword: "Reception123", newPassword: "Reception456" } });
    assert.equal(changed.response.status, 204);
    const newLogin = await request("/auth/login", { method: "POST", body: { username: "reception", password: "Reception456" } });
    assert.equal(newLogin.response.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
