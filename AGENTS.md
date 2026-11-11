# Agent Kit — operating core

Read the assigned task and relevant source first. Consult policy,
workflow, the skill catalog and role details only when needed.
Preserve the project's domain rules, stack, contracts and data.

## Planning, approval and implementation

Every task, including a short/small fix, follows:
planning → user/Product Owner approval → implementation.

Present the outcome, scope, intended result and relevant checks.
A small task may use a short chat plan. A request to fix/update
does not itself replace approval of that plan. Read-only investigation
may inform planning; wait for approval before file edits or implementation.

At the start of every plan, including small tasks, state the delivery type,
rationale and parent roadmap directly in chat: `Kiểu bàn giao: Một lần /
Theo roadmap`, `Căn cứ: ...`, `Thuộc roadmap: ... / Không`.
Use the [classification criteria](docs/handoff-templates.md#phan-loai-khi-lap-ke-hoach):
choose by acceptance needs, not file count, lines of code or elapsed time.
A small package inside an agreed roadmap keeps its roadmap position and
acceptance stops. Risk determines required checks separately. The user
approves the classification with the plan; material scope growth requires
an amended plan before expanding work.

After approval, complete the covered work without repeated approval
per file or step within the current acceptance package. For roadmap work,
predefine meaningful packages before implementation; hand off each package
and stop until Khiêm accepts it and authorizes the next. Material solution/scope changes require an amended
plan and approval. Historical approvals and status records do not
grant standing authority for another task.

Git publication, deployment, production/real-data operations, paid,
destructive and external actions retain their explicit permission
boundaries. Honor human stops and preserve others' work.

## Adapt preparation to the task

- Long tasks: complete all production code files and real wiring
  in the approved current package before writing/updating unit or other tests,
  then run those tests. Do not alternate code/test per file/function
  or create artificial intermediate handoffs.
- Complex tasks: investigate the current system, evaluate risks and
  alternatives, discuss a concrete proposal, and obtain approval
  before implementation. Then follow the full-code-before-tests order.
- UI tasks: present an ASCII text mockup for preview/discussion and
  obtain approval of the UI plan before coding. Complete the approved
  UI/data/caller wiring before tests and rendered verification.
- Combined tasks apply all relevant requirements.

Keep security, data and verification requirements proportionate to
actual risks. Missing decisions or unsafe dependencies still require
a pause of affected work; do not manufacture completion with mocks
or false-success fallbacks.

## Show WHAT in the conversation

Always render a WHAT table directly in the conversation when presenting
an implementation plan and in the completed-work report, including small
tasks. A table saved in a file or a link to that file does not replace
the conversation table. Intermediate progress updates need not repeat it.

Use these columns: Name | Purpose | Location | Status | Reason if undone/ignored.
Use stable item names within the task. In planning, show the intended work
and its actual planning/approval status; in the final report, show each
item's actual result. Explain every undone, blocked, deferred or ignored
item; use an em dash when no reason applies. Localize the column labels
and statuses to the conversation language while preserving identifiers.

Keep the table proportional to the task and reuse existing task/state
records; it adds no separate tracker or mandatory task file. The WHAT
table complements the skills table and next-step options. A done row
alone does not establish verified behavior, human acceptance, release
or permission to execute.

## Select and report skills

During planning, select the minimum sufficient skills from the task's
type, affected boundaries, risks and outcome. State brief reasons.
Read selected SKILL.md files before applying them, and only the
references needed. Do not preload all skills or follow a fixed chain.

Close planning and implementation with one table:
Skill | Source | Actual contribution | Estimated participation %.

Use compact source labels: Personal / Repo; UNKNOWN when unverified.
Keep paths, versions and fingerprints in the journal, not the table.
Include only actually applied skills. Contribution estimates total
100% among those skills; they are not measured time/token usage or
effectiveness scores. If no skill was used, state that explicitly.

Within authorized write scope, the delivery owner saves the phase
record in the local skill journal before reporting and uses that same
record for the table. Preserve history through linked evaluations
and corrections; do not duplicate usage on resume. Missing measured
counters remain null with reasons. Read-only/unapproved planning
stays in chat; never claim an unsaved record was saved.

## Maintain current state

Keep durable rules here, stable design in docs/project-context.md,
intended outcomes in docs/project-plan.md, and the single current-state
summary in docs/project-state.md. Detailed approval/evidence remains
in the relevant task or decision record.

The delivery owner proactively updates affected state/task entries
within authorized writes after approval/scope changes, meaningful
results, blockers/stops and before handoff. Do not wait for reminders
or create competing live trackers. Children return proposed shared
updates to the owner.

Use one checkpoint when a real interruption or handoff needs it.
Resume remaining work and reuse unaffected evidence. State and
historical records do not authorize starting or resuming another task.
This responsibility creates no scheduler, daemon or harness.

## Finish and hand off

Use the two [handoff templates](docs/handoff-templates.md). Both include an
actual result image or a technical diagram grounded in the delivered work,
with revision, evidence status and limits; show the visual directly in chat.
Long roadmap tasks show accepted, awaiting acceptance, next and later package
names from the agreed plan. Short tasks omit the roadmap and hand off once.
Keep the stable overall picture in docs/project-context.md, detailed outcomes
in docs/project-plan.md and live status only in docs/project-state.md.

Use existing project tools and checks appropriate to the approved
scope. During the test phase, repair evidenced defects and rerun
affected checks without weakening valid assertions.

Continue diagnostics while concrete evidence and useful progress
justify the cost. Stop when scoped acceptance and sufficient
verification are met; unrelated polish is separate work.

The main session owns delivery. Delegate only when authorized and
useful; assign bounded ownership. Children do not delegate.

Use concise TechNote Level 1 by default. Follow the requested
user/project language; otherwise retain the kit's English default.
Report results, actual evidence and limits, the skills table, and
1–3 concrete next-step options with required conditions/authority.

Distinguish source complete, behavior verified, human accepted and
released. Required unrun checks remain NOT_RUN. No automatic
publication or release.

## Church CMS

- Luôn trao đổi với Khiêm bằng tiếng Việt, kể cả TechNote Levels 1–4; chỉ dùng tiếng Anh khi Khiêm trực tiếp yêu cầu.
- Trước khi tạo worktree, thông báo lý do, đường dẫn dự kiến và repo/branch nguồn.
- Stack đã duyệt: ReactJS/TypeScript/Vite/TailwindCSS, Bun/TypeScript, MongoDB và Redis; thiết kế nền tảng tại docs/engineering/P0-FOUNDATION.md.
- Quyền implementation theo task/phê duyệt hiện hành; danh mục P1 tại docs/tasks/CHURCH-P1.md. Không suy quyền mở gói tiếp từ roadmap.
- Lệnh setup/checks và giới hạn local TLS/synthetic data tại docs/engineering/P1.1-local-runbook.md. Git publication/deploy cần quyền riêng.
- Lịch sử tasks, journal và bằng chứng có sẵn từ kit là lịch sử upstream, không cấp quyền hay chứng minh kết quả Church CMS. Xem docs/agent-kit-installation.md.

## Chuẩn UI dùng chung — UI-STD-r1

Mọi task UI dùng [docs/ui-system.md](docs/ui-system.md) và `web/ui/components`. HTML gốc là chuẩn style; feature CSS chỉ bố trí nội dung. Không tự đặt palette/font/breakpoint hoặc override component. Chạy `bun run ui:check` cùng checks UI; đối chiếu light/dark/responsive và ghi giới hạn. Thay đổi đáng kể ngoài chuẩn cần duyệt lại phạm vi trước coding.

Menu `AppShell` luôn hiển thị icon + tên mục trên desktop và drawer mobile; tooltip/aria-label không thay nhãn hiển thị. Đây là điều chỉnh đã duyệt sau phản hồi mất text UI-STD-r1.
