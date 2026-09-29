function multiplier(progressionMultiplier) {
    const rate = Math.max(1, Number(progressionMultiplier) || 1);
    return 1 + Math.log10(rate);
}

function price(basePrice, progressionMultiplier) {
    const base = Math.max(0, Number(basePrice) || 0);
    if (base === 0) return 0;
    return Math.max(1, Math.round(base * multiplier(progressionMultiplier)));
}

module.exports = { multiplier, price };
