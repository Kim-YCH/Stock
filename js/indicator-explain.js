const explainContextCache = Object.create(null);
let lastExplainTrigger = null;

function explainFinite(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function explainNumber(value, digits = 1) {
  const parsed = explainFinite(value);
  if (parsed === null) return "-";
  return parsed.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function explainPrice(value) {
  const parsed = explainFinite(value);
  return parsed === null ? "-" : parsed.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function compactExplanation(title, verdict, reasons, related) {
  return {
    title: String(title || "技術判斷"),
    verdict: String(verdict || "目前資料不足。"),
    reasons: (Array.isArray(reasons) ? reasons : [reasons]).filter(Boolean).slice(0, 4),
    related: (Array.isArray(related) ? related : []).filter(Boolean).slice(0, 4)
  };
}

function missingExplanation(title, related, detail) {
  return compactExplanation(
    title,
    `${title}目前資料不足。`,
    [detail || "需要足夠歷史價格後才能計算。"],
    related
  );
}

function contextValue(context, ...keys) {
  for (const key of keys) {
    const value = explainFinite(context && context[key]);
    if (value !== null) return value;
  }
  return null;
}

function buildAverageExplanation(context, key, label) {
  const close = contextValue(context, "close", "lastPrice");
  const average = contextValue(context, key);
  if (close === null || average === null) return missingExplanation(label, ["RSI", "MACD", "ADX"], `缺少收盤價或 ${label}。`);
  const above = close >= average;
  const reasons = [
    `收盤 ${explainPrice(close)} ${above ? "高於" : "低於"} ${label} ${explainPrice(average)}`,
    above ? "價格位於均線上方，趨勢條件較有利" : "價格位於均線下方，需留意轉弱風險"
  ];
  const rsi = contextValue(context, "rsi14");
  if (rsi !== null) reasons.push(`RSI ${explainNumber(rsi)}，${rsi >= 50 ? "動能偏多" : "動能尚未轉強"}`);
  const adx = contextValue(context, "adx14");
  if (adx !== null) reasons.push(`ADX ${explainNumber(adx)}，${adx >= 25 ? "趨勢明顯" : "趨勢強度仍需確認"}`);
  return compactExplanation(
    `${label} ${above ? "站上" : "跌破"}`,
    `收盤價${above ? "站在" : "落在"} ${label} ${above ? "上方，結構偏多" : "下方，結構偏弱"}。`,
    reasons,
    ["RSI", "MACD", "ADX"]
  );
}

function buildRsiExplanation(context) {
  const rsi = contextValue(context, "rsi14", "rsi");
  if (rsi === null) return missingExplanation("RSI 相對強弱", ["MA20", "MACD", "KD"]);
  if (rsi >= 70) return compactExplanation(
    "RSI 過熱",
    `RSI ${explainNumber(rsi)}，短線動能很強但已偏熱。`,
    ["RSI 高於 70，買方動能強", "短線追價風險提高", "若乖離 MA20 過大，需留意拉回"],
    ["MA20", "Bias20", "布林通道"]
  );
  if (rsi >= 50) return compactExplanation(
    "RSI 高於 50",
    `RSI ${explainNumber(rsi)}，高於 50，短線動能偏多。`,
    ["RSI 大於 50，買方力道略佔優勢", "尚未超過 70，沒有明顯過熱", "建議搭配 MA20 與 MACD 確認趨勢"],
    ["MA20", "MACD", "KD"]
  );
  if (rsi <= 30) return compactExplanation(
    "RSI 超賣",
    `RSI ${explainNumber(rsi)}，短線賣壓偏重並接近超賣。`,
    ["RSI 低於 30，價格動能偏弱", "超賣不代表立即反彈", "等待重新站回 30 並確認價格止穩"],
    ["MA20", "KD", "布林通道"]
  );
  return compactExplanation(
    "RSI 低於 50",
    `RSI ${explainNumber(rsi)}，買方動能尚未轉強。`,
    ["RSI 低於 50，買方力道不足", "若同時跌破 MA20，短線偏弱", "等待 RSI 重新站回 50"],
    ["MA20", "MACD", "KD"]
  );
}

function buildKdExplanation(context, requestedKey) {
  const k = contextValue(context, "k9", "k");
  const d = contextValue(context, "d9", "d");
  if (k === null || d === null) return missingExplanation("KD 隨機指標", ["MA20", "MACD", "RSI"], "缺少 K 值或 D 值。");
  const bullish = k >= d;
  const title = requestedKey === "KD金叉" ? "KD 金叉" : requestedKey === "KD死叉" ? "KD 死叉" : `KD ${bullish ? "偏多" : "偏弱"}`;
  return compactExplanation(
    title,
    `K 值${bullish ? "高於" : "低於"} D 值，短線動能${bullish ? "偏多" : "轉弱"}。`,
    [`K：${explainNumber(k)}`, `D：${explainNumber(d)}`, `K ${bullish ? ">" : "<"} D，短線買盤${bullish ? "較有利" : "降溫"}`, `${bullish ? "若站上" : "若同時跌破"} MA20，訊號可信度更高`],
    ["MA20", "MACD", "RSI"]
  );
}

function buildMacdExplanation(context) {
  const macd = contextValue(context, "macd", "macdLine");
  const signal = contextValue(context, "macdSignal", "signalLine");
  const hist = contextValue(context, "macdHist", "histogram");
  if (macd === null && hist === null) return missingExplanation("MACD", ["MA20", "EMA20", "ADX"]);
  const bullish = hist !== null ? hist >= 0 : (signal !== null && macd >= signal);
  const reasons = [];
  if (macd !== null) reasons.push(`MACD：${explainNumber(macd, 2)}`);
  if (signal !== null) reasons.push(`訊號線：${explainNumber(signal, 2)}`);
  if (hist !== null) reasons.push(`柱狀體 ${explainNumber(hist, 2)}，位於零軸${hist >= 0 ? "上方" : "下方"}`);
  reasons.push(bullish ? "目前趨勢動能偏多" : "目前趨勢動能偏弱");
  return compactExplanation(
    `MACD ${bullish ? "偏多" : "偏弱"}`,
    `MACD 動能目前${bullish ? "位於多方" : "位於空方"}。`,
    reasons,
    ["MA20", "EMA20", "ADX"]
  );
}

function buildBollingerExplanation(context) {
  const close = contextValue(context, "close");
  const upper = contextValue(context, "bbUpper");
  const lower = contextValue(context, "bbLower");
  const percentB = contextValue(context, "bbPercentB");
  if (percentB === null && (close === null || upper === null || lower === null)) return missingExplanation("布林通道", ["MA20", "ATR%", "ADX"]);
  let position = "位於通道中段";
  if (percentB !== null) position = percentB >= 0.8 ? "接近上緣" : percentB <= 0.2 ? "接近下緣" : "位於通道中段";
  const reasons = [];
  if (percentB !== null) reasons.push(`布林 %B：${explainNumber(percentB, 2)}`);
  if (upper !== null) reasons.push(`上軌：${explainPrice(upper)}`);
  if (lower !== null) reasons.push(`下軌：${explainPrice(lower)}`);
  reasons.push(position === "接近上緣" ? "強勢但需留意追價風險" : position === "接近下緣" ? "價格偏弱，等待止穩確認" : "尚未進入明顯極端區");
  return compactExplanation("布林位置", `目前價格${position}。`, reasons, ["MA20", "ATR%", "ADX"]);
}

function buildAdxExplanation(context) {
  const adx = contextValue(context, "adx14", "adx");
  const plus = contextValue(context, "plusDI14", "plusDI");
  const minus = contextValue(context, "minusDI14", "minusDI");
  if (adx === null) return missingExplanation("ADX 趨勢強度", ["+DI", "-DI", "MA20"]);
  const strength = adx >= 25 ? "趨勢明顯" : adx >= 20 ? "趨勢開始形成" : "目前偏盤整";
  const reasons = [`ADX：${explainNumber(adx)}`, adx >= 25 ? "高於 25，趨勢強度足夠" : "未達 25，趨勢強度仍需確認"];
  if (plus !== null && minus !== null) reasons.push(`+DI ${explainNumber(plus)} ${plus >= minus ? ">" : "<"} -DI ${explainNumber(minus)}，方向${plus >= minus ? "偏多" : "偏空"}`);
  return compactExplanation("ADX 趨勢強度", `ADX ${explainNumber(adx)}，${strength}。`, reasons, ["+DI", "-DI", "MA20"]);
}

function buildDiExplanation(context, positive) {
  const plus = contextValue(context, "plusDI14", "plusDI");
  const minus = contextValue(context, "minusDI14", "minusDI");
  const value = positive ? plus : minus;
  const label = positive ? "+DI" : "-DI";
  if (value === null) return missingExplanation(label, [positive ? "-DI" : "+DI", "ADX", "MA20"]);
  const favorable = plus !== null && minus !== null ? (positive ? plus >= minus : minus >= plus) : null;
  const reasons = [`${label}：${explainNumber(value)}`];
  if (plus !== null && minus !== null) reasons.push(`+DI ${explainNumber(plus)} / -DI ${explainNumber(minus)}`);
  reasons.push(favorable === null ? "需搭配另一條 DI 判斷方向" : favorable ? `${label} 目前佔優勢` : `${label} 目前未佔優勢`);
  return compactExplanation(label, `${label} 顯示${positive ? "多方" : "空方"}方向力量${favorable ? "較強" : "尚未佔優"}。`, reasons, [positive ? "-DI" : "+DI", "ADX", "MA20"]);
}

function buildAtrExplanation(context, percentMode) {
  const raw = percentMode ? contextValue(context, "atrPercent") : contextValue(context, "atr14", "atr");
  const label = percentMode ? "ATR%" : "ATR";
  if (raw === null) return missingExplanation(label, ["ADX", "MA20", "布林通道"]);
  const value = percentMode && Math.abs(raw) <= 1 ? raw * 100 : raw;
  const level = percentMode ? (value >= 5 ? "波動偏高" : value < 2 ? "波動較低" : "波動一般") : "近期平均波動";
  return compactExplanation(label, `${label} ${explainNumber(value, 2)}${percentMode ? "%" : ""}，${level}。`, [`目前數值：${explainNumber(value, 2)}${percentMode ? "%" : ""}`, "ATR 只代表波動，不代表漲跌方向", percentMode && value >= 5 ? "停損與部位需保留較大空間" : "可搭配趨勢判斷交易空間"], ["ADX", "MA20", "布林通道"]);
}

function buildVolumeExplanation(context) {
  const value = contextValue(context, "volumeRatio");
  if (value === null) return missingExplanation("量比", ["OBV", "VWAP20", "MA20"]);
  const state = value >= 1.5 ? "明顯放大" : value >= 1 ? "略高於平均" : "低於平均";
  return compactExplanation("量比", `量比 ${explainNumber(value, 2)} 倍，成交量${state}。`, [`量比：${explainNumber(value, 2)} 倍`, value >= 1 ? "市場參與度高於近期平均" : "目前量能不足", "量增需搭配價格方向判斷買盤或賣壓"], ["OBV", "VWAP20", "MA20"]);
}

function buildBiasExplanation(context) {
  const raw = contextValue(context, "bias20");
  if (raw === null) return missingExplanation("Bias20 乖離率", ["MA20", "ATR%", "RSI"]);
  const value = Math.abs(raw) <= 1 ? raw * 100 : raw;
  const state = value > 5 ? "正乖離偏大" : value < -5 ? "負乖離偏大" : "仍在一般區間";
  return compactExplanation("Bias20 乖離率", `Bias20 ${explainNumber(value, 2)}%，${state}。`, [`股價相對 MA20 ${value >= 0 ? "偏高" : "偏低"}`, Math.abs(value) > 5 ? "乖離擴大，需留意回歸均線" : "目前沒有明顯乖離", "不同股票需搭配 ATR% 判讀"], ["MA20", "ATR%", "RSI"]);
}

function buildObvExplanation(context) {
  const value = contextValue(context, "obv");
  const average = contextValue(context, "obvMa20");
  if (value === null) return missingExplanation("OBV 能量潮", ["量比", "VWAP20", "MA20"]);
  const bullish = average !== null ? value >= average : String(context.obvTrend || "").toUpperCase() === "UP";
  return compactExplanation("OBV 能量潮", `OBV 量能趨勢目前${bullish ? "偏多" : "偏弱"}。`, [`OBV：${explainNumber(value, 0)}`, average !== null ? `OBV ${bullish ? "高於" : "低於"}均線 ${explainNumber(average, 0)}` : "目前依 OBV 方向判斷", "量價同步時訊號較可靠"], ["量比", "VWAP20", "MA20"]);
}

function buildOscillatorExplanation(context, key, label, upper, lower, related) {
  const value = contextValue(context, key);
  if (value === null) return missingExplanation(label, related);
  const state = value >= upper ? "偏熱" : value <= lower ? "偏弱或超賣" : value >= 50 ? "偏多" : "中性偏弱";
  return compactExplanation(label, `${label} ${explainNumber(value)}，目前${state}。`, [`目前數值：${explainNumber(value)}`, value >= upper ? `高於 ${upper}，留意過熱` : value <= lower ? `低於 ${lower}，動能偏弱` : "尚未進入極端區", "需搭配價格趨勢確認"], related);
}

function buildCciExplanation(context) {
  const value = contextValue(context, "cci20");
  if (value === null) return missingExplanation("CCI20", ["MA20", "RSI", "ADX"]);
  const state = value >= 100 ? "動能偏強" : value <= -100 ? "動能偏弱" : "一般區間";
  return compactExplanation("CCI20", `CCI ${explainNumber(value)}，目前位於${state}。`, [`CCI：${explainNumber(value)}`, value >= 100 ? "高於 +100，趨勢動能強" : value <= -100 ? "低於 -100，賣壓偏重" : "介於 -100 與 +100", "搭配 MA20 判斷方向"], ["MA20", "RSI", "ADX"]);
}

function buildWilliamsExplanation(context) {
  const value = contextValue(context, "williamsR14");
  if (value === null) return missingExplanation("Williams %R", ["KD", "RSI", "MA20"]);
  const state = value >= -20 ? "接近過熱" : value <= -80 ? "接近超賣" : "一般區間";
  return compactExplanation("Williams %R", `Williams %R ${explainNumber(value)}，${state}。`, [`目前數值：${explainNumber(value)}`, value >= -20 ? "高於 -20，短線位置偏高" : value <= -80 ? "低於 -80，短線位置偏低" : "尚未進入極端區", "極端值不代表立即反轉"], ["KD", "RSI", "MA20"]);
}

function buildRocExplanation(context, key, label) {
  const value = contextValue(context, key);
  if (value === null) return missingExplanation(label, [key === "roc5" ? "ROC20" : "ROC5", "RSI", "MA20"]);
  return compactExplanation(label, `${label} ${explainNumber(value, 2)}%，價格動能${value >= 0 ? "為正" : "為負"}。`, [`目前變動率：${explainNumber(value, 2)}%`, value >= 0 ? "期間價格上漲" : "期間價格下跌", "需留意單日跳空造成的影響"], [key === "roc5" ? "ROC20" : "ROC5", "RSI", "MA20"]);
}

function buildSuperTrendExplanation(context) {
  const direction = String(context.superTrendDirection || context.superTrendDir || "").toUpperCase();
  const value = contextValue(context, "superTrend");
  if (!direction && value === null) return missingExplanation("SuperTrend", ["MA20", "ADX", "ATR%"]);
  const bullish = direction === "UP" || direction === "多方";
  const reasons = [`方向：${direction || "尚未提供"}`];
  if (value !== null) reasons.push(`趨勢線：${explainPrice(value)}`);
  reasons.push(bullish ? "價格結構維持多方" : "價格結構偏空或尚未翻多");
  return compactExplanation("SuperTrend", `SuperTrend 目前為${bullish ? "多方" : "空方"}。`, reasons, ["MA20", "ADX", "ATR%"]);
}

function buildDonchianExplanation(context) {
  const close = contextValue(context, "close");
  const high = contextValue(context, "donchianHigh20", "high20");
  const low = contextValue(context, "donchianLow20", "low20");
  if (close === null || high === null || low === null) return missingExplanation("Donchian 20", ["量比", "ADX", "MA20"]);
  const state = close >= high ? "突破上緣" : close <= low ? "跌破下緣" : "位於通道內";
  return compactExplanation("Donchian 20", `收盤價目前${state}。`, [`收盤：${explainPrice(close)}`, `上緣：${explainPrice(high)}`, `下緣：${explainPrice(low)}`, state === "突破上緣" ? "突破需搭配量能確認" : state === "跌破下緣" ? "跌破代表風險升高" : "尚未出現通道突破"], ["量比", "ADX", "MA20"]);
}

function buildScoreExplanation(context, key, label) {
  const score = contextValue(context, key);
  if (score === null) return missingExplanation(label, ["MA20", "RSI", "ADX"]);
  const isRisk = key === "riskScore";
  let state;
  if (isRisk) state = score >= 60 ? "風險相對可控" : score < 40 ? "風險偏高" : "需持續觀察";
  else state = score >= 80 ? "強勢" : score >= 60 ? "偏多" : score < 40 ? "偏弱" : "中性";
  const reasons = [`${label}：${explainNumber(score, 0)}`];
  const close = contextValue(context, "close");
  const ma20 = contextValue(context, "ma20");
  const rsi = contextValue(context, "rsi14");
  const adx = contextValue(context, "adx14");
  if (close !== null && ma20 !== null) reasons.push(`股價${close >= ma20 ? "站上" : "跌破"} MA20`);
  if (rsi !== null) reasons.push(`RSI ${explainNumber(rsi)}，${rsi >= 50 ? "動能偏多" : "動能偏弱"}`);
  if (adx !== null) reasons.push(`${adx >= 25 ? "✓" : "⚠"} ADX ${explainNumber(adx)}，${adx >= 25 ? "趨勢明顯" : "趨勢強度不足"}`);
  return compactExplanation(`${label} ${explainNumber(score, 0)}`, `分數位於${state}區間。`, reasons, isRisk ? ["技術分數", "ATR%", "ADX"] : ["風險分數", "ADX", "ATR%"]);
}

function buildStatusExplanation(context, marketMode) {
  const status = String(marketMode ? (context.marketMode || context.trendText || "") : (context.statusText || context.trendText || ""));
  if (!status) return missingExplanation(marketMode ? "大盤狀態" : "技術狀態", ["技術分數", "MA20", "ADX"]);
  const reasons = [];
  const score = contextValue(context, "totalScore");
  const rsi = contextValue(context, "rsi14");
  const adx = contextValue(context, "adx14");
  if (score !== null) reasons.push(`技術分數：${explainNumber(score, 0)}`);
  if (rsi !== null) reasons.push(`RSI：${explainNumber(rsi)}`);
  if (adx !== null) reasons.push(`ADX：${explainNumber(adx)}`);
  if (!reasons.length) reasons.push("依目前趨勢、動能與風險條件綜合判斷");
  return compactExplanation(marketMode ? "大盤狀態" : "技術狀態", `目前判斷為「${status}」。`, reasons, ["技術分數", "MA20", "ADX"]);
}

function buildNoteExplanation(context, title) {
  const note = String(context.currentReasonOverride || "").trim();
  return compactExplanation(title, note || "目前條件已符合系統規則。", [note || "請搭配技術分數與風險分數確認。"], ["技術分數", "風險分數", "MA20"]);
}

const EXPLAIN_DEFINITIONS = {};

[
  ["MA5", "ma5"], ["MA20", "ma20"], ["MA60", "ma60"],
  ["EMA5", "ema5"], ["EMA10", "ema10"], ["EMA20", "ema20"], ["EMA60", "ema60"],
  ["VWAP20", "vwap20"]
].forEach(([label, key]) => { EXPLAIN_DEFINITIONS[label] = { build: context => buildAverageExplanation(context, key, label) }; });

Object.assign(EXPLAIN_DEFINITIONS, {
  RSI: { build: buildRsiExplanation },
  KD: { build: context => buildKdExplanation(context, "KD") },
  K9: { build: context => buildKdExplanation(context, "KD") },
  D9: { build: context => buildKdExplanation(context, "KD") },
  MACD: { build: buildMacdExplanation },
  MACD_HIST: { build: buildMacdExplanation },
  BOLLINGER: { build: buildBollingerExplanation },
  BB_PERCENT_B: { build: buildBollingerExplanation },
  BB_WIDTH: { build: buildBollingerExplanation },
  ADX: { build: buildAdxExplanation },
  PLUS_DI: { build: context => buildDiExplanation(context, true) },
  MINUS_DI: { build: context => buildDiExplanation(context, false) },
  ATR: { build: context => buildAtrExplanation(context, false) },
  ATR_PERCENT: { build: context => buildAtrExplanation(context, true) },
  VOLUME_RATIO: { build: buildVolumeExplanation },
  BIAS20: { build: buildBiasExplanation },
  OBV: { build: buildObvExplanation },
  MFI: { build: context => buildOscillatorExplanation(context, "mfi14", "MFI14", 80, 20, ["RSI", "量比", "OBV"]) },
  CCI: { build: buildCciExplanation },
  WILLIAMS_R: { build: buildWilliamsExplanation },
  ROC5: { build: context => buildRocExplanation(context, "roc5", "ROC5") },
  ROC20: { build: context => buildRocExplanation(context, "roc20", "ROC20") },
  SUPER_TREND: { build: buildSuperTrendExplanation },
  DONCHIAN: { build: buildDonchianExplanation },
  HIGH20: { build: buildDonchianExplanation },
  LOW20: { build: buildDonchianExplanation },
  TECH_SCORE: { build: context => buildScoreExplanation(context, "totalScore", "技術分數") },
  TREND_SCORE: { build: context => buildScoreExplanation(context, "trendScore", "趨勢分數") },
  MOMENTUM_SCORE: { build: context => buildScoreExplanation(context, "momentumScore", "動能分數") },
  RISK_SCORE: { build: context => buildScoreExplanation(context, "riskScore", "風險分數") },
  BREAKOUT_SCORE: { build: context => buildScoreExplanation(context, "breakoutScore", "突破分數") },
  VOLATILITY_SCORE: { build: context => buildScoreExplanation(context, "volatilityScore", "波動分數") },
  TREND_TEXT: { build: context => buildStatusExplanation(context, false) },
  MARKET_MODE: { build: context => buildStatusExplanation(context, true) },
  CANDIDATE_REASON: { build: context => buildNoteExplanation(context, "候選命中原因") },
  STRATEGY_MODEL: { build: context => buildNoteExplanation(context, "策略模型") }
});

function buildFallbackShortExplanation(key, context) {
  return buildNoteExplanation(context || {}, String(key || "技術訊號"));
}

function buildSignalExplanation(key, context) {
  const normalized = String(key || "").trim();
  if (normalized === "MA20" || normalized === "跌破MA20") return buildAverageExplanation(context, "ma20", "MA20");
  if (normalized === "MA60" || normalized === "跌破MA60") return buildAverageExplanation(context, "ma60", "MA60");
  if (normalized.startsWith("RSI")) return buildRsiExplanation(context);
  if (normalized === "KD金叉" || normalized === "KD死叉") return buildKdExplanation(context, normalized);
  if (normalized === "MACD+" || normalized === "MACD-") return buildMacdExplanation(context);
  if (normalized.startsWith("布林")) return buildBollingerExplanation(context);
  if (normalized === "ADX趨勢") return buildAdxExplanation(context);
  if (normalized === "量增" || normalized === "量縮") return buildVolumeExplanation(context);
  if (normalized === "ATR高波動" || normalized === "ATR低波動") return buildAtrExplanation(context, true);
  if (normalized.startsWith("SuperTrend")) return buildSuperTrendExplanation(context);
  if (normalized === "突破20高" || normalized === "跌破20低" || normalized.startsWith("Donchian")) return buildDonchianExplanation(context);
  if (normalized.startsWith("VWAP")) return buildAverageExplanation(context, "vwap20", "VWAP20");
  if (normalized.startsWith("OBV")) return buildObvExplanation(context);
  if (normalized.startsWith("MFI")) return EXPLAIN_DEFINITIONS.MFI.build(context);
  if (normalized.startsWith("CCI")) return buildCciExplanation(context);
  if (normalized.startsWith("Williams")) return buildWilliamsExplanation(context);
  if (normalized.startsWith("ROC")) return contextValue(context, "roc5") !== null ? buildRocExplanation(context, "roc5", "ROC5") : buildRocExplanation(context, "roc20", "ROC20");
  return buildFallbackShortExplanation(normalized, context);
}

function buildIndicatorExplanation(key, context) {
  const definition = EXPLAIN_DEFINITIONS[key];
  if (!definition || typeof definition.build !== "function") return buildFallbackShortExplanation(key, context);
  try {
    return definition.build(context || {});
  } catch (error) {
    return missingExplanation(String(key || "技術指標"), ["MA20", "RSI", "ADX"]);
  }
}

function normalizeExplainSymbol(symbol) {
  return String(symbol || "").trim();
}

function cacheExplainContext(source) {
  if (!source || typeof source !== "object") return {};
  const latest = source.latest || source.indicator || {};
  const symbol = normalizeExplainSymbol(source.symbol || latest.symbol);
  if (!symbol) return Object.assign({}, latest, source);
  const previous = explainContextCache[symbol] || {};
  const merged = Object.assign({}, previous, source, latest, {
    symbol,
    name: source.name || latest.name || previous.name || "",
    close: latest.close !== undefined ? latest.close : (source.close !== undefined ? source.close : source.lastPrice),
    dataDate: source.dataDate || source.date || latest.date || source.lastDate || ""
  });
  explainContextCache[symbol] = merged;
  return merged;
}

function findExplainRow(items, symbol) {
  return (Array.isArray(items) ? items : []).find(item => normalizeExplainSymbol(item && item.symbol) === symbol) || null;
}

function getExplainContext(symbol, targetElement) {
  symbol = normalizeExplainSymbol(symbol || (targetElement && targetElement.dataset.symbol));
  let context = symbol && explainContextCache[symbol] ? Object.assign({}, explainContextCache[symbol]) : {};
  if (typeof pageDataCache !== "undefined") {
    const dashboardRow = pageDataCache.dashboard && findExplainRow(pageDataCache.dashboard.watchlist, symbol);
    const candidateData = pageDataCache.candidates || {};
    const candidateRow = findExplainRow(candidateData.buyCandidates, symbol) || findExplainRow(candidateData.sellCandidates, symbol);
    const analysisRow = pageDataCache.analysis && pageDataCache.analysis[symbol];
    const detailRow = pageDataCache.stockDetail && pageDataCache.stockDetail[symbol];
    [dashboardRow, candidateRow, analysisRow, detailRow].filter(Boolean).forEach(row => {
      context = Object.assign(context, cacheExplainContext(row));
    });
  }
  if (targetElement && targetElement.dataset.explainValue !== undefined) context.explainValue = targetElement.dataset.explainValue;
  if (targetElement && targetElement.dataset.explainNote) context.currentReasonOverride = targetElement.dataset.explainNote;
  context.symbol = symbol || context.symbol || "";
  return context;
}

function openIndicatorExplanation({ type, key, symbol, context }) {
  const result = type === "signal"
    ? buildSignalExplanation(key, context || {})
    : buildIndicatorExplanation(key, context || {});
  renderIndicatorExplanationModal(result, { type, key, symbol, context: context || {} });
}

function explainEscapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function relatedExplainKey(label) {
  const map = {
    "量比": "VOLUME_RATIO", "風險分數": "RISK_SCORE", "技術分數": "TECH_SCORE", "趨勢分數": "TREND_SCORE",
    "動能分數": "MOMENTUM_SCORE", "突破分數": "BREAKOUT_SCORE", "波動分數": "VOLATILITY_SCORE", "布林 %B": "BB_PERCENT_B",
    "布林通道": "BOLLINGER", "ATR%": "ATR_PERCENT", "+DI": "PLUS_DI", "-DI": "MINUS_DI",
    "SuperTrend": "SUPER_TREND", "Donchian": "DONCHIAN", "Williams %R": "WILLIAMS_R", "MACD Histogram": "MACD_HIST",
    "候選理由": "CANDIDATE_REASON"
  };
  return map[label] || String(label || "").replace(/\s+/g, "_").toUpperCase();
}

function renderIndicatorExplanationModal(result, payload) {
  const modal = document.getElementById("indicatorExplainModal");
  const title = document.getElementById("indicatorExplainTitle");
  const kicker = document.getElementById("indicatorExplainKicker");
  const body = document.getElementById("indicatorExplainBody");
  if (!modal || !title || !body) return;
  const reasons = (result.reasons || []).slice(0, 4);
  const related = (result.related || []).slice(0, 4);
  kicker.textContent = payload.type === "signal" ? "訊號判斷原因" : "指標判斷原因";
  title.textContent = result.title || payload.key;
  body.innerHTML = `
    <section class="compact-explain-section"><h4>目前判斷</h4><div class="verdict-box">${explainEscapeHtml(result.verdict)}</div></section>
    <section class="compact-explain-section"><h4>判斷原因</h4><div class="reason-list">${reasons.map(reason => `<div>${/^[✓⚠]/.test(String(reason)) ? "" : "✓ "}${explainEscapeHtml(reason)}</div>`).join("") || "<div>目前資料不足。</div>"}</div></section>
    <section class="compact-explain-section"><h4>參考搭配</h4><div class="related-tags">${related.map(label => `<button type="button" data-explain-type="indicator" data-explain-key="${explainEscapeHtml(relatedExplainKey(label))}" data-symbol="${explainEscapeHtml(payload.symbol || (payload.context || {}).symbol || "")}">${explainEscapeHtml(label)}</button>`).join("")}</div></section>`;
  modal.hidden = false;
  document.body.classList.add("modal-open", "explain-modal-open");
  document.documentElement.classList.add("modal-open");
  if (window.getSelection) window.getSelection().removeAllRanges();
  const closeButton = modal.querySelector("[data-action='close-indicator-explain']");
  if (closeButton) closeButton.focus({ preventScroll: true });
  body.scrollTop = 0;
}

function closeIndicatorExplanationModal() {
  const modal = document.getElementById("indicatorExplainModal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("modal-open", "explain-modal-open");
  document.documentElement.classList.remove("modal-open");
  if (lastExplainTrigger && document.contains(lastExplainTrigger)) lastExplainTrigger.focus({ preventScroll: true });
  lastExplainTrigger = null;
}

function explainableButton(key, label, symbol, className = "", type = "indicator", note = "") {
  return `<button type="button" class="explainable-value ${explainEscapeHtml(className)}" data-explain-type="${explainEscapeHtml(type)}" data-explain-key="${explainEscapeHtml(key)}" data-symbol="${explainEscapeHtml(normalizeExplainSymbol(symbol))}"${note ? ` data-explain-note="${explainEscapeHtml(note)}"` : ""}>${label}</button>`;
}

document.addEventListener("click", event => {
  const closeTarget = event.target.closest("[data-action='close-indicator-explain']");
  if (closeTarget) {
    event.preventDefault();
    closeIndicatorExplanationModal();
    return;
  }
  const target = event.target.closest("[data-explain-key]");
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  lastExplainTrigger = target;
  const type = target.dataset.explainType || "indicator";
  const key = target.dataset.explainKey || "";
  const symbol = target.dataset.symbol || "";
  openIndicatorExplanation({ type, key, symbol, context: getExplainContext(symbol, target) });
});

document.addEventListener("selectstart", event => {
  if (!document.body.classList.contains("modal-open")) return;
  if (!event.target.closest(".explain-modal-body")) event.preventDefault();
});

document.addEventListener("dragstart", event => {
  if (document.body.classList.contains("modal-open")) event.preventDefault();
});

document.addEventListener("mousedown", event => {
  if (!document.body.classList.contains("modal-open")) return;
  if (event.target.closest(".explain-modal-backdrop") || (event.target.closest(".explain-modal-panel") && !event.target.closest(".explain-modal-body"))) {
    event.preventDefault();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeIndicatorExplanationModal();
});
