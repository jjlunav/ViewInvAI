// Pure accounting shared by the backend and isolated regression tests.
const finiteNumber=value=>{const n=Number(value);return Number.isFinite(n)?n:null};

export function orderedTransactions(rows){
  return [...(rows||[])].sort((a,b)=>String(a.executed_at||"").localeCompare(String(b.executed_at||"")) || String(a.created_at||"").localeCompare(String(b.created_at||"")) || (a.side===b.side?0:a.side==="BUY"?-1:1) || String(a.id||"").localeCompare(String(b.id||"")));
}

export function calculateTransactionLedger(rows) {
  let quantity = 0;
  let grossCostBasis = 0;
  let netCostBasis = 0;
  let firstBuyAt = null;
  let currency = null;
  const realizedByCurrency = {};
  const feesByCurrency = {};

  const addAmount = (bucket, key, value) => {
    key = String(key || "EUR").toUpperCase();
    bucket[key] = (bucket[key] || 0) + value;
  };

  for (const row of orderedTransactions(rows)) {
    const side = String(row.side || "").toUpperCase();
    const origin = String(row.origin || "");
    const qty = finiteNumber(row.quantity);
    const price = finiteNumber(row.price);
    const fees = Math.max(0, finiteNumber(row.fees) || 0);
    const rowCurrency = String(row.currency || currency || "EUR").toUpperCase();
    if (!qty || qty <= 0 || price === null || price < 0) continue;
    if (!currency) currency = rowCurrency;

    if (origin === "position-adjustment") {
      if (!firstBuyAt) firstBuyAt = row.executed_at || row.created_at || null;
      quantity = qty;
      grossCostBasis = qty * price;
      netCostBasis = qty * price;
      currency = rowCurrency;
      addAmount(feesByCurrency, rowCurrency, fees);
      continue;
    }

    if (side === "BUY") {
      if (quantity > 1e-8 && currency !== rowCurrency) throw new Error("Transaction currency differs from current position");
      if (quantity <= 1e-8) currency = rowCurrency;
      if (!firstBuyAt) firstBuyAt = row.executed_at || row.created_at || null;
      quantity += qty;
      grossCostBasis += qty * price;
      netCostBasis += qty * price + fees;
      addAmount(feesByCurrency, rowCurrency, fees);
      continue;
    }

    if (side === "SELL") {
      if (qty > quantity + 1e-8) throw new Error("Sell quantity exceeds current position");
      if (currency !== rowCurrency) throw new Error("Transaction currency differs from current position");
      const avgGross = quantity > 1e-8 ? grossCostBasis / quantity : 0;
      const avgNet = quantity > 1e-8 ? netCostBasis / quantity : 0;
      const realized = qty * price - fees - qty * avgNet;
      addAmount(realizedByCurrency, rowCurrency, realized);
      addAmount(feesByCurrency, rowCurrency, fees);
      quantity -= qty;
      grossCostBasis -= qty * avgGross;
      netCostBasis -= qty * avgNet;
      if (quantity <= 1e-8) {
        quantity = 0;
        grossCostBasis = 0;
        netCostBasis = 0;
      }
    }
  }

  const realizedCurrencies = Object.keys(realizedByCurrency);
  const feeCurrencies = Object.keys(feesByCurrency);
  const realizedPnl = realizedCurrencies.length <= 1
    ? realizedCurrencies.reduce((sum, key) => sum + realizedByCurrency[key], 0)
    : null;
  const totalFees = feeCurrencies.length <= 1
    ? feeCurrencies.reduce((sum, key) => sum + feesByCurrency[key], 0)
    : null;

  return {
    quantity,
    avgPrice: quantity > 1e-8 ? grossCostBasis / quantity : null,
    avgCost: quantity > 1e-8 ? netCostBasis / quantity : null,
    grossInvested: grossCostBasis,
    invested: netCostBasis,
    realizedPnl,
    realizedByCurrency,
    totalFees,
    feesByCurrency,
    currency: currency || "EUR",
    firstBuyAt
  };
}

export function calculatePortfolioTransactionSummary(rows) {
  const sorted = [...(rows || [])].sort((a,b) =>
    String(a.executed_at || "").localeCompare(String(b.executed_at || "")) ||
    String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
    String(a.id || "").localeCompare(String(b.id || ""))
  );
  const groups = new Map();
  const currencies = {};
  let buys = 0, sells = 0, adjustments = 0;

  for (const row of sorted) {
    const side = String(row.side || "").toUpperCase();
    const origin = String(row.origin || "");
    const currency = String(row.currency || "EUR").toUpperCase();
    const qty = finiteNumber(row.quantity);
    const price = finiteNumber(row.price);
    const fees = Math.max(0, finiteNumber(row.fees) || 0);
    if (!currencies[currency]) currencies[currency] = { buyGross: 0, sellGross: 0, fees: 0, realizedPnl: 0 };
    if (qty !== null && qty > 0 && price !== null && price >= 0) {
      if (origin === "position-adjustment") adjustments++;
      else if (side === "BUY") { currencies[currency].buyGross += qty * price; buys++; }
      else if (side === "SELL") { currencies[currency].sellGross += qty * price; sells++; }
      currencies[currency].fees += fees;
    }
    const key = row.position_id || [row.stock_key || row.ticker || "",row.broker || "",row.prefer_tr || 0,row.exchange || ""].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const ledgerGroups=[];
  for(const groupRows of groups.values()){
    if(groupRows.some(r=>r.origin==="position-adjustment")){ledgerGroups.push(groupRows);continue}
    const byCurrency=new Map();
    for(const row of groupRows){const c=String(row.currency||"EUR").toUpperCase();if(!byCurrency.has(c))byCurrency.set(c,[]);byCurrency.get(c).push(row)}
    ledgerGroups.push(...byCurrency.values());
  }
  for (const groupRows of ledgerGroups) {
    const ledger = calculateTransactionLedger(groupRows);
    const realized = ledger.realizedByCurrency && typeof ledger.realizedByCurrency === "object"
      ? ledger.realizedByCurrency
      : (ledger.realizedPnl === null || ledger.realizedPnl === undefined ? {} : { [String(ledger.currency || "EUR").toUpperCase()]: ledger.realizedPnl });
    for (const [currency, amount] of Object.entries(realized)) {
      const key = String(currency || "EUR").toUpperCase();
      if (!currencies[key]) currencies[key] = { buyGross: 0, sellGross: 0, fees: 0, realizedPnl: 0 };
      currencies[key].realizedPnl += finiteNumber(amount) || 0;
    }
  }

  for (const value of Object.values(currencies)) {
    for (const key of ["buyGross","sellGross","fees","realizedPnl"]) {
      value[key] = Math.round((value[key] + Number.EPSILON) * 1000000) / 1000000;
    }
  }
  return { total: sorted.length, buys, sells, adjustments, stocks: new Set(sorted.map(r=>r.stock_key||r.ticker||" ")).size, currencies };
}


export function calculateFundLedger(rows) {
  let units=0,costBasis=0,realized=0,currency="EUR",firstBuyAt=null,totalFees=0;
  for(const row of orderedTransactions(rows)){
    const side=String(row.side||"").toUpperCase();
    const qty=finiteNumber(row.units),price=finiteNumber(row.price),fees=Math.max(0,finiteNumber(row.fees)||0);
    const cur=String(row.currency||currency||"EUR").toUpperCase();
    if(qty===null||qty<=0||price===null||price<0)continue;
    if(units>1e-8&&cur!==currency)throw new Error("Fund transaction currency differs from current position");
    if(units<=1e-8)currency=cur;
    totalFees+=fees;
    if(side==="BUY"){
      if(!firstBuyAt)firstBuyAt=row.executed_at||row.created_at||null;
      units+=qty;
      costBasis+=qty*price+fees;
    }else if(side==="SELL"){
      if(qty>units+1e-8)throw new Error("Sell units exceed current fund position");
      const avg=units>1e-8?costBasis/units:0;
      realized+=qty*price-fees-qty*avg;
      units-=qty;
      costBasis-=qty*avg;
      if(units<=1e-8){units=0;costBasis=0}
    }
  }
  return {units,avgPrice:units>1e-8?costBasis/units:null,invested:costBasis,realizedPnl:realized,totalFees,currency,firstBuyAt};
}

