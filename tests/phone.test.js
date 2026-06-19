import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone } from "../server/index.js";

test("normalizes common Pakistani mobile formats to one unique value", () => {
  assert.equal(normalizePhone("0300 1234567"), "03001234567");
  assert.equal(normalizePhone("+92 300 1234567"), "03001234567");
  assert.equal(normalizePhone("300-1234567"), "03001234567");
  assert.equal(normalizePhone("0092-300-1234567"), "03001234567");
});
