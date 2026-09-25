"""Download the Stack Overflow Developer Survey 2025 results (141 MB) into python/data/raw/.

    python python/download.py

The survey is published by Stack Overflow under the Open Database License (ODbL 1.0):
https://survey.stackoverflow.co/ · official archive: https://github.com/StackExchange/Survey
"""
import pathlib
import urllib.request

BASE = "https://media.githubusercontent.com/media/StackExchange/Survey/main/packages/archive/2025"
RAW = pathlib.Path(__file__).parent / "data" / "raw"


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for name in ("results.csv", "schema.csv"):
        target = RAW / name.replace(".csv", "2025.csv")
        if target.exists():
            print(f"{target.name} already downloaded")
            continue
        print(f"downloading {name} …")
        urllib.request.urlretrieve(f"{BASE}/{name}", target)
        print(f"  {target.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
