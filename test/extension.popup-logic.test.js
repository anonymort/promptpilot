import test from "node:test";
import assert from "node:assert/strict";

import { createApiError, shouldClearStoredToken } from "../extension/popup-logic.js";

test("stored sessions are only cleared for auth failures", () => {
  assert.equal(shouldClearStoredToken(createApiError("Unauthorized", 401)), true);
  assert.equal(shouldClearStoredToken(createApiError("Forbidden", 403)), true);
  assert.equal(shouldClearStoredToken(createApiError("Server error", 500)), false);
  assert.equal(shouldClearStoredToken(createApiError("Offline", 0)), false);
});
