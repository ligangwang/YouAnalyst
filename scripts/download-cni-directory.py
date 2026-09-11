"""Download the newest official CNI snapshot, preserving its own taxonomy/date."""
import hashlib
import io
import json
import re
import sys
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urljoin
import openpyxl

INDEX = "https://www.cnindex.com.cn/zh_information/data_resource/fljg/"

def parse_rows(rows):
    rows = iter(rows)
    header = next(rows)
    if header[:3] != ("上市公司名称", "证券代码", "证券简称"):
        raise ValueError("Unexpected CNI columns")
    result = {}
    for row in rows:
        code = str(row[1] or "")
        if not re.fullmatch(r"[036]\d{5}", code):
            continue
        company_id = ("XSHG:" if code.startswith("6") else "XSHE:") + code
        if not row[0] or not all(row[3:11]):
            raise ValueError("Incomplete classification")
        value = {"id": company_id, "name": row[2] or row[0], "legalName": row[0],
                 "classification": [{"code": str(row[i]), "name": row[i+1]} for i in (3, 5, 7, 9)]}
        if company_id in result and result[company_id] != value:
            raise ValueError("Conflicting duplicate identity")
        result[company_id] = value
    if len(result) < 4000:
        raise ValueError("Incomplete source: fewer than 4000 A-share records")
    return list(result.values())

def main():
    html = urlopen(INDEX, timeout=45).read().decode("utf-8")
    links = re.findall(r"dataInfoRequestUrl\('([^']+\.xlsx)'\)", html)
    if not links:
        raise ValueError("No official classification file found")
    source = urljoin(INDEX, links[0])
    if not source.startswith(INDEX):
        raise ValueError("Unexpected download host/path")
    label = re.search(r"国证行业上市公司分类结果（(\d{4}-\d{1,2})）", html)
    if not label:
        raise ValueError("Missing snapshot date")
    data = urlopen(source, timeout=60).read()
    workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    companies = parse_rows(workbook.active.values)
    payload = {"source": source, "snapshot": label[1], "sha256": hashlib.sha256(data).hexdigest(), "companies": companies}
    Path(sys.argv[1]).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"snapshot": label[1], "companies": len(companies)}))

if __name__ == "__main__":
    main()
