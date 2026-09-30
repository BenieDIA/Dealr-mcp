import { test } from "node:test";
import assert from "node:assert/strict";
import { negotiateWithinBudget } from "../src/buyer-negotiation.js";

test("keeps negotiating without confirmation and accepts a counteroffer within budget", async () => {
  const proposed = [];
  const accepted = [];
  const rejected = [];
  const responses = [
    { status: "active", negotiation_id: "n-1", price_on_table: 408 },
    { status: "active", negotiation_id: "n-1", price_on_table: 398 },
  ];

  const result = await negotiateWithinBudget({
    openingPrice: 381,
    budgetMax: 400,
    propose: async (price, negotiationId) => {
      proposed.push({ price, negotiationId });
      return responses.shift();
    },
    accept: async (negotiationId) => {
      accepted.push(negotiationId);
      return { status: "agreement_reached", price: 398 };
    },
    reject: async (negotiationId) => {
      rejected.push(negotiationId);
      return { status: "no_agreement" };
    },
  });

  assert.deepEqual(proposed, [
    { price: 381, negotiationId: undefined },
    { price: 392, negotiationId: "n-1" },
  ]);
  assert.deepEqual(accepted, ["n-1"]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(result.buyer_offers, [381, 392]);
  assert.equal(result.price, 398);
});

test("rejects after two counteroffers remain above the budget", async () => {
  const proposed = [];
  const rejected = [];
  const responses = [408, 405, 403].map((price) => ({
    status: "active",
    negotiation_id: "n-2",
    price_on_table: price,
  }));

  const result = await negotiateWithinBudget({
    openingPrice: 381,
    budgetMax: 400,
    propose: async (price) => {
      proposed.push(price);
      return responses.shift();
    },
    accept: async () => assert.fail("must not accept above budget"),
    reject: async (negotiationId) => {
      rejected.push(negotiationId);
      return { status: "no_agreement" };
    },
  });

  assert.deepEqual(proposed, [381, 392, 397]);
  assert.deepEqual(rejected, ["n-2"]);
  assert.equal(result.reason, "above_budget");
  assert.deepEqual(result.buyer_offers, [381, 392, 397]);
});

test("raises a below-floor opening offer automatically and accepts within budget", async () => {
  const proposed = [];
  const responses = [
    { status: "no_agreement", reason: "below_floor" },
    { status: "active", negotiation_id: "n-3", price_on_table: 498 },
  ];

  const result = await negotiateWithinBudget({
    openingPrice: 400,
    budgetMax: 500,
    propose: async (price, negotiationId) => {
      proposed.push({ price, negotiationId });
      return responses.shift();
    },
    accept: async (negotiationId) => ({ status: "agreement_reached", negotiationId, price: 498 }),
    reject: async () => assert.fail("must not reject an offer within budget"),
  });

  assert.deepEqual(proposed, [
    { price: 400, negotiationId: undefined },
    { price: 450, negotiationId: undefined },
  ]);
  assert.deepEqual(result.buyer_offers, [400, 450]);
  assert.equal(result.status, "agreement_reached");
  assert.equal(result.price, 498);
});

test("bounds below-floor retries at the buyer's maximum", async () => {
  const proposed = [];
  const result = await negotiateWithinBudget({
    openingPrice: 400,
    budgetMax: 500,
    propose: async (price) => {
      proposed.push(price);
      return { status: "no_agreement", reason: "below_floor" };
    },
    accept: async () => assert.fail("must not accept a below-floor offer"),
    reject: async () => assert.fail("the backend already closed below-floor negotiations"),
  });

  assert.deepEqual(proposed, [400, 450, 475, 500]);
  assert.deepEqual(result.buyer_offers, [400, 450, 475, 500]);
  assert.equal(result.reason, "below_floor");
});

test("does not start a negotiation if the opening offer is over budget", async () => {
  let proposeCalled = false;

  await assert.rejects(
    negotiateWithinBudget({
      openingPrice: 401,
      budgetMax: 400,
      propose: async () => { proposeCalled = true; },
      accept: async () => ({}),
      reject: async () => ({}),
    }),
    /dépasse le budget maximum/
  );

  assert.equal(proposeCalled, false);
});
