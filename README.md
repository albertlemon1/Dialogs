# English travel dialogues · B1–B2

Short, realistic dialogues in British English with Spanish translations, vocabulary notes
and two audio versions. Live: https://albertlemon1.github.io/Dialogs/

| Scenario | Link | Lines | Speakers |
|---|---|---|---|
| Hotel check-in, London | `?s=hotel` | 35 | Receptionist, Guest |
| Airport: ticket desk + boarding gate, Heathrow → Madrid | `?s=airport` | 41 | Ticket agent, Passenger, Gate agent, Announcement |

## Run
Static site, no build step:

    python3 -m http.server 8000     # then open http://localhost:8000

## Structure
    data/scenarios.json          scenario list + Kokoro voice sets per scenario
    data/<scenario>.json         dialogue: speakers, scenes, lines (en / es / note)
    audio/<scenario>/a/...       Version A (Kokoro) mp3 + manifest.json
    audio/<scenario>/b/...       Version B (ElevenLabs) mp3 + config.json (model + voice per speaker)
    tools/gen_kokoro.py          Version A generator

To add a scenario: create `data/<id>.json`, add it to `data/scenarios.json` with its voice
sets, run the Kokoro script, then generate Version B from the app.

## Version A · Kokoro-82M (offline TTS)
Audio is pre-generated and committed. There is no browser-voice fallback: a missing file shows an error.
Regenerate (only changed lines are redone):

    pip install kokoro-onnx soundfile        # + ffmpeg
    # download kokoro-v1.0.onnx and voices-v1.0.bin from
    # https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
    python tools/gen_kokoro.py --models /path/to/models [--scenario airport]

## Version B · ElevenLabs (generated from the app)
1. Pick the scenario, switch to **Version B** → **⚙ ElevenLabs settings**.
2. Paste your API key, click **Load models & voices**, pick the model and one voice per speaker.
3. (Recommended) enable **Commit each audio to the repo** and paste a GitHub fine-grained token
   (*Contents: read & write* on this repo only; the dialog has step-by-step instructions).
4. **Generate missing audio**. Each file is stored in IndexedDB and, if enabled, committed to
   `audio/<scenario>/b/<model>/<voice_id>/NN.mp3`, together with `config.json`, so any browser
   can play it without a key. Runs are resumable and never regenerate an existing line.

Keys and tokens live only in your browser's `localStorage`; they are never written to the repo.
