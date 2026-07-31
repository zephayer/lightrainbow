#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 CSV 数据转换为前端 JS 文件（window. 挂载，股价/汇率独立交易日索引）"""
import os, csv, json

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
SRC = os.path.join(BASE, "src", "data")
os.makedirs(SRC, exist_ok=True)

# 股价: {date: close}
stock = {}
with open(os.path.join(DATA, "mt_stock.csv"), encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        stock[r["date"]] = r["close"]
stock_dates = sorted(stock.keys())
with open(os.path.join(SRC, "mt_stock.js"), "w", encoding="utf-8") as f:
    f.write("window.MT_STOCK = " + json.dumps(stock, separators=(",", ":")) + ";\n")
    f.write("window.STOCK_DATES = " + json.dumps(stock_dates) + ";\n")
print(f"股价: {len(stock)} 条, 交易日 {len(stock_dates)} 天")

# 汇率: {date: rate}
rate = {}
with open(os.path.join(DATA, "hkd_rate.csv"), encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        rate[r["date"]] = r["rate"]
rate_dates = sorted(rate.keys())
with open(os.path.join(SRC, "hkd_rate.js"), "w", encoding="utf-8") as f:
    f.write("window.HKD_RATE = " + json.dumps(rate, separators=(",", ":")) + ";\n")
    f.write("window.RATE_DATES = " + json.dumps(rate_dates) + ";\n")
print(f"汇率: {len(rate)} 条, 交易日 {len(rate_dates)} 天")
