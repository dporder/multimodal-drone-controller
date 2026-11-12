"""Speech server for Swarm Mind: push-to-talk audio or typed text in, a swarm order out.

    voice/.venv/bin/python voice/server.py            # ws://localhost:8765, the address Swarm Mind's Live link uses
    python main.py --voice                            # starts this server and the simulator together

Protocol (JSON text frames, one reply per request, sent only to the client that asked):
  page -> server  {"type":"hello", "sim":"swarm-mind"}
                  {"type":"order_audio", "id":n, "wav_b64":"<16-bit PCM WAV>", "context":{...}}
                  {"type":"order_text",  "id":n, "text":"drive him out", "context":{...}}
  server -> page  {"type":"hello", "asr":"base.en (cpu, int8)"}
                  {"type":"decision", "id":n, "source":"speech"|"typed", "transcript":"...",
                   "action":"accept"|"query"|"refuse"|"ignore", "goal"|"turn"|"queued"|"rule", "reply":"...",
                   "timings":{"audio_s", "asr_ms", "parse_ms", "server_ms"}, "cmd":"L"|"R" (turns only)}

The "cmd" field on turn decisions is what Prat's original Live handler understands, so even an
unmodified Swarm Mind page receives formation turns. Everything runs on this machine: the
socket binds to localhost only and the speech model is local. Transcripts and decisions (not audio,
unless --save-audio) are appended to output/voice/log.jsonl.
"""
import argparse
import asyncio
import base64
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import websockets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asr import Transcriber, wav_to_float32  # noqa: E402
from orders import GOALS, interpret  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Server:
    def __init__(self, asr, log_dir, save_audio=False):
        self.asr = asr
        self.pool = ThreadPoolExecutor(max_workers=1)  # one transcription at a time, off the event loop
        self.log_dir = log_dir
        self.save_audio = save_audio
        os.makedirs(log_dir, exist_ok=True)

    def log(self, rec, wav=None):
        if wav is not None and self.save_audio:
            name = time.strftime("%Y%m%d-%H%M%S") + f"-{rec.get('id')}.wav"
            with open(os.path.join(self.log_dir, name), "wb") as f:
                f.write(wav)
            rec["audio_file"] = name
        with open(os.path.join(self.log_dir, "log.jsonl"), "a") as f:
            f.write(json.dumps(rec) + "\n")

    async def decide(self, msg, queued):
        t0 = time.perf_counter()
        wav = None
        if msg.get("type") == "order_audio":
            wav = base64.b64decode(msg.get("wav_b64", ""))
            audio = wav_to_float32(wav)
            res = await asyncio.get_running_loop().run_in_executor(self.pool, self.asr.transcribe, audio)
            text, source = res["text"], "speech"
        else:
            res = {"audio_s": 0.0, "asr_ms": 0.0, "skipped": None}
            text, source = str(msg.get("text", "")), "typed"
        t1 = time.perf_counter()
        d = interpret(text, msg.get("context"))
        if d["action"] == "next":
            d = ({"action": "accept", "goal": queued[0], "reply": GOALS[queued[0]] + "."} if queued[0]
                 else {"action": "query", "reply": "Nothing is queued. Say the next order."})
            queued[0] = None
        elif d["action"] == "accept" and d.get("goal"):
            queued[0] = d.get("queued")
        t2 = time.perf_counter()
        out = {"type": "decision", "id": msg.get("id"), "source": source, "transcript": text, **d,
               "timings": {"audio_s": round(res.get("audio_s", 0.0), 2), "asr_ms": round(res.get("asr_ms", 0.0)),
                           "parse_ms": round((t2 - t1) * 1000, 2), "server_ms": round((t2 - t0) * 1000)}}
        if res.get("skipped"):
            out["skipped"] = res["skipped"]
        if d.get("turn"):
            out["cmd"] = d["turn"]
        self.log({"t": time.time(), "id": msg.get("id"), "source": source, "transcript": text,
                  "decision": {k: v for k, v in d.items() if k not in ("normalized", "clauses")},
                  "context": msg.get("context"), "timings": out["timings"]}, wav)
        return out

    async def handler(self, ws):
        queued = [None]  # per-connection queue for compound orders ("X, then Y")
        async for raw in ws:
            if isinstance(raw, bytes):
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            kind = msg.get("type")
            if kind == "hello":
                await ws.send(json.dumps({"type": "hello", "asr": self.asr.name}))
            elif kind in ("order_audio", "order_text"):
                try:
                    await ws.send(json.dumps(await self.decide(msg, queued)))
                except Exception as err:  # a bad frame must not kill the link
                    await ws.send(json.dumps({"type": "decision", "id": msg.get("id"), "action": "query",
                                              "reply": "I couldn't process that order.", "error": str(err)}))


async def main_async(args):
    print(f"Loading speech model {args.model} on {args.device} …", flush=True)
    asr = Transcriber(args.model, device=args.device, compute_type=args.compute_type, threads=args.threads,
                      local_files_only=args.offline)
    asr.warmup()
    srv = Server(asr, os.path.join(ROOT, "output", "voice"), save_audio=args.save_audio)
    async with websockets.serve(srv.handler, "localhost", args.port, max_size=8 * 1024 * 1024):  # local only (IPv4 and IPv6)
        print(f"Speech server ready on ws://localhost:{args.port} ({asr.name}, loaded in {asr.load_s:.1f} s). Ctrl-C stops.",
              flush=True)
        await asyncio.Future()


def main():
    p = argparse.ArgumentParser(description="Offline speech server for Swarm Mind orders")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--model", default="base.en", help="faster-whisper model name (tiny.en, base.en, small.en, …)")
    p.add_argument("--device", default="cpu", help="cpu (default), or mps for the experimental Apple GPU backend")
    p.add_argument("--compute-type", default="int8")
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--offline", action="store_true", help="never download; fail if the model is not cached")
    p.add_argument("--save-audio", action="store_true", help="also keep each utterance as a WAV in output/voice/")
    args = p.parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
