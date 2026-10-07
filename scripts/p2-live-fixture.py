#!/usr/bin/env python3
"""Seed a REAL compacted + lineage session into the live state DB so the app can
exercise the P2 client subset (pinned include_compacted display read).

Uses the same real mechanisms as scripts/p2-golden-fixture.py:
  * archive_and_compact()        -> compacted rows (active=0, compacted=1)
  * publish_compression_child()  -> a genuine parent -> child lineage

Without the P2 change the app read active-only, so this session would show just
a summary + carried tail. With include_compacted=true it shows the full,
deduped display history.

Delete it afterwards from the app, or:
  hermes sessions delete zzp2-compacted
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(os.environ.get("HERMES_AGENT_REPO", str(Path.home() / ".hermes/hermes-agent")))
sys.path.insert(0, str(REPO))

from hermes_state import SessionDB  # noqa: E402

DB_PATH = Path.home() / ".hermes" / "state.db"
ROOT = "zzp2-compacted"
CHILD = "zzp2-compacted-child"
TITLE = "ZZ P2 — compacted history (delete me)"
PAIRS = 1100


def build(db: SessionDB) -> None:
    for sid in (ROOT, CHILD):
        try:
            db.delete_session(sid, include_compression_chain=True)
        except Exception:
            pass

    db.create_session(ROOT, source="desktop", profile_name="default", model="test")
    ts = 1_700_100_000.0
    for i in range(1, PAIRS + 1):
        ts += 1
        db.append_message(ROOT, "user", f"prompt #{i:04d}", timestamp=ts)
        ts += 1
        db.append_message(ROOT, "assistant", f"reply #{i:04d}", timestamp=ts)

    # Real in-place compaction: archive the bulk, carry a small tail.
    live = db.get_messages_as_conversation(ROOT)
    db.archive_and_compact(ROOT, [{"role": "user", "content": "[summary 1]"}] + live[-40:], tail_count=40)

    # A few more turns, then a real rotation into a child (lineage).
    for i in range(PAIRS + 1, PAIRS + 31):
        ts += 1
        db.append_message(ROOT, "user", f"prompt #{i:04d}", timestamp=ts)
        ts += 1
        db.append_message(ROOT, "assistant", f"reply #{i:04d}", timestamp=ts)
    active_ids = [
        r["id"]
        for r in db._read_all("SELECT id FROM messages WHERE session_id = ? AND active = 1 ORDER BY id", (ROOT,))
    ]
    watermark = (active_ids[-20] - 1) if len(active_ids) >= 20 else 0
    db.publish_compression_child(
        parent_session_id=ROOT,
        child_session_id=CHILD,
        source="desktop",
        profile_name="default",
        messages=[{"role": "user", "content": "[summary 2]"}],
        require_compression_lease=False,
        watermark=watermark,
    )
    for i in range(PAIRS + 31, PAIRS + 61):
        ts += 1
        db.append_message(CHILD, "user", f"post-rotation #{i:04d}", timestamp=ts)
        ts += 1
        db.append_message(CHILD, "assistant", f"post-rotation reply #{i:04d}", timestamp=ts)
    with __import__("contextlib").suppress(Exception):
        db.set_session_title(ROOT, TITLE)


def main() -> None:
    db = SessionDB(DB_PATH)
    build(db)
    resolved = db.resolve_resume_session_id(ROOT)
    display = len(db.get_messages(resolved, include_compacted=True, include_ancestors=True))
    active_only = len(db.get_messages(resolved, include_ancestors=True))
    print(f"seeded {ROOT} (resolved {resolved})")
    print(f"  display history (include_compacted=true) : {display}")
    print(f"  active-only     (old behaviour)          : {active_only}")


if __name__ == "__main__":
    main()
