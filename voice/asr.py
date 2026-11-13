"""Offline speech recognition for short spoken orders (faster-whisper, CPU int8 by default).

The model downloads once to the Hugging Face cache (~280 MB for base.en); after that pass
local_files_only=True and nothing leaves the machine.
"""
import io
import time
import wave

import numpy as np

SR = 16000
# A short vocabulary prompt biases Whisper toward the order words. Keep it short: long prompts
# get echoed back on near-silence.
VOCAB_PROMPT = "Keep him out. Drive him out. Track him. Hold position. Rotate left. Rotate right."
# indoor (simulators/swarm-indoor): the goal words plus the fixed office floor's room and door names
INDOOR_PROMPT = ("Keep him out of the lab. Guide them out by the main entrance. Track him. Contain him in the kitchen. "
                 "Search the building. Map the floor. Watch the fire exit. Come back and land. Hold position.")


def wav_to_float32(data):
    """16-bit PCM WAV bytes -> mono float32 at 16 kHz."""
    with wave.open(io.BytesIO(data)) as w:
        sr, ch, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        frames = w.readframes(n)
    if width != 2:
        raise ValueError(f"expected 16-bit PCM, got {8 * width}-bit")
    x = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if sr != SR:
        t_old = np.arange(len(x)) / sr
        t_new = np.arange(int(len(x) * SR / sr)) / SR
        x = np.interp(t_new, t_old, x).astype(np.float32)
    return x


def float32_to_wav(x, sr=SR):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    return buf.getvalue()


class Transcriber:
    def __init__(self, model="base.en", device="cpu", compute_type="int8", threads=4,
                 local_files_only=False, min_seconds=0.3, min_rms=0.003):
        from faster_whisper import WhisperModel  # imported here so the parser works without it

        t = time.perf_counter()
        try:
            self.model = WhisperModel(model, device=device, compute_type=compute_type, cpu_threads=threads,
                                      local_files_only=True)
        except Exception:
            if local_files_only:
                raise
            self.model = WhisperModel(model, device=device, compute_type=compute_type, cpu_threads=threads)
        self.load_s = time.perf_counter() - t
        self.name = f"{model} ({device}, {compute_type})"
        self.min_seconds, self.min_rms = min_seconds, min_rms

    def _run(self, audio, prompt=None):
        segments, _ = self.model.transcribe(
            audio, language="en", beam_size=1, best_of=1, temperature=0.0, without_timestamps=True,
            condition_on_previous_text=False, initial_prompt=prompt or VOCAB_PROMPT, vad_filter=False)
        # segments is a lazy generator: consume it here, in the calling (worker) thread
        return " ".join(s.text.strip() for s in segments).strip()

    def warmup(self):
        t = np.arange(SR, dtype=np.float32) / SR
        self._run((0.05 * np.sin(2 * np.pi * 220 * t)).astype(np.float32))

    def transcribe(self, audio, prompt=None):
        """audio: float32 mono 16 kHz; prompt: vocabulary hint (default VOCAB_PROMPT). Returns {text, audio_s, rms, asr_ms, skipped}."""
        audio = np.asarray(audio, dtype=np.float32)
        dur = len(audio) / SR
        rms = float(np.sqrt(np.mean(audio ** 2))) if len(audio) else 0.0
        if dur < self.min_seconds:
            return {"text": "", "audio_s": dur, "rms": rms, "asr_ms": 0.0, "skipped": "too short"}
        if rms < self.min_rms:
            return {"text": "", "audio_s": dur, "rms": rms, "asr_ms": 0.0, "skipped": "silence"}
        t = time.perf_counter()
        text = self._run(audio, prompt)
        ms = (time.perf_counter() - t) * 1000
        if _echoes_prompt(text, prompt):  # Whisper sometimes repeats its prompt on noise
            return {"text": "", "audio_s": dur, "rms": rms, "asr_ms": ms, "skipped": "prompt echo"}
        return {"text": text, "audio_s": dur, "rms": rms, "asr_ms": ms, "skipped": None}


def _echoes_prompt(text, prompt=None):
    t = text.lower().strip(" .")
    return len(t) > 40 and t in (prompt or VOCAB_PROMPT).lower()
