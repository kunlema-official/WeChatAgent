"""Convert a MiMo TTS WAV response to the SILK v3 format expected by WeChat.

The input WAV is normalized with ffmpeg to 24 kHz, mono, signed PCM16. pilk.encode
expects 24 kHz PCM; this script checks duration and the resulting SILK header before
publishing the output file. It never invokes a shell and emits a final JSON line.
"""
import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time

PCM_RATE = 24000
PCM_WIDTH = 2
SILK_MAGIC = b'#!SILK_V3'
MAX_INPUT_BYTES = 32 * 1024 * 1024
MAX_DURATION_SECONDS = 180

class StageError(RuntimeError):
    def __init__(self, stage, message):
        super().__init__(message)
        self.stage = stage
        self.message = message


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        candidate = imageio_ffmpeg.get_ffmpeg_exe()
        if candidate and os.path.isfile(candidate):
            return candidate
    except Exception:
        pass
    raise StageError('ffmpeg', 'imageio-ffmpeg is unavailable; install voice requirements first')


def run(cmd, timeout=90):
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise StageError('ffmpeg', 'WAV normalization timed out')
    except Exception as exc:
        raise StageError('ffmpeg', 'Unable to run ffmpeg: %s' % type(exc).__name__)
    output = (result.stdout or b'') + (result.stderr or b'')
    return result.returncode, output.decode('utf-8', 'replace')


def wav_duration(path):
    try:
        import wave
        with wave.open(path, 'rb') as wav:
            channels = wav.getnchannels()
            rate = wav.getframerate()
            width = wav.getsampwidth()
            frames = wav.getnframes()
            if channels not in (1, 2) or rate < 8000 or rate > 96000 or width not in (1, 2, 3, 4):
                raise StageError('input', 'Unsupported WAV parameters')
            return frames / float(rate)
    except StageError:
        raise
    except Exception as exc:
        raise StageError('input', 'MiMo response is not a valid PCM WAV: %s' % type(exc).__name__)


def main():
    parser = argparse.ArgumentParser(description='WAV -> 24 kHz PCM16 -> WeChat SILK v3')
    parser.add_argument('--in', dest='input_wav', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    temp_dir = os.environ.get('WECHATAGENT_VOICE_TMP') or tempfile.gettempdir()
    os.makedirs(temp_dir, exist_ok=True)
    pcm_path = os.path.join(temp_dir, 'mimo-wav-%d-%s.pcm' % (os.getpid(), os.urandom(4).hex()))
    silk_path = os.path.join(temp_dir, 'mimo-wav-%d-%s.silk' % (os.getpid(), os.urandom(4).hex()))
    try:
        source = os.path.abspath(args.input_wav)
        output = os.path.abspath(args.out)
        if not os.path.isfile(source):
            raise StageError('input', 'Input WAV does not exist')
        source_size = os.path.getsize(source)
        if source_size < 46 or source_size > MAX_INPUT_BYTES:
            raise StageError('input', 'Input WAV size is outside the allowed range')
        with open(source, 'rb') as fp:
            head = fp.read(12)
        if head[:4] != b'RIFF' or head[8:12] != b'WAVE':
            raise StageError('input', 'MiMo response does not contain a RIFF/WAVE file')
        source_seconds = wav_duration(source)
        if source_seconds <= 0 or source_seconds > MAX_DURATION_SECONDS:
            raise StageError('input', 'Audio duration is outside the allowed range')
        ff = ffmpeg_exe()
        rc, log = run([ff, '-hide_banner', '-loglevel', 'error', '-i', source, '-vn',
                       '-ac', '1', '-ar', str(PCM_RATE), '-acodec', 'pcm_s16le',
                       '-f', 's16le', '-y', pcm_path], timeout=90)
        if rc != 0 or not os.path.isfile(pcm_path):
            raise StageError('ffmpeg', 'WAV to PCM conversion failed: %s' % log.strip()[:180])
        pcm_bytes = os.path.getsize(pcm_path)
        if pcm_bytes < PCM_RATE * PCM_WIDTH // 10 or pcm_bytes % PCM_WIDTH:
            raise StageError('ffmpeg', 'Normalized PCM is empty or malformed')
        pcm_seconds = pcm_bytes / float(PCM_RATE * PCM_WIDTH)
        if abs(pcm_seconds - source_seconds) / source_seconds > 0.15:
            raise StageError('ffmpeg', 'Normalized duration differs from source WAV')
        try:
            import pilk
        except Exception as exc:
            raise StageError('pilk', 'pilk is unavailable: %s' % type(exc).__name__)
        try:
            try:
                pilk.encode(pcm_path, silk_path, pcm_rate=PCM_RATE)
            except TypeError:
                pilk.encode(pcm_path, silk_path)
        except Exception as exc:
            raise StageError('pilk', 'SILK encoding failed: %s' % type(exc).__name__)
        if not os.path.isfile(silk_path) or os.path.getsize(silk_path) < 100:
            raise StageError('pilk', 'Encoder did not produce a valid SILK file')
        with open(silk_path, 'rb') as fp:
            if fp.read(9) != SILK_MAGIC:
                raise StageError('pilk', 'Encoder output is not SILK v3')
        try:
            duration_ms = int(pilk.get_duration(silk_path))
        except Exception as exc:
            raise StageError('pilk', 'Cannot read SILK duration: %s' % type(exc).__name__)
        if duration_ms <= 0 or abs(duration_ms / 1000.0 - source_seconds) / source_seconds > 0.25:
            raise StageError('pilk', 'SILK duration does not match the source WAV')
        os.makedirs(os.path.dirname(output), exist_ok=True)
        shutil.copyfile(silk_path, output)
        result = {'ok': True, 'silk': output, 'bytes': os.path.getsize(output),
                  'durationMs': duration_ms, 'sourceWavBytes': source_size,
                  'sourceDurationMs': int(source_seconds * 1000), 'pcmRate': PCM_RATE,
                  'elapsedSec': round(time.time() - start, 2)}
        print('JSON: ' + json.dumps(result, ensure_ascii=False))
        return 0
    except StageError as exc:
        print('失败: [%s] %s' % (exc.stage, exc.message), file=sys.stderr)
        print('JSON: ' + json.dumps({'ok': False, 'error': exc.message, 'stage': exc.stage}, ensure_ascii=False))
        return 1
    except Exception as exc:
        print('失败: %s' % type(exc).__name__, file=sys.stderr)
        print('JSON: ' + json.dumps({'ok': False, 'error': 'Unexpected conversion failure', 'stage': 'unknown'}, ensure_ascii=False))
        return 1
    finally:
        for item in (pcm_path, silk_path):
            try:
                if os.path.isfile(item):
                    os.unlink(item)
            except OSError:
                pass


if __name__ == '__main__':
    start = time.time()
    sys.exit(main())
