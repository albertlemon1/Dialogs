# Hotel check-in dialogue (UK) · B1–B2

35-line dialogue between a receptionist and a guest checking in at a London hotel,
with Spanish translations, vocabulary notes and two audio versions.

## Run
Static site, no build step:

    python3 -m http.server 8000     # then open http://localhost:8000

(GitHub Pages also works.)

## Version A · Kokoro-82M (offline TTS)
Audio is pre-generated and committed in `audio/a/<voice-set>/NN.mp3` (two voice sets:
Emma+George, Isabella+Lewis). There is no browser-voice fallback: a missing file shows an error.

Regenerate (only changed lines are redone):

    pip install kokoro-onnx soundfile        # + ffmpeg
    # download kokoro-v1.0.onnx and voices-v1.0.bin from
    # https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
    python tools/gen_kokoro.py --models /path/to/models

## Version B · ElevenLabs (generated from the app)
1. Switch to **Version B** → **⚙ ElevenLabs settings**.
2. Paste your API key, click **Load models & voices**, pick the model (default suggestion
   `eleven_turbo_v2_5`) and one voice per speaker.
3. (Recommended) enable **Commit each audio to the repo**, and paste a GitHub fine-grained token
   (*Contents: read & write* on this repo only; the dialog has step-by-step instructions).
4. **Generate missing audio**. Each file is stored in IndexedDB (persistent in the browser) and,
   if enabled, committed to `audio/b/<model>/<voice_id>/NN.mp3`. Runs are resumable and never
   regenerate a line that already exists.

Keys and tokens live only in your browser's `localStorage`; they are never written to the repo.
Run `git pull` to get audio committed from the app.
