import assert from "node:assert/strict";
import { it } from "node:test";
import {
  ManualPhysicalCardProvider,
  ManualPhysicalCardProviderError,
  isPhysicalEndMatchError,
  type PhysicalCardRequest,
} from "./physical-card-provider.js";
import type { AgentObservation } from "../forge/forge-protocol.js";

function request(overrides: Partial<PhysicalCardRequest> = {}): PhysicalCardRequest {
  return {
    decisionId: "d-1",
    playerId: "player-1",
    context: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1" },
    eventKind: "draw",
    count: 1,
    candidates: [{ name: "Mountain", remaining: 2 }, { name: "Sol Ring", remaining: 1 }],
    ...overrides,
  };
}

it("chooseCard(request) returns a pending promise, and current() exposes exactly {request, observation} (observation undefined when not passed)", async () => {
  const provider = new ManualPhysicalCardProvider();
  let resolved: unknown;
  const promise = provider.chooseCard(request()).then(selection => { resolved = selection; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, undefined, "chooseCard() must not resolve before a submit()");
  const current = provider.current();
  assert.deepEqual(current?.request, request());
  assert.equal(current?.observation, undefined);
  provider.submit("d-1", ["Mountain"]);
  await promise;
});

it("current() carries the observation when one is passed to chooseCard()", async () => {
  const provider = new ManualPhysicalCardProvider();
  const observation = { selfPlayerId: "player-1" } as unknown as AgentObservation;
  const promise = provider.chooseCard(request(), observation);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(provider.current()?.observation, observation);
  provider.submit("d-1", ["Mountain"]);
  await promise;
});

it("submit() with a wrong decisionId throws STALE_REQUEST and does not resolve the pending promise", async () => {
  const provider = new ManualPhysicalCardProvider();
  let settled = false;
  const promise = provider.chooseCard(request()).then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(
    () => provider.submit("d-stale", ["Mountain"]),
    (error: unknown) => error instanceof ManualPhysicalCardProviderError && error.code === "STALE_REQUEST",
  );
  assert.equal(settled, false, "a stale decisionId must not resolve the pending chooseCard()");
  assert.notEqual(provider.current(), null, "the original request is still pending after a rejected stale submit");
  provider.submit("d-1", ["Mountain"]);
  await promise;
});

it("submit() with wrong-length declaredNames throws DECLARED_COUNT_MISMATCH", async () => {
  const provider = new ManualPhysicalCardProvider();
  const promise = provider.chooseCard(request({ count: 1 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(
    () => provider.submit("d-1", ["Mountain", "Sol Ring"]),
    (error: unknown) => error instanceof ManualPhysicalCardProviderError && error.code === "DECLARED_COUNT_MISMATCH",
  );
  provider.submit("d-1", ["Mountain"]);
  await promise;
});

it("submit() with a name whose candidate remaining is 0, or that is not in the candidate list, throws DECLARED_NAME_NOT_FOUND", async () => {
  const provider = new ManualPhysicalCardProvider();
  const promise = provider.chooseCard(request({ count: 1, candidates: [{ name: "Mountain", remaining: 0 }] }));
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(
    () => provider.submit("d-1", ["Mountain"]),
    (error: unknown) => error instanceof ManualPhysicalCardProviderError && error.code === "DECLARED_NAME_NOT_FOUND",
    "a candidate with remaining: 0 must still be rejected",
  );
  assert.throws(
    () => provider.submit("d-1", ["Never Printed Card"]),
    (error: unknown) => error instanceof ManualPhysicalCardProviderError && error.code === "DECLARED_NAME_NOT_FOUND",
    "a name absent from the candidate list entirely must be rejected",
  );
  assert.notEqual(provider.current(), null, "both rejected submits must leave the request pending");
  // Answer legally so the pending promise settles instead of leaking into the process.
  provider.requestEnd();
  await assert.rejects(promise);
});

it("submit() with a legal declaration resolves chooseCard() with {declaredNames} and clears current() back to null, including declaring the SAME name twice when remaining >= 2", async () => {
  const provider = new ManualPhysicalCardProvider();
  const promise = provider.chooseCard(request({ count: 2, candidates: [{ name: "Mountain", remaining: 2 }] }));
  await new Promise(resolve => setImmediate(resolve));
  provider.submit("d-1", ["Mountain", "Mountain"]);
  const selection = await promise;
  assert.deepEqual(selection, { declaredNames: ["Mountain", "Mountain"] });
  assert.equal(provider.current(), null, "no request remains pending once answered");
});

it("submit() with no pending request throws NO_PENDING_REQUEST", () => {
  const provider = new ManualPhysicalCardProvider();
  assert.throws(
    () => provider.submit("d-1", ["Mountain"]),
    (error: unknown) => error instanceof ManualPhysicalCardProviderError && error.code === "NO_PENDING_REQUEST",
  );
});

it("requestEnd() rejects an in-flight chooseCard() call with an error satisfying isPhysicalEndMatchError", async () => {
  const provider = new ManualPhysicalCardProvider();
  const promise = provider.chooseCard(request());
  await new Promise(resolve => setImmediate(resolve));
  provider.requestEnd();
  await assert.rejects(promise, (error: unknown) => isPhysicalEndMatchError(error));
  assert.equal(provider.current(), null);
});

it("requestEnd() called before any chooseCard() makes the NEXT chooseCard() call reject immediately", async () => {
  const provider = new ManualPhysicalCardProvider();
  provider.requestEnd();
  await assert.rejects(provider.chooseCard(request()), (error: unknown) => isPhysicalEndMatchError(error));
});
