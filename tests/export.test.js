import test from "node:test";
import assert from "node:assert/strict";
import { ticketsToCsv, ticketsToExcelXml } from "../server/index.js";

const row = {
  event_date: "2026-06-20",
  token_code: "P1-001",
  full_name: "Ali, Muhammad",
  phone_display: "03001234567",
  banoqabil_id: "BQ-1",
  course: "Web Development",
  panel_name: "Panel & One",
  status: "completed",
  interview_score: 9,
  interview_remarks: "Strong \"portfolio\" <recommended>",
  created_at: "2026-06-20 09:00:00"
};

test("CSV export escapes commas and quotes", () => {
  const csv = ticketsToCsv([row]);
  assert.match(csv, /"Ali, Muhammad"/);
  assert.match(csv, /"Strong ""portfolio"" <recommended>"/);
  assert.equal(csv.split("\r\n").length, 2);
});

test("Excel XML export escapes XML-sensitive candidate data", () => {
  const xml = ticketsToExcelXml([row]);
  assert.match(xml, /Panel &amp; One/);
  assert.match(xml, /&lt;recommended&gt;/);
  assert.match(xml, /Worksheet ss:Name="Candidates"/);
});
