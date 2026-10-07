#!/usr/bin/env python3
"""Generate the P2 golden regression fixture for chat history.

Runs against hermes-agent's REAL SessionDB and drives REAL compaction:

  * in-place compaction   -> SessionDB.archive_and_compact()   (compacted rows +
                            duplicate generations from the carried tail)
  * compression rotation  -> SessionDB.publish_compression_child()  (a genuine
                            parent -> child lineage, parent end_reason='compression')

Nothing about compaction/lineage is mocked. The script then records, from the
same real code the gateway uses, both:

  * the canonical display sequence  (get_messages(include_compacted=True,
    include_ancestors=True) -- the display-parity reference), and
  * the CURRENT server page a client gets today (no cursor, no displayId).

The recorded JSON is the input to the JS contract tests in
``src/services/history-cursor.test.mjs``. Those tests assert the LOCKED P2
contract, so they fail until the server implements it.

Run (see scripts/README.md for the exact interpreter):

  HERMES_HOME=~/.hermes PYTHONPATH=<hermes-agent>:<runtime-site-packages> \
    <hermes-runtime-python> scripts/p2-golden-fixture.py

Output: src/services/__fixtures__/p2-golden.json
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

REPO = Path(os.environ.get("HERMES_AGENT_REPO", str(Path.home() / ".hermes/hermes-agent")))
sys.path.insert(0, str(REPO))

from hermes_state import SessionDB  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "src" / "services" / "__fixtures__" / "p2-golden.json"

MODEL_ONLY_KEY = "model_only"  # agent.context_compressor.MODEL_ONLY_DISPLAY_METADATA_KEY
ROOT_ID = "golden-root"
CHILD_ID = "golden-child"
PAIRS = 1100  # 2 200 rows -> >2000 display messages


def build(db: SessionDB) -> None:
    db.create_session(ROOT_ID, source="desktop", profile_name="default")
    ts = 1_700_000_000.0
    n = 0
    for i in range(1, PAIRS + 1):
        ts += 1
        db.append_message(ROOT_ID, "user", f"prompt #{i:04d}", timestamp=ts)
        ts += 1
        db.append_message(ROOT_ID, "assistant", f"reply #{i:04d}", timestamp=ts)
        n += 2
        if i % 200 == 0:
            ts += 1
            db.append_message(ROOT_ID, "user", f"hidden note {i}", timestamp=ts, display_kind="hidden")
            ts += 1
            db.append_message(
                ROOT_ID, "assistant", f"model-only {i}", timestamp=ts,
                display_metadata={MODEL_ONLY_KEY: True})
            n += 2

    # Real in-place compaction #1: archives the active rows (compacted=1) and
    # re-inserts a summary + a verbatim carried tail (the caller names the tail
    # in `compacted_messages`, same shape the parity test's `_compact_in_place`
    # uses) -> compacted rows + a carried generation.
    live = db.get_messages_as_conversation(ROOT_ID)
    db.archive_and_compact(ROOT_ID, [{"role": "user", "content": "[summary 1]"}] + live[-40:], tail_count=40)

    # More turns after the first compaction, then a second one.
    for i in range(PAIRS + 1, PAIRS + 101):
        ts += 1
        db.append_message(ROOT_ID, "user", f"prompt #{i:04d}", timestamp=ts)
        ts += 1
        db.append_message(ROOT_ID, "assistant", f"reply #{i:04d}", timestamp=ts)
    live = db.get_messages_as_conversation(ROOT_ID)
    db.archive_and_compact(ROOT_ID, [{"role": "user", "content": "[summary 2]"}] + live[-30:], tail_count=30)

    # Real compression rotation: close the root and publish a durable child.
    # `watermark` makes the child clone the parent's concurrent tail (rows with
    # id > watermark), while the parent keeps its originals -> genuine duplicate
    # generations across the lineage, which the display read must collapse.
    active_ids = [
        r["id"]
        for r in db._read_all(
            "SELECT id FROM messages WHERE session_id = ? AND active = 1 ORDER BY id", (ROOT_ID,))
    ]
    watermark = (active_ids[-60] - 1) if len(active_ids) >= 60 else 0
    db.publish_compression_child(
        parent_session_id=ROOT_ID,
        child_session_id=CHILD_ID,
        source="desktop",
        profile_name="default",
        messages=[{"role": "user", "content": "[summary 3]"}],
        require_compression_lease=False,
        watermark=watermark,
    )
    for i in range(PAIRS + 101, PAIRS + 151):
        ts += 1
        db.append_message(CHILD_ID, "user", f"post-rotation #{i:04d}", timestamp=ts)
        ts += 1
        db.append_message(CHILD_ID, "assistant", f"post-rotation reply #{i:04d}", timestamp=ts)


def _hex(blob) -> str | None:
    return bytes(blob).hex() if isinstance(blob, (bytes, bytearray)) else None


def export(db: SessionDB) -> dict:
    resolved = db.resolve_resume_session_id(ROOT_ID)
    lineage = db._resume_lineage_ids(resolved)

    # Canonical display sequence, from the real display read the parity tests use.
    canonical = db.get_messages(resolved, include_compacted=True, include_ancestors=True)

    # Raw row metadata for identity/dedup assertions.
    ph = ",".join("?" for _ in lineage)
    raw_rows = db._read_all(
        "SELECT id, session_id, display_order, display_identity, message_uid, role, "
        "active, compacted, display_kind, display_metadata FROM messages "
        f"WHERE session_id IN ({ph}) ORDER BY id",
        tuple(lineage),
    )
    raw = [
        {
            "id": r["id"],
            "sessionId": r["session_id"],
            "displayOrder": r["display_order"],
            "displayIdentity": _hex(r["display_identity"]),
            "messageUid": r["message_uid"],
            "role": r["role"],
            "active": bool(r["active"]),
            "compacted": bool(r["compacted"]),
            "displayKind": r["display_kind"],
            "modelOnly": bool(
                json.loads(r["display_metadata"]).get(MODEL_ONLY_KEY)
                if r["display_metadata"]
                else False
            ),
        }
        for r in raw_rows
    ]

    # The page a client gets TODAY: active-only, no include_compacted, no cursor.
    current = db.get_messages(resolved, limit=50, offset=0, latest=True, include_ancestors=True)

    return {
        "generatedBy": "scripts/p2-golden-fixture.py",
        "session": {"root": ROOT_ID, "resolved": resolved, "lineage": lineage},
        "counts": {
            "canonicalDisplay": len(canonical),
            "rawRows": len(raw),
        },
        "canonical": [
            {
                "id": m.get("id"),
                "messageUid": m.get("message_uid"),
                "role": m.get("role"),
                "content": m.get("content"),
                "active": bool(m.get("active")),
                "compacted": bool(m.get("compacted")),
                "displayKind": m.get("display_kind"),
            }
            for m in canonical
        ],
        "rawRows": raw,
        # Shape of the current (pre-P2) server page: no nextCursor / prevCursor /
        # hasMore / displayId. The contract tests assert those exist.
        "currentServerPage": {
            "messages": [
                {
                    "id": m.get("id"),
                    "role": m.get("role"),
                    "content": m.get("content"),
                    "message_uid": m.get("message_uid"),
                }
                for m in current
            ],
            "pagination": {"limit": 50, "offset": 0, "order": "latest", "returned": len(current)},
        },
    }


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="p2-golden-") as tmp:
        db = SessionDB(Path(tmp) / "state.db")
        build(db)
        data = export(db)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
    print(f"  lineage            : {data['session']['lineage']}")
    print(f"  canonical display  : {data['counts']['canonicalDisplay']}")
    print(f"  raw rows           : {data['counts']['rawRows']}")
    print(f"  current page rows  : {len(data['currentServerPage']['messages'])}")


if __name__ == "__main__":
    main()
