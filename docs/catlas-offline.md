# Catlas offline demonstration

Extract the complete zip. Python 3.9 or newer is the only launcher dependency; no Node, npm, installation or internet is needed by the recipient.

From the extracted `catlas-offline` directory:

```sh
python3 serve.py
```

On Windows, `py -3 serve.py` is equivalent. Open **http://127.0.0.1:4178/** in current desktop Chrome or Edge. Stop with Ctrl+C. Do not open `dist/index.html` as a file URL. The launcher binds only to loopback and serves bundled static files; the receiver is simulated entirely in the browser.

Always use that same hostname and port. Changing to localhost, changing port (`--port`), another browser/profile, or the hosted Cloudflare address creates a separate IndexedDB history. Reload opens world discovery; resume exact snapshots from Retained evaluation history. Clear event selection preserves history. Reset demo data explicitly clears evaluations, packets and simulated receiver records; it does not alter packaged source evidence or its capture metadata.

`dist/PRESENTER.md` describes all five walkthroughs. `dist/CREDITS.txt`, `dist/THIRD_PARTY_NOTICES.md`, and `dist/evidence/capture-manifest.json` retain source credits, redistributed license texts and genuine evidence metadata. `release-manifest.json` gives measured file digests and packaging time, separately from the original capture times. ZIP entry timestamps are normalized container metadata, not capture times.

Core analysis, maps, review, downloads, retention and simulated delivery work without external networking. No satellite layer, real RAS service, financial approval/payment or customer validation is claimed. Browser storage must be enabled; private browsing/storage policies can limit retention.
# Portfolio exposure investigation

The extracted distribution also includes `exposure.html`. Follow **Exposure investigation** from the recovery page, or open `http://127.0.0.1:4178/exposure.html`. Frozen Ridgecrest investigation, local portfolio import, saved versions and complete case-bundle reopen work without external networking. Live earthquake discovery and new USGS evidence capture require connectivity. Case downloads contain the supplied insured-location portfolio; hosted and offline histories are separate. Read `dist/EXPOSURE.md` for the workflow and limits.
