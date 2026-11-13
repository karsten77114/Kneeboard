#!/usr/bin/env python3
"""Build a signed "上傳公告 v4" shortcut with a fixed date format.

Reads the installed "上傳公告" shortcut from the Shortcuts database (read-only),
patches the format.date action to yyyy-MM-dd, prefixes the final showresult
text, and signs the result with `shortcuts sign`.

The output embeds an auth token, so it must live outside any git repository.
Nothing is imported, run, or written back to the Shortcuts database.
"""
import argparse
import os
import plistlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile

SOURCE_NAME = "上傳公告"
DEFAULT_NAME = "上傳公告 v4"
DEFAULT_DB = "~/Library/Shortcuts/Shortcuts.sqlite"
CLIENT_VERSION = "4610"
RESULT_PREFIX = "公告上傳結果（請以此訊息為準）\n"
OBJ_REPLACEMENT = "￼"

ID_DATE = "is.workflow.actions.format.date"
ID_DOWNLOAD = "is.workflow.actions.downloadurl"
ID_SHOW = "is.workflow.actions.showresult"

FALLBACK_INPUT_CLASSES = [
    "WFImageContentItem",
    "WFPDFContentItem",
    "WFStringContentItem",
]


class BuildError(Exception):
    pass


def utf16_len(s):
    return len(s.encode("utf-16-le")) // 2


def find_git_root(path):
    cur = os.path.realpath(path)
    while True:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return None
        cur = parent


def check_output_path(output):
    out = os.path.realpath(os.path.expanduser(output))
    parent = os.path.dirname(out)
    if not os.path.isdir(parent):
        raise BuildError("output directory does not exist")
    roots = {find_git_root(parent), find_git_root(os.path.dirname(os.path.abspath(__file__)))}
    roots.discard(None)
    for root in roots:
        if out == root or out.startswith(root + os.sep):
            raise BuildError("output must not be inside a git repository (it embeds a token)")
    if find_git_root(parent):
        raise BuildError("output must not be inside a git repository (it embeds a token)")
    return out


def columns(con, table):
    return {row[1] for row in con.execute(f'PRAGMA table_info("{table}")')}


def load_shortcut(db_path):
    path = os.path.realpath(os.path.expanduser(db_path))
    if not os.path.isfile(path):
        raise BuildError("Shortcuts database not found")
    con = sqlite3.connect("file:%s?mode=ro" % path.replace("?", "%3f").replace("#", "%23"), uri=True)
    try:
        sc_cols = columns(con, "ZSHORTCUT")
        act_cols = columns(con, "ZSHORTCUTACTIONS")
        if not {"ZNAME", "Z_PK"} <= sc_cols or not {"ZSHORTCUT", "ZDATA"} <= act_cols:
            raise BuildError("unexpected Shortcuts database schema")
        select = "Z_PK"
        if "ZINPUTCLASSESDATA" in sc_cols:
            select += ", ZINPUTCLASSESDATA"
        else:
            select += ", NULL"
        where = "ZNAME = ?"
        if "ZTOMBSTONED" in sc_cols:
            where += " AND ZTOMBSTONED = 0"
        if "ZDELETIONDATE" in sc_cols:
            where += " AND ZDELETIONDATE IS NULL"
        rows = con.execute(f"SELECT {select} FROM ZSHORTCUT WHERE {where}", (SOURCE_NAME,)).fetchall()
        if len(rows) != 1:
            raise BuildError("expected exactly one non-deleted source shortcut, found %d" % len(rows))
        pk, classes_blob = rows[0]
        arows = con.execute("SELECT ZDATA FROM ZSHORTCUTACTIONS WHERE ZSHORTCUT = ?", (pk,)).fetchall()
        if len(arows) != 1 or arows[0][0] is None:
            raise BuildError("expected exactly one action record for the source shortcut")
        try:
            data = plistlib.loads(bytes(arows[0][0]))
        except Exception:
            raise BuildError("cannot parse action plist")
    finally:
        con.close()

    if isinstance(data, dict):
        data = data.get("WFWorkflowActions")
    if not isinstance(data, list) or not all(isinstance(a, dict) for a in data):
        raise BuildError("action data is not an action list")

    classes = None
    if classes_blob:
        try:
            parsed = plistlib.loads(bytes(classes_blob))
            if isinstance(parsed, list) and parsed and all(isinstance(c, str) for c in parsed):
                classes = parsed
        except Exception:
            classes = None
    return data, classes


def shift_text(text_param):
    """Return (new Text parameter, description) with the prefix prepended."""
    shift = utf16_len(RESULT_PREFIX)
    if not isinstance(text_param, dict) or "Value" not in text_param:
        raise BuildError("showresult Text is not a magic reference")
    value = text_param["Value"]
    ser = text_param.get("WFSerializationType")
    if ser == "WFTextTokenAttachment" or (isinstance(value, dict) and "Type" in value and "string" not in value):
        new_value = {
            "string": RESULT_PREFIX + OBJ_REPLACEMENT,
            "attachmentsByRange": {"{%d, 1}" % shift: value},
        }
    elif isinstance(value, dict) and isinstance(value.get("string"), str):
        old = value["string"]
        if old.startswith(RESULT_PREFIX):
            raise BuildError("showresult Text already has the prefix")
        shifted = {}
        for key, att in (value.get("attachmentsByRange") or {}).items():
            try:
                loc, length = [int(x) for x in key.strip("{} ").split(",")]
            except ValueError:
                raise BuildError("unrecognized attachment range key")
            shifted["{%d, %d}" % (loc + shift, length)] = att
        new_value = dict(value)
        new_value["string"] = RESULT_PREFIX + old
        new_value["attachmentsByRange"] = shifted
    else:
        raise BuildError("unsupported showresult Text structure")
    return {"Value": new_value, "WFSerializationType": "WFTextTokenString"}


def patch_actions(actions):
    ident = lambda a: a.get("WFWorkflowActionIdentifier")
    dates = [a for a in actions if ident(a) == ID_DATE]
    downloads = [a for a in actions if ident(a) == ID_DOWNLOAD]
    if len(dates) != 1:
        raise BuildError("expected exactly one format.date action, found %d" % len(dates))
    if len(downloads) != 1:
        raise BuildError("expected exactly one downloadurl action, found %d" % len(downloads))
    if not actions or ident(actions[-1]) != ID_SHOW:
        raise BuildError("last action is not showresult")

    params = dates[0].setdefault("WFWorkflowActionParameters", {})
    params["WFDateFormatStyle"] = "Custom"
    params["WFDateFormatString"] = "yyyy-MM-dd"

    show_params = actions[-1].setdefault("WFWorkflowActionParameters", {})
    if "Text" not in show_params:
        raise BuildError("showresult has no Text parameter")
    message_actions = [a for a in actions if ident(a) == "is.workflow.actions.getvalueforkey"
                       and a.get("WFWorkflowActionParameters", {}).get("WFDictionaryKey", {}).get("Value", {}).get("string") == "message"]
    if len(message_actions) != 1:
        raise BuildError("expected exactly one message extraction action")
    message_uuid = message_actions[0]["WFWorkflowActionParameters"].get("UUID")
    refs = show_params["Text"].get("Value", {}).get("attachmentsByRange", {}).values()
    if not message_uuid or not any(r.get("OutputUUID") == message_uuid for r in refs):
        raise BuildError("showresult must display the server message")
    show_params["Text"] = shift_text(show_params["Text"])
    return [
        "format.date -> Custom yyyy-MM-dd (WFDate input kept)",
        "showresult Text prefixed with result label, magic ranges shifted",
    ]


def build_workflow(actions, name, classes):
    return {
        "WFWorkflowName": name,
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": CLIENT_VERSION,
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 431817727,
            "WFWorkflowIconGlyphNumber": 59771,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": classes or FALLBACK_INPUT_CLASSES,
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowHasOutputFallback": False,
    }


def sign(workflow, output, force):
    if os.path.lexists(output):
        if not force:
            raise BuildError("output already exists (use --force to replace)")
        if not os.path.isfile(output):
            raise BuildError("output exists and is not a regular file")
        os.remove(output)
    tmpdir = tempfile.mkdtemp(prefix="notice-shortcut-")
    os.chmod(tmpdir, 0o700)
    try:
        tmp_plist = os.path.join(tmpdir, "unsigned.shortcut")
        fd = os.open(tmp_plist, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as fh:
            plistlib.dump(workflow, fh, fmt=plistlib.FMT_BINARY)
        try:
            proc = subprocess.run(
                ["shortcuts", "sign", "-m", "anyone", "-i", tmp_plist, "-o", output],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120,
            )
        except FileNotFoundError:
            raise BuildError("`shortcuts` command not found")
        except subprocess.TimeoutExpired:
            raise BuildError("`shortcuts sign` timed out")
        if proc.returncode != 0 or not os.path.isfile(output):
            raise BuildError("`shortcuts sign` failed (exit %d)" % proc.returncode)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    os.chmod(output, 0o600)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output", required=True, help="signed .shortcut path (must be outside any git repo)")
    ap.add_argument("--name", default=DEFAULT_NAME, help="shortcut name (default: %(default)s)")
    ap.add_argument("--db", default=DEFAULT_DB, help="Shortcuts.sqlite path (opened read-only)")
    ap.add_argument("--force", action="store_true", help="replace an existing output file")
    args = ap.parse_args()

    try:
        output = check_output_path(args.output)
        actions, classes = load_shortcut(args.db)
        changes = patch_actions(actions)
        workflow = build_workflow(actions, args.name, classes)
        sign(workflow, output, args.force)
    except BuildError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 1
    except sqlite3.Error:
        print("error: cannot read Shortcuts database", file=sys.stderr)
        return 1

    print("output: %s" % output)
    print("actions: %d" % len(actions))
    for line in changes:
        print("changed: %s" % line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
