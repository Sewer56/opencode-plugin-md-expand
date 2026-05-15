### Step fidelity
Goals, constraints, scope, and decisions in `handoff_path` and `plan_path` must be represented in steps.

### Step completeness
Every `REQ-###` maps to implementation and test refs. Block gaps, placeholders, missing anchors, and undefined helpers.

### Step economy
Block unnecessary steps beyond confirmed intent and wrong file placement. Do not flag separate steps needed for distinct files or review ownership.

### Dead code from removals
Run only when steps contain REMOVE or symbol-deletion UPDATE. Flag orphaned imports, callers, type refs, unreachable paths, dead dispatch arms, and cross-file dead imports.
