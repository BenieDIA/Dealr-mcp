const MAX_BUYER_COUNTERS = 2;
const COUNTER_STEP = 0.6;

function nextOffer(currentOffer, budgetMax) {
  const steppedOffer = Math.round(currentOffer + (budgetMax - currentOffer) * COUNTER_STEP);
  return Math.min(budgetMax, Math.max(currentOffer + 1, steppedOffer));
}

export async function negotiateWithinBudget({ openingPrice, budgetMax, propose, accept, reject }) {
  if (!Number.isFinite(openingPrice) || openingPrice <= 0) {
    throw new RangeError("Le prix de départ doit être supérieur à zéro.");
  }
  if (!Number.isFinite(budgetMax) || budgetMax <= 0) {
    throw new RangeError("Le budget maximum doit être supérieur à zéro.");
  }
  if (openingPrice > budgetMax) {
    throw new RangeError("Le prix de départ dépasse le budget maximum.");
  }

  const buyerOffers = [openingPrice];
  let response = await propose(openingPrice);

  for (let counter = 0; counter <= MAX_BUYER_COUNTERS; counter += 1) {
    if (response?.status !== "active" || typeof response.price_on_table !== "number") {
      return { ...response, buyer_offers: buyerOffers };
    }

    if (response.price_on_table <= budgetMax) {
      const accepted = await accept(response.negotiation_id);
      return { ...accepted, buyer_offers: buyerOffers };
    }

    if (!response.negotiation_id) {
      return { ...response, buyer_offers: buyerOffers };
    }

    if (counter === MAX_BUYER_COUNTERS) {
      const rejected = await reject(response.negotiation_id);
      return { ...rejected, reason: "above_budget", buyer_offers: buyerOffers };
    }

    const offer = nextOffer(buyerOffers.at(-1), budgetMax);
    if (offer > budgetMax || offer <= buyerOffers.at(-1)) {
      const rejected = await reject(response.negotiation_id);
      return { ...rejected, reason: "above_budget", buyer_offers: buyerOffers };
    }

    buyerOffers.push(offer);
    response = await propose(offer, response.negotiation_id);
  }

  return { ...response, buyer_offers: buyerOffers };
}