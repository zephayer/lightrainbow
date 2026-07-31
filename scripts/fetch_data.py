#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
总包计算器 - 数据抓取脚本
抓取美团(3690.HK)股价 + 人民币兑港元汇率，导出 CSV
运行: python3 fetch_data.py
输出: ../data/mt_stock.csv, ../data/hkd_rate.csv
"""
import os
import sys
import json
import csv
import urllib.request
import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_stock():
    """腾讯财经港股K线: 美团 3690.HK, 前复权, 1300 交易日(~5年)"""
    url = ("https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?"
           "_var=kline_dayqfq&param=hk03690,day,,,1300,qfq")
    raw = fetch(url)
    # 剥离 'kline_dayqfq=' 前缀
    json_str = raw.split("=", 1)[1]
    data = json.loads(json_str)
    day = data["data"]["hk03690"]["day"]
    # 格式: [日期, 开盘, 收盘, 最高, 最低, 成交量, ...]
    out = os.path.join(DATA_DIR, "mt_stock.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["date", "open", "close", "high", "low", "volume"])
        for r in day:
            w.writerow([r[0], r[1], r[2], r[3], r[4], r[5]])
    print(f"股价: {len(day)} 条 -> {out}")
    print(f"      首日: {day[0][0]}  末日: {day[-1][0]}  最新收盘: {day[-1][2]}")


def fetch_rate():
    """人行汇率中间价: 港币, 2005至今"""
    url = "https://wzdt.pbc.gov.cn/huilv/flex-xml/flex_xml_4.xml"
    raw = fetch(url)
    # 解析 XML: <date>日期</date><hlvalue>汇率</hlvalue>
    import re
    dates = re.findall(r"<date>([\d-]+)</date>", raw)
    hls = re.findall(r"<hlvalue>([\d.]+)</hlvalue>", raw)
    if len(dates) != len(hls):
        print(f"⚠️ 汇率数据不匹配: dates={len(dates)} hls={len(hls)}")
    out = os.path.join(DATA_DIR, "hkd_rate.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["date", "rate"])
        for d, h in zip(dates, hls):
            w.writerow([d, h])
    print(f"汇率: {len(dates)} 条 -> {out}")
    print(f"      首日: {dates[0]}  末日: {dates[-1]}  最新: {hls[-1]}")


if __name__ == "__main__":
    print("=== 美团股价 3690.HK ===")
    fetch_stock()
    print("\n=== 人民币兑港元中间价 ===")
    fetch_rate()
    print("\n完成！")
