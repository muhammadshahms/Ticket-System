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

    const adminPanels = await request("/admin/panels", { token: adminToken });
    assert.deepEqual(adminPanels.data.panels.map((panel) => panel.access_slug), ["panel-one", "panel-two"]);
    const duplicateNamePanel = await request("/admin/panels", { method: "POST", token: adminToken, body: { name: "Panel One", username: "panel-one-copy", password: "panel345" } });
    assert.equal(duplicateNamePanel.data.panel.access_slug, "panel-one-2");
    await request(`/admin/panels/${duplicateNamePanel.data.panel.id}`, { method: "PATCH", token: adminToken, body: { active: false } });
    const inactiveAccess = await request("/access/panel-one-2?role=panel");
    assert.equal(inactiveAccess.response.status, 403);
    const renamedPanel = await request("/admin/panels/2", { method: "PATCH", token: adminToken, body: { name: "Frontend Interview Panel" } });
    assert.equal(renamedPanel.response.status, 200);
    const panelsAfterRename = await request("/admin/panels", { token: adminToken });
    assert.equal(panelsAfterRename.data.panels.find((panel) => panel.id === 2).access_slug, "panel-two");

    const panelAccess = await request("/access/panel-two?role=panel");
    assert.equal(panelAccess.response.status, 200);
    assert.equal(panelAccess.data.account.displayName, "Frontend Interview Panel");
    assert.equal(panelAccess.data.account.username, "panel-two");
    const wrongRole = await request("/access/panel-two?role=reception");
    assert.equal(wrongRole.response.status, 404);
    const receptionAccess = await request("/access/reception-main?role=reception");
    assert.equal(receptionAccess.data.account.username, "reception");
    const wrongScopedPassword = await request("/auth/login", { method: "POST", body: { slug: "panel-two", password: "wrong-password" } });
    assert.equal(wrongScopedPassword.response.status, 401);

    const receptionLogin = await request("/auth/login", { method: "POST", body: { slug: "reception-main", password: "Reception123" } });
    assert.equal(receptionLogin.data.user.accessSlug, "reception-main");
    const receptionToken = receptionLogin.data.token;
    const created = await request("/tickets", { method: "POST", token: receptionToken, body: { fullName: "Test Candidate", phone: "03001234567", banoqabilId: "BQ-100", course: "Web Development", panelId: 1 } });
    assert.equal(created.response.status, 201);
    for (let index = 0; index < 11; index += 1) {
      const bulkCandidate = await request("/tickets", { method: "POST", token: receptionToken, body: { fullName: `Bulk Candidate ${index}`, phone: `0310${String(index).padStart(7, "0")}`, course: "Web Development", panelId: 1 } });
      assert.equal(bulkCandidate.response.status, 201);
    }
    const firstCandidatePage = await request("/admin/candidates?page=1&pageSize=10", { token: adminToken });
    assert.equal(firstCandidatePage.data.pagination.total, 12);
    assert.equal(firstCandidatePage.data.tickets.length, 10);
    const secondCandidatePage = await request("/admin/candidates?page=2&pageSize=10", { token: adminToken });
    assert.equal(secondCandidatePage.data.tickets.length, 2);
    const searchedCandidates = await request("/admin/candidates?query=Bulk%20Candidate%2010", { token: adminToken });
    assert.equal(searchedCandidates.data.pagination.total, 1);

    const reassigned = await request(`/tickets/${created.data.ticket.id}`, { method: "PATCH", token: receptionToken, body: { fullName: "Test Candidate Edited", phone: "03001234567", banoqabilId: "BQ-100", course: "Web Development", panelId: 2 } });
    assert.equal(reassigned.data.ticket.tokenCode, "P2-001");
    const regenerated = await request(`/tickets/${created.data.ticket.id}/regenerate`, { method: "POST", token: receptionToken });
    assert.equal(regenerated.data.ticket.tokenCode, "P2-002");

    const panelLogin = await request("/auth/login", { method: "POST", body: { slug: "panel-two", password: "panel234" } });
    assert.equal(panelLogin.data.user.accessSlug, "panel-two");
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
    const allDatesExport = await fetch(`${base}/exports/tickets?date=all&format=csv`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(allDatesExport.status, 200);
    assert.match(await allDatesExport.text(), /Bulk Candidate 10/);

    const deletedCompleted = await request(`/tickets/${created.data.ticket.id}`, { method: "DELETE", token: adminToken });
    assert.equal(deletedCompleted.response.status, 204);
    const rejectedDeleteAll = await request("/admin/candidates", { method: "DELETE", token: adminToken, body: { confirmation: "DELETE ALL" } });
    assert.equal(rejectedDeleteAll.response.status, 400);
    const deletedAll = await request("/admin/candidates", { method: "DELETE", token: adminToken, body: { confirmation: "DELETE ALL CANDIDATES" } });
    assert.equal(deletedAll.data.deleted, 11);
    const emptyCandidates = await request("/admin/candidates", { token: adminToken });
    assert.equal(emptyCandidates.data.pagination.total, 0);

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
