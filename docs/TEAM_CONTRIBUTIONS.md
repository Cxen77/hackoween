# Team contributions

This file records what the repository shows. The individual roles of each team member must be filled in by the team; they are not inferred from the code.

## What the commit history shows
Commit counts on `main` (from `git log`, at commit 2ccc2a2):
- **Dev** (collaborator, GitHub `Cxen77`): 56 commits, including the website UI, the Model page tabs, the Render and Vercel deployment.
- **okaharsh** (repository owner on this machine): 25 commits, including the forecasting models, the evaluation scripts, the held-out tests and the documentation.

Commit author is a record of who pushed, not of who did what. Pair-programmed and reviewed work may appear under one name.

## Areas of work (as found in the repository)
| Area | Main files | Notes |
|---|---|---|
| Forecast models and training | `scripts/basinshift_model.py`, `scripts/train_augmented_v2.py`, `scripts/tune_aug.py` | |
| Data cleaning and combined dataset | `scripts/clean_data.py`, `scripts/prepare_augmented.py` | |
| Evaluation and reports | `scripts/evaluate.py`, `scripts/eval_routed.py`, `scripts/basinshift_stress.py`, `scripts/route_by_size.py` | |
| Model server | `server/model_api.py`, `scripts/predict.py` | |
| Website and maps | `src/` | |
| Model page and judge tools | `src/components/ModelPage.tsx`, `src/modelMetrics.mjs` | |
| Deployment | `render.yaml`, `vercel.json`, `requirements-render.txt` | |
| Documentation | `docs/`, `reports/`, `README.md`, `HANDOFF.md` | |
| Presentation | `presentation/` | |

## Team members and roles
| Name | Roll number | Role |
|---|---|---|
| Harsh Srivastav | 1BY25CB020 | Frontend and other work: website pages, Model page, documentation, submission package (git author okaharsh) |
| Dev Chandra Prasad Yadav | 1BY25CS085 | Flood simulation and model training (git author Dev) |
| Arman Jha | 1BY25CS057 | To be confirmed by the team |
| Sumit Santosh Bulbule | 1TD25CS307 | To be confirmed by the team |

Arman Jha and Sumit Santosh Bulbule have no commits in the repository, so their roles need to be confirmed by the team.

## Check before the panel
The git history does not match this split exactly. Commits by okaharsh include most of the training scripts (`scripts/train_augmented_v2.py`, `scripts/tune_aug.py`) and the model core (`scripts/basinshift_model.py`), while Dev committed most of the simulation and terrain code (`src/terrain.ts`, `src/river-flood.mjs`) and the Render configuration. Work done outside git (for example on a shared computer) can't be seen here. Decide which description is accurate before presenting.
