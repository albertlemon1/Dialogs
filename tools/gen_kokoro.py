#!/usr/bin/env python3
"""Generate Version A audio (Kokoro-82M, offline) into audio/<scenario>/a/<voiceset>/NN.mp3.

Scenarios and their voice sets are defined in data/scenarios.json.

Setup:
  pip install kokoro-onnx soundfile   (ffmpeg must be installed)
  Download kokoro-v1.0.onnx and voices-v1.0.bin from
  https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

Usage:
  python tools/gen_kokoro.py --models /path/to/models [--scenario airport]
Only lines whose text/voice changed are regenerated (see audio/<scenario>/a/manifest.json).
"""
import argparse, hashlib, json, subprocess, tempfile
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True, help="dir with kokoro-v1.0.onnx and voices-v1.0.bin")
    ap.add_argument("--speed", type=float, default=0.95)
    ap.add_argument("--scenario", help="only this scenario id (default: all)")
    args = ap.parse_args()

    models = Path(args.models)
    kokoro = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
    index = json.loads((ROOT / "data" / "scenarios.json").read_text(encoding="utf-8"))
    for sc in index["scenarios"]:
        if args.scenario and sc["id"] != args.scenario:
            continue
        generate(kokoro, sc, args.speed)


def generate(kokoro, sc, speed):
    dialogue = json.loads((ROOT / "data" / f"{sc['id']}.json").read_text(encoding="utf-8"))
    out_root = ROOT / "audio" / sc["id"] / "a"
    out_root.mkdir(parents=True, exist_ok=True)
    manifest_path = out_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    for set_id, vs in sc["voice_sets"].items():
        (out_root / set_id).mkdir(exist_ok=True)
        for line in dialogue["lines"]:
            voice = vs["voices"][line["s"]]
            key = f"{set_id}/{line['id']:02d}"
            digest = hashlib.sha256(f"{voice}|{speed}|{line['en']}".encode()).hexdigest()[:16]
            mp3 = out_root / f"{key}.mp3"
            if mp3.exists() and manifest.get(key) == digest:
                continue
            samples, rate = kokoro.create(line["en"], voice=voice, speed=speed, lang="en-gb")
            with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
                sf.write(tmp.name, samples, rate)
                subprocess.run(
                    ["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name,
                     "-codec:a", "libmp3lame", "-qscale:a", "4", str(mp3)],
                    check=True,
                )
            manifest[key] = digest
            print("generated", sc["id"], key, voice)

    manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
