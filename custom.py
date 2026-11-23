# custom.py
#
# Put this file in the project root (next to config.txt, participants.db, etc.)
# and restart psiturk after saving.


from flask import Blueprint, request, render_template, redirect
import os
import csv
import json
from datetime import datetime


custom_code = Blueprint("custom_code", __name__)


# ---- Paths ----
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


TASKDATA_PATH       = os.path.join(BASE_DIR, "taskdata.csv")
CONDITIONDATA_PATH  = os.path.join(BASE_DIR, "conditiondata.csv")
DEMOGRAPHICS_PATH   = os.path.join(BASE_DIR, "demographicsdata.csv")
# Your 2-rows-per-experiment questionnaire summary file
QUESTIONDATA_PATH   = os.path.join(BASE_DIR, "questiondata_summary.csv")


# ---- Column definitions ----
TASK_COLUMNS = [
    "participant_id",
    "worker_id",
    "assignment_id",
    "mode",                # interactive / silent
    "task_id",
    "task_assigned_ms",
    "task_completed_ms",
    "task_completion_ms",
    "task_accuracy",       # 0/1
    "num_clicks_this_task",
    "recorded_at_iso",
]


CONDITION_COLUMNS = [
    "participant_id",
    "worker_id",
    "assignment_id",
    "mode",                          # interactive / silent
    "num_tasks",
    "mean_task_completion_ms",
    "mean_task_accuracy",
    "total_item_clicks",
    "mean_clicks_per_task",
    "num_restocks",
    "total_restock_units",
    "wl_answers_json",
    "mean_workload",
    "recorded_at_iso",
]


# 2 rows per experiment (interactive + silent)
QUESTION_COLUMNS = [
    "participant_id",
    "worker_id",
    "assignment_id",
    "condition",   # "interactive" or "silent"
    "reliable",
    "predictable",
    "counton",
    "accurate",
    "helpful",
]


DEMOGRAPHICS_COLUMNS = [
    "participant_id",
    "worker_id",
    "assignment_id",
    "hit_id",
    "age",
    "gender",
    "used_psiturk",
    "robot_exp",
    "q_rt_ms",
    "submitted_at_iso",
]


# ---- Helper functions ----
def _template_ctx_from_args():
    """
    Build the context for templates so that questionnaire pages
    get uniqueId/uniqueid, adServerLoc/adserverloc, workerId/workerid, etc.
    """
    args = dict(request.args)


    # Values from query string (psiturk puts these there)
    workerid = args.get("workerId", "") or args.get("workerid", "")
    assignmentid = args.get("assignmentId", "") or args.get("assignmentid", "")
    hitid = args.get("hitId", "") or args.get("hitid", "")
    adserverloc = args.get("adServerLoc", "") or args.get("adserverloc", "")
    mode = args.get("mode", "")
    condition = args.get("condition", "")
    counterbalance = args.get("counterbalance", "")


    # Reconstruct unique id if possible
    unique_id = ""
    if workerid and assignmentid:
        unique_id = f"{workerid}:{assignmentid}"
    else:
        unique_id = args.get("uniqueId", "") or args.get("uniqueid", "")


    return {
        # CamelCase keys (old style)
        "uniqueId": unique_id,
        "adServerLoc": adserverloc,
        "mode": mode,
        "condition": condition,
        "counterbalance": counterbalance,
        "workerId": workerid,
        "assignmentId": assignmentid,
        "hitId": hitid,


        # Lowercase keys (new templates use these)
        "uniqueid": unique_id,
        "adserverloc": adserverloc,
        "workerid": workerid,
        "assignmentid": assignmentid,
        "hitid": hitid,


        # All original query args too, just in case
        **args,
    }


def _carry_qs(path):
    qs = request.query_string.decode()
    return f"{path}?{qs}" if qs else path


def append_csv(path, row_dict, fieldnames):
    """Append a row dict to CSV; create file + header if needed."""
    file_exists = os.path.exists(path) and os.path.getsize(path) > 0
    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerow(row_dict)


def is_placeholder(s):
    """Detect template placeholders like '{{ workerId }}'."""
    return isinstance(s, str) and ("{{" in s or "}}" in s)


def build_participant_ids_from_payload(payload):
    """
    Try to get worker_id / assignment_id / participant_id.
    Prefer explicit participant_id if present.
    Fall back to unique_id, then generate a LOCAL id.
    """
    worker_id = payload.get("worker_id", "") or payload.get("workerId", "")
    assignment_id = payload.get("assignment_id", "") or payload.get("assignmentId", "")
    unique_id = payload.get("unique_id", "") or payload.get("uniqueId", "")
    participant_id = payload.get("participant_id", "")


    # Clean placeholders
    if is_placeholder(worker_id):
        worker_id = ""
    if is_placeholder(assignment_id):
        assignment_id = ""
    if is_placeholder(unique_id):
        unique_id = ""
    if is_placeholder(participant_id):
        participant_id = ""


    # If JS already sent a good participant_id, use that
    if participant_id:
        base_id = participant_id
    else:
        # Next try unique_id or worker:assignment
        if not unique_id and worker_id and assignment_id:
            unique_id = f"{worker_id}:{assignment_id}"


        if unique_id:
            base_id = unique_id
        else:
            # Final fallback: make a local ID so it is never blank
            base_id = f"LOCAL_{int(datetime.utcnow().timestamp() * 1000)}"


    # If base_id looks like "X:Y", populate worker/assignment if missing
    if ":" in base_id:
        w, a = base_id.split(":", 1)
        if not worker_id:
            worker_id = w
        if not assignment_id:
            assignment_id = a


    participant_id = base_id
    return participant_id, worker_id, assignment_id


# ---- Page routes ----
@custom_code.route("/demographics", methods=["GET", "POST"])
def demographics():
    if request.method == "GET":
        return render_template("demographics.html", **_template_ctx_from_args())
    # JS normally intercepts POST; this is a fallback
    return redirect(_carry_qs("/instructions/instruct-1.html"))


@custom_code.route("/questionnaire_interactive", methods=["GET", "POST"])
def questionnaire_interactive():
    if request.method == "GET":
        return render_template("questionnaire_interactive.html", **_template_ctx_from_args())
    # Fallback if JS disabled
    return redirect(_carry_qs("/instructions/instruct-2.html"))


@custom_code.route("/questionnaire_silent", methods=["GET", "POST"])
def questionnaire_silent():
    if request.method == "GET":
        return render_template("questionnaire_silent.html", **_template_ctx_from_args())
    # Fallback if JS disabled
    return redirect(_carry_qs("/complete"))


@custom_code.route("/complete")
def complete():
    return render_template("complete.html")


# ---- Logging routes ----
@custom_code.route("/record_taskdata", methods=["POST"])
def record_taskdata():
    raw = request.form.get("taskdata")
    if not raw:
        return "missing taskdata", 400
    try:
        payload = json.loads(raw)
    except Exception as e:
        return f"bad json: {e}", 400


    participant_id, worker_id, assignment_id = build_participant_ids_from_payload(payload)
    mode = payload.get("mode", "")


    row = {col: "" for col in TASK_COLUMNS}
    row["participant_id"] = participant_id
    row["worker_id"] = worker_id
    row["assignment_id"] = assignment_id
    row["mode"] = mode


    row["task_id"] = payload.get("task_id", "")
    row["task_assigned_ms"] = payload.get("task_assigned_ms", "")
    row["task_completed_ms"] = payload.get("task_completed_ms", "")
    row["task_completion_ms"] = payload.get("task_completion_ms", "")
    row["task_accuracy"] = payload.get("task_accuracy", "")
    row["num_clicks_this_task"] = payload.get("num_clicks_this_task", "")


    # Even if frontend sends recorded_at_iso, we keep the server timestamp as ground truth
    row["recorded_at_iso"] = datetime.utcnow().isoformat()


    append_csv(TASKDATA_PATH, row, TASK_COLUMNS)
    return "ok", 200


@custom_code.route("/record_conditiondata", methods=["POST"])
def record_conditiondata():
    raw = request.form.get("conditiondata")
    if not raw:
        return "missing conditiondata", 400
    try:
        payload = json.loads(raw)
    except Exception as e:
        return f"bad json: {e}", 400


    participant_id, worker_id, assignment_id = build_participant_ids_from_payload(payload)
    mode = payload.get("mode", "")


    row = {col: "" for col in CONDITION_COLUMNS}
    row["participant_id"] = participant_id
    row["worker_id"] = worker_id
    row["assignment_id"] = assignment_id
    row["mode"] = mode


    row["num_tasks"] = payload.get("num_tasks", "")
    row["mean_task_completion_ms"] = payload.get("mean_task_completion_ms", "")
    row["mean_task_accuracy"] = payload.get("mean_task_accuracy", "")
    row["total_item_clicks"] = payload.get("total_item_clicks", "")
    row["mean_clicks_per_task"] = payload.get("mean_clicks_per_task", "")
    row["num_restocks"] = payload.get("num_restocks", "")
    row["total_restock_units"] = payload.get("total_restock_units", "")
    row["wl_answers_json"] = payload.get("wl_answers_json", "")
    row["mean_workload"] = payload.get("mean_workload", "")


    row["recorded_at_iso"] = datetime.utcnow().isoformat()


    append_csv(CONDITIONDATA_PATH, row, CONDITION_COLUMNS)
    return "ok", 200


@custom_code.route("/record_questiondata", methods=["POST"])
def record_questiondata():
    """
    Receives *post-questionnaire* responses for a single condition
    (interactive or silent) and appends ONE row to questiondata_summary.csv
    with the fixed columns requested.


    Supports both the NEW payload keys:
      - condition, reliable, predictable, counton, accurate, helpful


    and the OLD payload shape (for safety):
      - cond, q_reliable, q_predictable, q_counton, q_accurate, q_helpful
    """
    qraw = request.form.get("questiondata")
    if not qraw:
        return "missing questiondata", 400
    try:
        payload = json.loads(qraw)
    except Exception as e:
        return f"bad json: {e}", 400


    participant_id, worker_id, assignment_id = build_participant_ids_from_payload(payload)


    # New key first, fallback to old
    condition = payload.get("condition", "") or payload.get("cond", "")


    reliable    = payload.get("reliable",    payload.get("q_reliable", ""))
    predictable = payload.get("predictable", payload.get("q_predictable", ""))
    counton     = payload.get("counton",     payload.get("q_counton", ""))
    accurate    = payload.get("accurate",    payload.get("q_accurate", ""))
    helpful     = payload.get("helpful",     payload.get("q_helpful", ""))


    row = {col: "" for col in QUESTION_COLUMNS}
    row["participant_id"] = participant_id
    row["worker_id"] = worker_id
    row["assignment_id"] = assignment_id
    row["condition"] = condition
    row["reliable"] = reliable
    row["predictable"] = predictable
    row["counton"] = counton
    row["accurate"] = accurate
    row["helpful"] = helpful


    append_csv(QUESTIONDATA_PATH, row, QUESTION_COLUMNS)
    return "ok", 200


@custom_code.route("/record_demographics", methods=["POST"])
def record_demographics():
    """
    Receives demographics payload and appends to demographicsdata.csv
    (one row per participant).
    """
    raw = request.form.get("demographics")
    if not raw:
        return "missing demographics", 400
    try:
        payload = json.loads(raw)
    except Exception as e:
        return f"bad json: {e}", 400


    participant_id, worker_id, assignment_id = build_participant_ids_from_payload(payload)


    row = {
        "participant_id": participant_id,
        "worker_id": worker_id,
        "assignment_id": assignment_id,
        "hit_id": payload.get("hit_id", ""),
        "age": payload.get("age", ""),
        "gender": payload.get("gender", ""),
        "used_psiturk": payload.get("used_psiturk", ""),
        "robot_exp": payload.get("robot_exp", ""),
        "q_rt_ms": payload.get("q_rt_ms", ""),
        # We use server time as canonical submission time
        "submitted_at_iso": datetime.utcnow().isoformat(),
    }


    append_csv(DEMOGRAPHICS_PATH, row, DEMOGRAPHICS_COLUMNS)
    return "ok", 200





