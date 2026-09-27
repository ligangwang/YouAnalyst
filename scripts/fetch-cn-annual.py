"""Read annual consolidated income statements; stdout is JSON only, no DB writes."""
import contextlib
import json
import re
import sys

import requests


def main():
    symbol = sys.argv[1] if len(sys.argv) == 2 else ""
    if not re.fullmatch(r"(?:SH6|SZ[03])\d{5}", symbol):
        raise ValueError("Expected an A-share symbol such as SZ301308")
    original_request = requests.sessions.Session.request

    def bounded_request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", (10, 20))
        return original_request(self, method, url, **kwargs)

    requests.sessions.Session.request = bounded_request
    with contextlib.redirect_stdout(sys.stderr):
        import akshare as ak
        frame = ak.stock_profit_sheet_by_yearly_em(symbol=symbol)
    fields = ["SECUCODE", "SECURITY_CODE", "REPORT_DATE", "REPORT_TYPE", "NOTICE_DATE",
              "UPDATE_DATE", "CURRENCY", "OPERATE_INCOME", "PARENT_NETPROFIT"]
    rows = json.loads(frame[[key for key in fields if key in frame.columns]].to_json(orient="records", date_format="iso"))
    print(json.dumps({"symbol": symbol, "provider": "AKShare/Eastmoney", "rows": rows}, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
