export function usageTotal(usage) { return (usage?.input_tokens || 0) + (usage?.output_tokens || 0); }
export function estimateCost(usage, rates) {
  if (!usage || !rates) return null;
  return ((usage.input_tokens - usage.cached_input_tokens) * rates.input + usage.cached_input_tokens * rates.cached + usage.output_tokens * rates.output) / 1000000;
}
export function usageParser(onUsage) {
  let pending = '';
  const total = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  return chunk => {
    pending += chunk;
    const lines = pending.split('\n'); pending = lines.pop();
    if (pending.length > 2000000) pending = '';
    for (const line of lines) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.type !== 'turn.completed' || !event.usage) continue;
      const u = event.usage;
      if (!['input_tokens','output_tokens'].every(k => Number.isSafeInteger(u[k]) && u[k] >= 0) || !Number.isSafeInteger(u.cached_input_tokens ?? 0) || (u.cached_input_tokens ?? 0) < 0 || (u.cached_input_tokens ?? 0) > u.input_tokens) continue;
      for (const k of Object.keys(total)) total[k] += u[k] || 0;
      onUsage({ ...total });
    }
  };
}
export function budgetState(store, config) {
  const today = new Date().toISOString().slice(0,10);
  const runs = store.all("SELECT status,usage,command FROM runs WHERE kind='agent' AND substr(COALESCE(started_at,created_at),1,10)=?", today);
  const tokens = runs.reduce((n,r) => n + usageTotal(r.usage ? JSON.parse(r.usage) : null), 0);
  const unknown = runs.filter(r => r.command && r.status !== 'queued' && !r.usage).length;
  const prices = config.tokenRates;
  const cost = prices ? runs.reduce((n,r) => n + (estimateCost(r.usage ? JSON.parse(r.usage) : null, prices) || 0), 0) : null;
  return { date: today, tokens, unknown, estimatedUsd: cost, dailyTokenLimit: config.dailyTokenLimit || 0, dailyUsdLimit: config.dailyUsdLimit || 0, maxRunTokens: config.maxRunTokens || 0, note: 'Usage is reported after a model turn. Limits block subsequent runs and can overshoot within a turn. Cost uses operator-supplied rates, not account billing.' };
}
export function checkBudget(store, config) {
  const state = budgetState(store, config);
  if ((state.dailyTokenLimit && state.tokens >= state.dailyTokenLimit) || (state.dailyUsdLimit && state.estimatedUsd >= state.dailyUsdLimit)) throw new Error('Daily usage budget reached. Review usage or wait for the next UTC day.');
  if ((state.dailyTokenLimit || state.dailyUsdLimit || state.maxRunTokens) && state.unknown) throw new Error('An agent run has unknown usage today. Budget accounting is incomplete; review its failure before changing the budget configuration.');
}
