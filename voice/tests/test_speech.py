"""End-to-end speech test without a microphone: macOS `say` voices -> WAV -> speech server -> decision.

Starts voice/server.py on a free port, sends each synthesized order exactly as the Swarm Mind page does,
and checks the decision. Skipped where `say` or the cached Whisper model is unavailable.

    voice/.venv/bin/python -m pytest voice/tests/test_speech.py -q -s
    SPEECH_FAST=1 ...   # 2 voices, clean only

The noisy condition adds synthetic rotor noise (blade-pass harmonics plus broadband noise) at 10 dB SNR,
an approximation until real drone ego-noise (DroneAudioSet, MIT) is downloaded. macOS voices are for
internal tests only and are never released as data.
"""
import base64
import json
import os
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import time

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE_DIR = os.path.dirname(HERE)
sys.path.insert(0, VOICE_DIR)
from asr import float32_to_wav, wav_to_float32  # noqa: E402

OUTSIDE = {"goal": "keepout", "version": 1, "intruder": {"alive": True, "seen": True, "inside": False, "state": "approach"}}
ORDERS = [
    ("keep him out of the building", "accept", "keepout"),
    ("don't let him in", "accept", "keepout"),
    ("block the main door", "accept", "keepout"),
    ("guard the warehouse", "accept", "keepout"),
    ("drive him out of the site", "accept", "driveout"),
    ("get him out of here", "accept", "driveout"),
    ("push him back toward the fence", "accept", "driveout"),
    ("chase him off the property", "accept", "driveout"),
    ("track him", "accept", "track"),
    ("follow that guy", "accept", "track"),
    ("keep an eye on him", "accept", "track"),
    ("don't lose him", "accept", "track"),
    ("hold position", "accept", "hold"),
    ("stay where you are", "accept", "hold"),
    ("stop following him", "accept", "hold"),
    ("freeze", "accept", "hold"),
    ("rotate the formation left", "accept", "L"),
    ("turn right", "accept", "R"),
    ("hit him", "refuse", "no-harm"),
    ("what is the weather like", "query", None),
]
FAST = bool(os.environ.get("SPEECH_FAST"))
VOICES = ["Daniel", "Samantha"] if FAST else ["Daniel", "Samantha", "Karen", "Rishi"]
CONDITIONS = ["clean"] if FAST else ["clean", "rotor 10 dB"]


def have_model():
    hub = os.path.expanduser("~/.cache/huggingface/hub/models--Systran--faster-whisper-base.en")
    return os.path.isdir(hub)


pytestmark = pytest.mark.skipif(shutil.which("say") is None or not have_model(),
                                reason="needs macOS `say` and the cached faster-whisper base.en model")


def synth(text, voice, tmp):
    path = os.path.join(tmp, "x.wav")
    subprocess.run(["say", "-v", voice, "--file-format=WAVE", "--data-format=LEI16@16000", "-o", path, text], check=True)
    with open(path, "rb") as f:
        return f.read()


def rotor_noise(n, seed=0, sr=16000):
    rng = np.random.default_rng(seed)
    t = np.arange(n) / sr
    f0 = 165.0 * (1 + 0.02 * np.sin(2 * np.pi * 0.7 * t))  # blade-pass frequency with a slow wobble
    hum = sum(np.sin(2 * np.pi * k * np.cumsum(f0) / sr + rng.uniform(0, 6.28)) / k for k in range(1, 11))
    white = rng.standard_normal(n)
    broad = np.zeros(n)
    a = 0.85
    for i in range(1, n):  # one-pole low-pass for a darker broadband component
        broad[i] = a * broad[i - 1] + (1 - a) * white[i]
    broad /= np.std(broad) + 1e-9
    noise = hum / np.std(hum) + 0.7 * broad
    return (noise / np.std(noise)).astype(np.float32)


def add_noise(wav, snr_db, seed):
    x = wav_to_float32(wav)
    voiced = x[np.abs(x) > 0.02]
    s_rms = float(np.sqrt(np.mean(voiced ** 2))) if len(voiced) else float(np.sqrt(np.mean(x ** 2)))
    noise = rotor_noise(len(x), seed) * s_rms / (10 ** (snr_db / 20))
    return float32_to_wav(np.clip(x + noise, -1, 1))


@pytest.fixture(scope="module")
def server():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen([sys.executable, os.path.join(VOICE_DIR, "server.py"), "--port", str(port), "--offline"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    t0 = time.time()
    while time.time() - t0 < 180:
        line = proc.stdout.readline()
        if "ready" in line:
            break
        if proc.poll() is not None:
            raise RuntimeError("speech server exited: " + line)
    yield port
    proc.terminate()
    proc.wait(timeout=10)


def ask(port, payload):
    from websockets.sync.client import connect
    with connect(f"ws://127.0.0.1:{port}", max_size=8 * 1024 * 1024) as ws:
        t = time.perf_counter()
        ws.send(json.dumps(payload))
        reply = json.loads(ws.recv(timeout=30))
        reply["roundtrip_ms"] = (time.perf_counter() - t) * 1000
        return reply


def test_spoken_orders_parse_correctly(server):
    rows, ok, asr_ms, rt_ms = [], 0, [], []
    with tempfile.TemporaryDirectory() as tmp:
        for voice in VOICES:
            for k, (text, action, expect) in enumerate(ORDERS):
                clean = synth(text, voice, tmp)
                for cond in CONDITIONS:
                    wav = clean if cond == "clean" else add_noise(clean, 10, seed=k)
                    d = ask(server, {"type": "order_audio", "id": k, "context": OUTSIDE,
                                     "wav_b64": base64.b64encode(wav).decode()})
                    got = d.get("goal") or d.get("turn") or d.get("rule")
                    hit = d["action"] == action and (expect is None or got == expect)
                    ok += hit
                    asr_ms.append(d["timings"]["asr_ms"])
                    rt_ms.append(d["roundtrip_ms"])
                    if not hit:
                        rows.append(f"  miss [{voice}, {cond}] {text!r} heard {d['transcript']!r} -> {d['action']}/{got}")
    n = len(VOICES) * len(ORDERS) * len(CONDITIONS)
    print(f"\nspoken orders correct: {ok}/{n} ({ok / n:.0%}); voices {', '.join(VOICES)}; conditions {', '.join(CONDITIONS)}")
    print(f"recognition median {statistics.median(asr_ms):.0f} ms (p90 {np.percentile(asr_ms, 90):.0f}); "
          f"end of audio to decision median {statistics.median(rt_ms):.0f} ms (p90 {np.percentile(rt_ms, 90):.0f})")
    print("\n".join(rows))
    assert ok / n >= 0.9


def test_silence_changes_nothing(server):
    silence = float32_to_wav(np.zeros(16000, dtype=np.float32))
    d = ask(server, {"type": "order_audio", "id": 1, "context": OUTSIDE, "wav_b64": base64.b64encode(silence).decode()})
    assert d["action"] == "ignore" and d.get("skipped") == "silence"


def test_typed_orders_use_the_same_path(server):
    d = ask(server, {"type": "order_text", "id": 2, "text": "drive him out", "context": OUTSIDE})
    assert d["action"] == "accept" and d["goal"] == "driveout" and d["source"] == "typed"
    d = ask(server, {"type": "order_text", "id": 3, "text": "rotate left", "context": OUTSIDE})
    assert d["cmd"] == "L", "turns carry cmd so Prat's original Live handler understands them"
