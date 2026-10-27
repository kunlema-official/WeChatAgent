"""Offline smoke test for the exact portable voice runtime shipped in the Windows installer.

Generates a tiny synthetic WAV, runs the production WAV→SILK encoder and SILK→WAV
decoder, then validates the canonical 16 kHz mono PCM16 output. No API key, network
service, WeChat process, or microphone is required.
"""
import json
import math
import os
import pathlib
import struct
import subprocess
import sys
import tempfile
import wave

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENCODER = ROOT / "packages" / "dsh-voice-plugin" / "scripts" / "wav-to-silk.py"
DECODER = ROOT / "packages" / "dsh-voice-plugin" / "scripts" / "decode-wechat-voice.py"


def run(args, env, timeout=120):
    result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                            errors="replace", env=env, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(
            "command failed (%d): %s\nstdout:\n%s\nstderr:\n%s" %
            (result.returncode, args[0], result.stdout[-3000:], result.stderr[-3000:])
        )
    return result


def main():
    if not ENCODER.is_file() or not DECODER.is_file():
        raise RuntimeError("production voice conversion scripts are missing")
    with tempfile.TemporaryDirectory(prefix="wechatagent-voice-codec-") as folder:
        work = pathlib.Path(folder)
        source = work / "source.wav"
        silk = work / "roundtrip.silk"
        decoded = work / "decoded.wav"
        env = os.environ.copy()
        # Child scripts emit Chinese diagnostics; force UTF-8 for pipes on Windows runners.
        # Without this, the codec can succeed but its success log raises cp1252/charmap errors.
        env["PYTHONIOENCODING"] = "utf-8:replace"
        env["PYTHONUTF8"] = "1"
        env["WECHATAGENT_VOICE_TMP"] = str(work)

        rate = 24000
        frames = rate
        with wave.open(str(source), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            pcm = bytearray()
            for index in range(frames):
                sample = int(9000 * math.sin(2 * math.pi * 440 * index / rate))
                pcm.extend(struct.pack("<h", sample))
            wav.writeframes(pcm)

        run([sys.executable, str(ENCODER), "--in", str(source), "--out", str(silk)], env)
        if not silk.is_file() or not 100 <= silk.stat().st_size <= 4 * 1024 * 1024:
            raise RuntimeError("encoder output size is invalid")
        with silk.open("rb") as stream:
            if stream.read(9) != b"#!SILK_V3":
                raise RuntimeError("encoder output has no SILK v3 header")

        run([sys.executable, str(DECODER), "--in", str(silk), "--out", str(decoded)], env)
        if not decoded.is_file() or decoded.stat().st_size < 46:
            raise RuntimeError("decoder output WAV is missing or too small")
        with wave.open(str(decoded), "rb") as wav:
            actual = {
                "channels": wav.getnchannels(),
                "sampleWidth": wav.getsampwidth(),
                "sampleRate": wav.getframerate(),
                "durationSeconds": wav.getnframes() / float(wav.getframerate()),
            }
        if actual["channels"] != 1 or actual["sampleWidth"] != 2 or actual["sampleRate"] != 16000:
            raise RuntimeError("decoder did not produce canonical 16 kHz mono PCM16 WAV: %s" % actual)
        if not 0.75 <= actual["durationSeconds"] <= 1.25:
            raise RuntimeError("round-trip duration is outside tolerance: %s" % actual)
        print(json.dumps({
            "ok": True,
            "encoder": "wav-to-silk.py",
            "decoder": "decode-wechat-voice.py",
            "silkBytes": silk.stat().st_size,
            "decodedWavBytes": decoded.stat().st_size,
            **actual,
        }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("VOICE_CODEC_SMOKE_FAILED: %s: %s" % (type(error).__name__, error), file=sys.stderr)
        raise SystemExit(1)
