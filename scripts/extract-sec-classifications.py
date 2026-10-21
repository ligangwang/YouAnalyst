"""Read SEC's submissions.zip locally; never extract archive paths to disk."""
import json
import re
import sys
import zipfile
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        raise ValueError('Usage: python scripts/extract-sec-classifications.py submissions.zip output.json')
    rows = []
    with zipfile.ZipFile(sys.argv[1]) as archive:
        for item in archive.infolist():
            match = re.fullmatch(r'CIK(\d{10})\.json', item.filename)
            if not match:
                continue
            if item.file_size > 100_000_000:
                raise ValueError('Unexpectedly large SEC issuer file')
            row = json.loads(archive.read(item))
            if str(row.get('cik', '')).zfill(10) != match[1]:
                raise ValueError('SEC archive CIK mismatch')
            rows.append({key: row.get(key) for key in ('cik', 'sic', 'sicDescription', 'tickers')})
    if not rows:
        raise ValueError('Empty SEC submissions archive')
    with Path(sys.argv[2]).open('x', encoding='utf-8') as out:
        json.dump(rows, out, ensure_ascii=False)
    print(json.dumps({'issuers': len(rows), 'withSic': sum(bool(row['sic']) for row in rows)}))


if __name__ == '__main__':
    main()
