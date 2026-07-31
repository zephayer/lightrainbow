/* ============================================
 * 总包计算器 - 核心逻辑
 * 计算口径：授予价值（授予日收盘价 × 授予日汇率 × 授予股数）
 * 非交易日取数：往前找最近交易日
 * ============================================ */

/* ---------- 工具函数 ---------- */
const $ = (sel) => document.querySelector(sel);
const money = (n) => "¥" + Math.round(n).toLocaleString("zh-CN");
const moneyW = (n) => "¥" + (n / 10000).toFixed(1) + "万";

function fmtNum(n) {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/* 已在数据层预计算好排序索引：
 * window.STOCK_DATES  = 股价交易日（升序）
 * window.RATE_DATES   = 汇率交易日（升序）
 */

/* 二分查找：返回 dataset 中 <= date 的最近日期 */
function prevDateIn(dataset, dateStr) {
  let lo = 0, hi = dataset.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dataset[mid] <= dateStr) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans >= 0 ? dataset[ans] : null;
}

/* 取授予日收盘价（股价独立往前找最近交易日） */
function getClose(dateStr) {
  const td = prevDateIn(window.STOCK_DATES, dateStr);
  if (!td) return null;
  return parseFloat(window.MT_STOCK[td]);
}

/* 取授予日汇率（汇率独立往前找最近交易日） */
function getRate(dateStr) {
  const td = prevDateIn(window.RATE_DATES, dateStr);
  if (!td) return null;
  return window.HKD_RATE[td] != null ? parseFloat(window.HKD_RATE[td]) : null;
}

/* 最新收盘价（当前市价口径参考） */
function getLatestClose() {
  const last = window.STOCK_DATES[window.STOCK_DATES.length - 1];
  return parseFloat(window.MT_STOCK[last]);
}
function getLatestRate() {
  // 汇率日期可能比股价多，取汇率最新
  const dates = Object.keys(window.HKD_RATE).sort();
  return parseFloat(window.HKD_RATE[dates[dates.length - 1]]);
}

/* ---------- Prompt 常量 ---------- */
const DOUBAO_PROMPT = `你是一个数据整理助手。我会上传美团股票期权页面的截图，请帮我提取成 JSON 格式。

我需要的是【授予明细】页面的截图，包含：
- 授予日期（Grant Date）
- 授予股数（Total Grant Shares）
- 归属明细：每笔归属的日期（Vesting Date）和归属股数（Vesting Shares）

请严格按以下 JSON 格式返回，不要任何其他文字：

{"grants":[{"grant_date":"YYYY-MM-DD","grant_shares":整数,"vesting_schedule":[{"vesting_date":"YYYY-MM-DD","vesting_shares":整数}]}]}

注意：
1. 每条 grant 内所有 vesting_shares 之和必须等于 grant_shares
2. vesting_date 不能早于 grant_date
3. 只返回 JSON，不要加任何解释文字`;

const EXAMPLE_JSON = JSON.stringify({
  grants: [
    {
      grant_date: "2024-06-03",
      grant_shares: 200,
      vesting_schedule: [
        { vesting_date: "2025-06-03", vesting_shares: 50 },
        { vesting_date: "2026-06-03", vesting_shares: 50 },
        { vesting_date: "2027-06-03", vesting_shares: 50 },
        { vesting_date: "2028-06-03", vesting_shares: 50 }
      ]
    },
    {
      grant_date: "2025-06-03",
      grant_shares: 100,
      vesting_schedule: [
        { vesting_date: "2026-06-03", vesting_shares: 50 },
        { vesting_date: "2027-06-03", vesting_shares: 50 }
      ]
    }
  ]
}, null, 2);

/* ---------- 全局状态 ---------- */
let grants = [];        // [{grant_date, grant_shares, vesting_schedule:[{vesting_date,vesting_shares}]}]
let currentYearTab = "current";

/* ---------- 校验 ---------- */
function validateGrants(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return ["JSON 顶层必须是对象"];
  if (!Array.isArray(obj.grants)) return ['缺少 "grants" 数组'];
  if (obj.grants.length === 0) return ["grants 数组不能为空"];

  obj.grants.forEach((g, i) => {
    const tag = `记录${i + 1}`;
    if (!g.grant_date) errors.push(`${tag}：缺少授予日期 grant_date`);
    if (!g.grant_shares || !Number.isInteger(Number(g.grant_shares)) || Number(g.grant_shares) <= 0)
      errors.push(`${tag}：授予股数 grant_shares 必须为正整数`);
    if (!Array.isArray(g.vesting_schedule) || g.vesting_schedule.length === 0)
      errors.push(`${tag}：缺少归属明细 vesting_schedule`);

    let sum = 0;
    g.vesting_schedule.forEach((v, j) => {
      if (!v.vesting_date) errors.push(`${tag} 归属${j + 1}：缺少日期 vesting_date`);
      if (!v.vesting_shares || !Number.isInteger(Number(v.vesting_shares)) || Number(v.vesting_shares) <= 0)
        errors.push(`${tag} 归属${j + 1}：股数 vesting_shares 必须为正整数`);
      if (v.vesting_date && g.grant_date && v.vesting_date < g.grant_date)
        errors.push(`${tag} 归属${j + 1}：归属日期 ${v.vesting_date} 早于授予日期 ${g.grant_date}`);
      sum += Number(v.vesting_shares);
    });
    if (g.grant_shares && sum !== Number(g.grant_shares))
      errors.push(`${tag}：归属股数之和 ${sum} ≠ 授予股数 ${g.grant_shares}，差 ${Number(g.grant_shares) - sum} 股`);
  });
  return errors;
}

/* ---------- 计算 ---------- */
function calcGrant(g) {
  const close = getClose(g.grant_date);
  const rate = getRate(g.grant_date);
  const shares = Number(g.grant_shares);
  const value = (close && rate) ? shares * close * rate : null;  // 授予总价值(人民币)
  return { ...g, close, rate, value };
}

function calcTotal(grantsWithValue, year) {
  const salary = Number($("#salary").value.replace(/,/g, "")) || 0;
  const bonus = Number($("#bonus").value) || 0;
  const cash = salary * (12 + bonus);
  const curYear = new Date().getFullYear();
  const targetYear = year + (currentYearTab === "next" ? 1 : 0);

  let stockValue = 0;
  const details = [];
  grantsWithValue.forEach((g) => {
    if (!g.value) return;
    // 计算归属到 targetYear 的股数
    let vestedInYear = 0;
    g.vesting_schedule.forEach((v) => {
      const vy = parseInt(v.vesting_date.slice(0, 4), 10);
      if (vy === targetYear) vestedInYear += Number(v.vesting_shares);
    });
    const ratio = vestedInYear / g.grant_shares;
    const yearValue = g.value * ratio;
    stockValue += yearValue;
    details.push({ grant: g, vestedInYear, ratio, yearValue });
  });
  return { cash, stockValue, total: cash + stockValue, year: targetYear, details };
}

/* ---------- 渲染：授予记录卡片 ---------- */
function renderGrantCards() {
  const wrap = $("#grant-list-wrap");
  const list = $("#grant-list");
  if (grants.length === 0) { wrap.classList.add("hidden"); return; }
  wrap.classList.remove("hidden");

  const curYear = new Date().getFullYear();
  list.innerHTML = grants.map((g, i) => {
    const value = calcGrant(g).value;
    const chips = g.vesting_schedule.map((v) => {
      const vy = parseInt(v.vesting_date.slice(0, 4), 10);
      let cls = "vest-chip";
      if (vy === curYear) cls += " this-year";
      else if (vy === curYear + 1) cls += " next-year";
      return `<span class="${cls}">${v.vesting_date} · ${v.vesting_shares}股</span>`;
    }).join("");

    let valueStr = '⚠️ 无股价/汇率数据';
    if (value != null) valueStr = money(value);
    const closeStr = g.close != null ? `HK$${g.close.toFixed(2)}` : "—";
    const rateStr = g.rate != null ? g.rate.toFixed(4) : "—";

    return `
    <div class="grant-card">
      <div class="grant-head">
        <span class="grant-title">授予${i + 1} · ${g.grant_date} · ${g.grant_shares}股</span>
        <span class="grant-value">${valueStr}</span>
        <button class="grant-del" data-i="${i}">×</button>
      </div>
      <div class="grant-vest">${chips}</div>
      <div class="grant-edit">授予日收盘 ${closeStr} · 汇率 ${rateStr}</div>
    </div>`;
  }).join("");

  // 结果区是否显示
  if (grants.length > 0) renderResult();
}

/* ---------- 渲染：结果 ---------- */
function renderResult() {
  $("#sec-result").classList.remove("hidden");
  const labels = { current: "", next: "（下一年）" };
  const data = calcTotal(grants.map(calcGrant), new Date().getFullYear());

  $("#hero-label").textContent = `${data.year} 年总包 ${labels[currentYearTab]}`;
  $("#hero-value").textContent = money(data.total);
  $("#hero-breakdown").textContent = `现金 ${money(data.cash)} ＋ 股票 ${money(data.stockValue)}`;

  // 环比（今年 vs 去年）
  if (currentYearTab === "current") {
    const last = calcTotal(grants.map(calcGrant), new Date().getFullYear() - 1);
    if (last.total > 0) {
      const pct = ((data.total - last.total) / last.total) * 100;
      const deltaEl = $("#hero-delta");
      deltaEl.classList.remove("up", "down");
      deltaEl.classList.add(pct >= 0 ? "up" : "down");
      deltaEl.textContent = `${pct >= 0 ? "▲" : "▼"} 较去年 ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%（去年 ${money(last.total)}）`;
    }
  } else {
    $("#hero-delta").textContent = "";
  }

  // 明细表
  const curYear = new Date().getFullYear();
  const targetYear = curYear + (currentYearTab === "next" ? 1 : 0);
  const rows = data.details.map((d, i) => {
    const g = d.grant;
    return `
    <tr>
      <td>授予${i + 1} ${g.grant_date}</td>
      <td>${g.grant_shares}</td>
      <td>${money(g.value)}</td>
      <td>HK$${g.close.toFixed(2)}</td>
      <td>${g.rate.toFixed(4)}</td>
      <td>${d.vestedInYear}股</td>
      <td>${money(d.yearValue)}</td>
    </tr>`;
  }).join("");

  $("#result-table-wrap").innerHTML = `
  <table class="result-table">
    <thead>
      <tr>
        <th>授予</th><th>授予股数</th><th>授予价值(¥)</th><th>授予日股价(HK$)</th>
        <th>当日汇率</th><th>${targetYear}归属</th><th>${targetYear}计入(¥)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="total-row">
        <td>合计</td>
        <td>${grants.reduce((a, g) => a + Number(g.grant_shares), 0)}</td>
        <td>${money(data.details.reduce((a, d) => a + d.grant.value, 0))}</td>
        <td>—</td><td>—</td>
        <td>${data.details.reduce((a, d) => a + d.vestedInYear, 0)}股</td>
        <td>${money(data.stockValue)}</td>
      </tr>
    </tfoot>
  </table>`;

  // 数据来源
  const latest = getLatestClose();
  const latestRate = getLatestRate();
  $("#data-source").textContent =
    `股价：腾讯财经 3690.HK 最新收盘 HK$${latest.toFixed(2)} · 汇率：人行中间价 ${latestRate.toFixed(4)} · 更新至 ${new Date().toLocaleDateString("zh-CN")}`;
}

/* ---------- 收入变动 ---------- */
function onIncomeChange() {
  const salary = Number($("#salary").value.replace(/,/g, "")) || 0;
  const bonus = Number($("#bonus").value) || 0;
  // 千分位
  if ($("#salary").value.replace(/,/g, "") !== String(salary)) {
    $("#salary").value = salary.toLocaleString("zh-CN");
  }
  const cash = salary * (12 + bonus);
  $("#income-hint").textContent = `现金部分：${money(cash)} / 年`;
  if (grants.length > 0) renderResult();
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2000);
}

/* ---------- 初始化 ---------- */
function init() {
  $("#prompt-text").textContent = DOUBAO_PROMPT;

  // 收入输入
  const salary = $("#salary"), bonus = $("#bonus");
  salary.addEventListener("input", onIncomeChange);
  bonus.addEventListener("input", onIncomeChange);
  salary.addEventListener("blur", onIncomeChange);
  bonus.addEventListener("blur", onIncomeChange);
  onIncomeChange();

  // 复制 prompt
  $("#copy-prompt").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(DOUBAO_PROMPT);
      toast("✅ Prompt 已复制，去豆包粘贴吧");
    } catch (e) {
      // 降级
      const ta = document.createElement("textarea");
      ta.value = DOUBAO_PROMPT;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("✅ Prompt 已复制，去豆包粘贴吧");
    }
  });

  // 粘贴示例
  $("#paste-example").addEventListener("click", () => {
    $("#grants-json").value = EXAMPLE_JSON;
    doParse();
  });

  // 解析 JSON
  $("#parse-json").addEventListener("click", doParse);


  // 删除授予
  $("#grant-list").addEventListener("click", (e) => {
    if (e.target.classList.contains("grant-del")) {
      const i = Number(e.target.dataset.i);
      grants.splice(i, 1);
      renderGrantCards();
    }
  });

  // 年份切换
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentYearTab = tab.dataset.year;
      if (grants.length > 0) renderResult();
    });
  });

  renderGrantCards();
}

function doParse() {
  const raw = $("#grants-json").value.trim();
  const errBox = $("#parse-error");
  errBox.innerHTML = "";
  if (!raw) { errBox.textContent = "请先粘贴豆包返回的 JSON"; return; }

  let obj;
  try { obj = JSON.parse(raw); }
  catch (e) { errBox.textContent = "❌ JSON 格式有误，请检查是否完整复制（含开头 { 和结尾 }）"; return; }

  const errors = validateGrants(obj);
  if (errors.length > 0) {
    errBox.innerHTML = "<ul>" + errors.map((e) => `<li>❌ ${e}</li>`).join("") + "</ul>";
    return;
  }

  // 规范化数据类型
  grants = obj.grants.map((g) => ({
    grant_date: g.grant_date,
    grant_shares: Number(g.grant_shares),
    vesting_schedule: g.vesting_schedule.map((v) => ({
      vesting_date: v.vesting_date,
      vesting_shares: Number(v.vesting_shares)
    }))
  }));
  errBox.innerHTML = '<span style="color:var(--green)">✅ 解析成功！请确认下方记录，或点击「计算总包」</span>';
  renderGrantCards();
  const res = $("#sec-result");
  if (res && res.scrollIntoView) res.scrollIntoView({ behavior: "smooth" });
}

document.addEventListener("DOMContentLoaded", init);
