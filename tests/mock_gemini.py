#!/usr/bin/env python3
"""A stand-in for the Gemini API, for local tests of the offer check.

    python3 tests/mock_gemini.py      # listens on 127.0.0.1:9997
    # .env: GEMINI_API_KEY=mock  GEMINI_ENDPOINT=http://127.0.0.1:9997/gemini/v1beta/models
"""
import http.server, json, re

CALLS = []

SAMPLE = {
    "currency": "INR", "fixed": 1140000, "variable": 114000, "stock": 0, "benefits": 69000, "joining": 100000,
    "statedTotal": 1323000, "role": "Software Engineer I", "company": "Northwind Labs", "location": "Bengaluru",
    "flags": [
        "The joining bonus must be repaid if you leave within 12 months.",
        "The ESOP grant has no stated value or strike price. Ask for both.",
        "A 60-day notice period can delay future moves.",
    ],
    "talkingPoints": [
        "Anchor on fixed pay: ask for ₹12.5 lakh fixed, citing the market median for your profile.",
        "Ask how much of the 10% performance bonus was actually paid out last year.",
        "Request the ESOP strike price, the company's latest valuation and the exercise window.",
        "If fixed pay can't move, ask for a salary review after six months in writing.",
    ],
    "email": "Hi Priya,\n\nThank you for the offer. I'm excited about the role at Northwind Labs.\n\nBased on the market data for my experience and skills, I'd like to ask whether the fixed pay could be ₹12,50,000. I'd also appreciate the ESOP strike price and valuation so I can understand the full package.\n\nIf fixed pay can't change, a written salary review after six months would help.\n\nThanks again, and I look forward to hearing from you.\n\nBest,\nNishant",
}


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/calls":
            return self.send(200, CALLS)
        self.send(404, {})

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("content-length", 0)))
        if self.path == "/reset":
            CALLS.clear()
            return self.send(200, {"ok": True})
        m = re.match(r"^/gemini/v1beta/models/([^:]+):generateContent$", self.path)
        if not m:
            return self.send(404, {"error": {"message": "no mock"}})
        body = json.loads(raw)
        parts = body["contents"][0]["parts"]
        prompt = parts[-1]["text"]
        has_file = any("inlineData" in p for p in parts)
        CALLS.append({"model": m.group(1), "prompt": prompt[:400], "file": has_file})
        if "Northwind" in prompt or has_file:
            out = SAMPLE
        else:
            nums = [float(x.replace(",", "")) for x in re.findall(r"(?:USD|\$)\s?([\d,]+)", prompt)]
            out = {**SAMPLE, "currency": "USD", "fixed": nums[0] if nums else 0, "variable": 0, "benefits": 0, "joining": 0, "statedTotal": 0, "company": "", "location": ""}
        self.send(200, {"candidates": [{"content": {"parts": [{"text": json.dumps(out, ensure_ascii=False)}]}, "finishReason": "STOP"}]})


if __name__ == "__main__":
    print("mock Gemini on http://127.0.0.1:9997")
    http.server.ThreadingHTTPServer(("127.0.0.1", 9997), H).serve_forever()
