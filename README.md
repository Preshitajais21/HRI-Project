# Hospital Robot Supervision: Query-Based vs. Autonomous Behavior

A human-robot interaction (HRI) study investigating how people supervise an inventory robot operating in a simulated hospital environment, comparing two modes of robot autonomy within a within-subjects design.

## Study Design

Participants complete two short tasks (~2.5 minutes each), each followed by a questionnaire:

- **Part 1 — Query-based supervision:** the robot actively asks the participant for input before acting.
- **Part 2 — Autonomous behavior:** the robot acts more independently, with less participant input.

The study measures how supervision style affects participants' trust in and perception of the robot, using pre/post questionnaires and interaction logs collected during each task.

## Tech Stack

- **psiTurk** — experiment deployment framework (Flask + SQLAlchemy) for running and managing the study, including Mechanical Turk integration
- **Flask** (via psiTurk) — serves the experiment web app and routes
- **SQLite** — stores participant responses and interaction/event logs
- **HTML/CSS/JS** — experiment frontend (consent, instructions, questionnaires, robot interaction stage)

## Repository Structure

```text
.
├── custom.py                 # Custom Flask routes/logic for the experiment
├── config.txt                # psiTurk configuration (template — no secrets)
├── templates/                 # Experiment pages: consent, instructions, questionnaires, stage, debrief
├── static/
│   ├── robot/                 # Robot interaction interface and video assets
│   ├── css/, js/, lib/, fonts/ # Frontend assets
│   └── images/
├── participants.db            # SQLite DB of (test/debug) participant data
├── *.csv                      # Exported interaction/questionnaire data
└── report/
    ├── hospital_robot_supervision.pptx   # Project presentation
    ├── conditiondata.pdf                 # Condition-level analysis
    ├── demographicsdata.pdf              # Participant demographics analysis
    └── questiondata_summary.pdf          # Questionnaire results summary
```

## Running Locally

```bash
pip install psiturk
cd hospital_robot_supervision
psiturk
```

Then, from the psiTurk shell:

```text
server on
debug
```

This launches the experiment in debug mode in your browser without needing live Mechanical Turk credentials.

## Data Note

The participant data included (`participants.db`, `*.csv`) is from debug/development runs only — no live study data from Mechanical Turk workers is included in this repository.

## Report

See the [`report/`](./report) folder for the project presentation and data-analysis results (condition comparisons, demographics, and questionnaire summaries).
