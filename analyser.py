"""
Media Analyser - NudeNet + FFmpeg
Verarbeitet Bilder und Videos in einem Ordner und speichert Labels als JSON.

Voraussetzungen:
  pip install nudenet
  FFmpeg im PATH oder Pfad in FFMPEG_PATH anpassen

Aufruf:
  python analyser.py --input "P:\MeinOrdner" --output "P:\ergebnisse.json"

Optionen:
  --fps       Frames pro Sekunde aus Videos (Standard: 1)
  --conf      Minimale Konfidenz (Standard: 0.3)
  --ffmpeg    Pfad zu ffmpeg.exe
  --resume    Bereits verarbeitete Dateien überspringen (aus vorhandener JSON)
"""

import os
import sys
import json
import argparse
import subprocess
import tempfile
import shutil
import time
from pathlib import Path

try:
    from nudenet import NudeDetector
except ImportError:
    print("FEHLER: nudenet nicht installiert. Führe aus: pip install nudenet")
    sys.exit(1)

# Windows-Konsole auf UTF-8
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Standard-Konfiguration ────────────────────────────────────────────────────

DEFAULT_FFMPEG    = r"C:\ffmpeg\bin\ffmpeg.exe"
DEFAULT_FPS       = 1
DEFAULT_MIN_CONF  = 0.3

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm"}

# ─────────────────────────────────────────────────────────────────────────────


def make_detector():
    return NudeDetector()


def analyse_image(detector, image_path: str, min_conf: float) -> list[dict]:
    """Analysiert ein einzelnes Bild, gibt gefilterte Labels zurück."""
    try:
        results = detector.detect(image_path)
        return [
            {
                "class": r["class"],
                "score": round(float(r["score"]), 4),
                # NudeNet box: [x, y, w, h] in pixel — keep as-is
                "box":   [round(v) for v in r["box"]],
            }
            for r in results
            if float(r["score"]) >= min_conf
        ]
    except Exception as e:
        return [{"error": str(e)}]


def extract_frames(ffmpeg_path: str, video_path: str, output_dir: str, fps: float) -> bool:
    """Extrahiert Frames aus einem Video mit FFmpeg."""
    if not os.path.isfile(ffmpeg_path):
        print(f"  ⚠ FFmpeg nicht gefunden: {ffmpeg_path}")
        print("     → Pfad mit --ffmpeg angeben oder in PATH legen.")
        return False
    cmd = [
        ffmpeg_path,
        "-i", video_path,
        "-vf", f"fps={fps}",
        "-q:v", "2",
        "-start_number", "0",
        os.path.join(output_dir, "frame_%06d.jpg"),
        "-hide_banner", "-loglevel", "error",
    ]
    try:
        subprocess.run(cmd, check=True, timeout=600)
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ⚠ FFmpeg Fehler: {e}")
        return False
    except subprocess.TimeoutExpired:
        print("  ⚠ FFmpeg Timeout nach 10 Minuten")
        return False


def analyse_video(detector, video_path: str, ffmpeg_path: str,
                  fps: float, min_conf: float) -> dict:
    """Extrahiert Frames und analysiert sie. Gibt strukturierte Ergebnisse zurück."""
    temp_dir = tempfile.mkdtemp(prefix="analyser_frames_")
    t0 = time.time()
    try:
        print(f"  → Extrahiere Frames ({fps} fps)…")
        if not extract_frames(ffmpeg_path, video_path, temp_dir, fps):
            return {"error": "FFmpeg fehlgeschlagen", "frames": [], "top_labels": []}

        frame_files = sorted(Path(temp_dir).glob("frame_*.jpg"))
        print(f"  → {len(frame_files)} Frames extrahiert, analysiere…")

        frames_results = []
        class_max: dict[str, float] = {}

        for i, frame_path in enumerate(frame_files):
            # timestamp: frame index / fps  (frame_000000.jpg = t=0s)
            timestamp_sec = round(i / fps, 3)

            labels = analyse_image(detector, str(frame_path), min_conf)
            if labels and not any("error" in l for l in labels):
                frames_results.append({
                    "frame":         i,
                    "timestamp_sec": timestamp_sec,
                    "labels":        labels,
                })
                for lbl in labels:
                    cls = lbl["class"]
                    score = lbl["score"]
                    if cls not in class_max or class_max[cls] < score:
                        class_max[cls] = score

            # Progress every 25 frames
            if (i + 1) % 25 == 0:
                elapsed = time.time() - t0
                print(f"     {i+1}/{len(frame_files)} Frames ({elapsed:.0f}s)")

        top_labels = [
            {"class": cls, "max_score": round(score, 4)}
            for cls, score in sorted(class_max.items(), key=lambda x: -x[1])
        ]

        return {
            "total_frames_analysed": len(frame_files),
            "fps_used":              fps,
            "top_labels":            top_labels,
            # frames only contains entries where detections were found
            "frames":                frames_results,
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def analyse_folder(args):
    """Geht durch den Eingabe-Ordner und analysiert alle Medien-Dateien."""
    input_path  = Path(args.input)
    output_json = args.output
    min_conf    = args.conf
    fps         = args.fps
    ffmpeg_path = args.ffmpeg

    if not input_path.exists():
        print(f"FEHLER: Ordner nicht gefunden: {args.input}")
        return

    all_files = [
        f for f in input_path.rglob("*")
        if f.suffix.lower() in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
    ]
    if not all_files:
        print(f"WARNUNG: Keine Bild-/Video-Dateien in: {args.input}")
        return

    print(f"\n>> {len(all_files)} Dateien gefunden\n")

    # Resume: lade vorhandene Ergebnisse
    results: list[dict] = []
    done_paths: set[str] = set()
    if args.resume and os.path.isfile(output_json):
        with open(output_json, "r", encoding="utf-8") as f:
            try:
                results = json.load(f)
                done_paths = {r["file"] for r in results}
                print(f">> Resume: {len(done_paths)} Dateien bereits verarbeitet.\n")
            except Exception:
                pass

    detector = make_detector()

    for idx, file_path in enumerate(all_files, 1):
        file_str = str(file_path)
        if file_str in done_paths:
            print(f"[{idx}/{len(all_files)}] SKIP {file_path.name}")
            continue

        ext      = file_path.suffix.lower()
        is_video = ext in VIDEO_EXTENSIONS
        ftype    = "video" if is_video else "image"

        print(f"[{idx}/{len(all_files)}] {file_path.name}  ({ftype})")

        entry = {
            "file":      file_str,
            "filename":  file_path.name,
            "type":      ftype,
            "extension": ext,
        }

        if is_video:
            entry["analysis"] = analyse_video(
                detector, file_str, ffmpeg_path, fps, min_conf)
        else:
            labels = analyse_image(detector, file_str, min_conf)
            entry["analysis"] = {
                "labels": labels,
                "top_labels": [
                    {"class": l["class"], "score": l["score"]}
                    for l in sorted(labels, key=lambda x: -x.get("score", 0))
                    if "error" not in l
                ],
            }

        results.append(entry)

        # Nach jeder Datei zwischenspeichern
        with open(output_json, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n✓ FERTIG  →  {output_json}")
    print(f"  {len(results)} Dateien verarbeitet.")


# ── Hauptprogramm ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Media Analyser – NudeNet + FFmpeg",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--input",  "-i", required=True, help="Ordner mit Bildern/Videos")
    parser.add_argument("--output", "-o", default="ergebnisse.json", help="Ausgabe-JSON")
    parser.add_argument("--fps",    "-f", type=float, default=DEFAULT_FPS,    help="Frames/Sekunde aus Videos")
    parser.add_argument("--conf",   "-c", type=float, default=DEFAULT_MIN_CONF, help="Minimale Konfidenz [0–1]")
    parser.add_argument("--ffmpeg",       default=DEFAULT_FFMPEG, help="Pfad zu ffmpeg.exe")
    parser.add_argument("--resume",       action="store_true",    help="Bereits verarbeitete Dateien überspringen")
    args = parser.parse_args()
    analyse_folder(args)