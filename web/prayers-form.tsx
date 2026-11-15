import { type FormEvent, useState } from "react";
import { businessDay } from "../api/members/dates";
import type { PrayerCommand, PrayerFields } from "../api/prayers/validation";
import {
  type PrayerDetail,
  prayerActions,
  prayerCategories,
  prayerVisibility,
} from "./prayers-api";
import type { TenantRealm } from "./tenant-mutation";
import { Button, Choice, DialogActions, Field, Select, TextArea, TextInput } from "./ui/components";
import { CarePeoplePicker } from "./visitation-form";
export function PrayerForm({
  action,
  record,
  audience,
  realm,
  prefix,
  locked,
  onPreview,
  onCancel,
  onError,
}: {
  action: PrayerCommand["action"];
  record: PrayerDetail | null;
  audience: "all" | "shared";
  realm: TenantRealm;
  prefix: string;
  locked: boolean;
  onPreview: (b: PrayerCommand) => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const [visibility, setVisibility] = useState<"shared" | "pastoral">(
      record?.visibility ?? (audience === "all" ? "pastoral" : "shared"),
    ),
    [content, setContent] = useState(record?.content ?? ""),
    [category, setCategory] = useState<PrayerFields["category"]>(record?.category ?? "other"),
    [receivedOn, setReceivedOn] = useState(record?.receivedOn ?? (record ? "" : businessDay())),
    [kind, setKind] = useState<PrayerFields["requester"]["kind"]>(record?.requester.kind ?? "none"),
    [sender, setSender] = useState(record?.requester.kind === "text" ? record.requester.name : ""),
    [people, setPeople] = useState<{ id: string; code: string; fullName: string }[]>(
      record?.requester.kind === "member"
        ? [
            {
              id: record.requester.id,
              code: record.requesterSnapshot.code ?? "",
              fullName: record.requesterSnapshot.name ?? "Người gửi đã ghi",
            },
          ]
        : [],
    ),
    [sharedOn, setSharedOn] = useState(record?.sharedOn ?? businessDay()),
    [reason, setReason] = useState("");
  const editing = ["create", "update", "correct"].includes(action);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (locked) return;
    const common = { reason: reason.trim() || null, preview: null, confirmed: false };
    if (action === "create" || action === "update" || action === "correct") {
      if (kind === "member" && !people[0]) {
        onError(new Error("Cần chọn người gửi."));
        return;
      }
      const fields: PrayerFields = {
        content,
        category,
        receivedOn: receivedOn || null,
        requester:
          kind === "none"
            ? { kind: "none" }
            : kind === "text"
              ? { kind: "text", name: sender }
              : { kind: "member", id: people[0]?.id as string },
      };
      onPreview(
        action === "create"
          ? { action, visibility, fields, ...common }
          : {
              action,
              fields,
              ...(action === "correct" && record?.sharedOn ? { sharedOn } : {}),
              ...common,
            },
      );
    } else onPreview(action === "share" ? { action, sharedOn, ...common } : { action, ...common });
  }
  return (
    <form onSubmit={submit} className="care-section" aria-label={prayerActions[action]}>
      {editing && (
        <>
          <Field label="Phạm vi xem">
            <div role="radiogroup" aria-label="Phạm vi xem" className="care-actions">
              {audience === "all" && (
                <Choice
                  type="radio"
                  name="prayer-visibility"
                  label={prayerVisibility.pastoral}
                  checked={visibility === "pastoral"}
                  disabled={locked || action !== "create"}
                  onChange={() => setVisibility("pastoral")}
                />
              )}
              <Choice
                type="radio"
                name="prayer-visibility"
                label={prayerVisibility.shared}
                checked={visibility === "shared"}
                disabled={locked || action !== "create"}
                onChange={() => setVisibility("shared")}
              />
            </div>
          </Field>
          <p className="muted">
            Phạm vi khóa sau khi lưu. Chung nội bộ dành cho Owner, Mục sư và Thư ký có quyền trong
            Hội Thánh.
          </p>
          <div className="care-grid">
            <Field label="Ngày nhận · có thể chưa rõ">
              <TextInput
                type="date"
                value={receivedOn}
                max={businessDay()}
                disabled={locked}
                onChange={(e) => setReceivedOn(e.target.value)}
              />
            </Field>
            <Field label="Danh mục cầu thay">
              <Select
                value={category}
                disabled={locked}
                onChange={(e) => setCategory(e.target.value as typeof category)}
              >
                {Object.entries(prayerCategories).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Người gửi">
            <Select
              value={kind}
              disabled={locked}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="none">Chưa khai</option>
              <option value="member">Chọn thuộc viên / thân hữu</option>
              <option value="text">Ghi tên cá nhân / nhóm</option>
            </Select>
          </Field>
          {kind === "text" && (
            <Field label="Tên người gửi / nhóm">
              <TextInput
                required
                maxLength={200}
                value={sender}
                disabled={locked}
                onChange={(e) => setSender(e.target.value)}
              />
            </Field>
          )}
          {kind === "member" && (
            <CarePeoplePicker
              kind={null}
              realm={realm}
              prefix={prefix}
              label="Người gửi từ hồ sơ"
              selected={people}
              locked={locked}
              onChange={setPeople}
              onError={onError}
            />
          )}
          <Field label="Nội dung cầu thay">
            <TextArea
              required
              maxLength={2000}
              rows={6}
              value={content}
              disabled={locked}
              onChange={(e) => setContent(e.target.value)}
            />
          </Field>
        </>
      )}
      {(action === "share" || (action === "correct" && !!record?.sharedOn)) && (
        <>
          <p>Chỉ ghi nhận việc đã chia sẻ. Thao tác này không gửi thông báo.</p>
          <Field label="Ngày đã chia sẻ">
            <TextInput
              type="date"
              required
              max={businessDay()}
              value={sharedOn}
              disabled={locked}
              onChange={(e) => setSharedOn(e.target.value)}
            />
          </Field>
        </>
      )}
      <Field label={action === "create" ? "Lý do / ghi chú thao tác · tùy chọn" : "Lý do thao tác"}>
        <TextArea
          required={action !== "create"}
          maxLength={500}
          rows={3}
          value={reason}
          disabled={locked}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <DialogActions>
        <Button disabled={locked} onClick={onCancel}>
          Hủy
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={locked || (kind === "member" && editing && !people.length)}
        >
          Xem trước cầu thay
        </Button>
      </DialogActions>
    </form>
  );
}
