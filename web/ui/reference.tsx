import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppShell,
  Badge,
  Button,
  Card,
  Choice,
  DialogActions,
  Drawer,
  EmptyState,
  Feedback,
  Field,
  Icon,
  IconButton,
  KeyValueList,
  Loading,
  Modal,
  PaginationControl,
  SectionHeader,
  Select,
  StatCard,
  Stats,
  TableFrame,
  Tabs,
  TextArea,
  TextInput,
  Toolbar,
} from "./components";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "@fontsource/lora/600.css";
import "@fontsource/lora/700.css";
import "../style.css";

// Local developer reference only. This entry is excluded from the product build and routes.
function PatternFixture() {
  return (
    <div className="content">
      <Card data-compare="card">
        <SectionHeader title="Thông tin Hội Thánh">
          <Button>Sửa</Button>
        </SectionHeader>
        <div className="form" data-compare="form">
          <Field label="Tên Hội Thánh">
            <TextInput data-compare="input" defaultValue="Hội Thánh Bình An" />
          </Field>
          <Field label="Tỉnh/Thành">
            <Select data-compare="select" defaultValue="Đà Nẵng">
              <option>Đà Nẵng</option>
            </Select>
          </Field>
        </div>
      </Card>
      <Toolbar>
        <Button variant="primary" data-compare="primary">
          <Icon name="plus" />
          Thêm Hội Thánh
        </Button>
        <Button data-compare="secondary">Hủy</Button>
        <Badge tone="good">Hoạt động</Badge>
      </Toolbar>
      <Card>
        <KeyValueList
          items={[
            { label: "Mã Hội Thánh", value: "HT-0001" },
            { label: "Tỉnh/Thành", value: "Đà Nẵng" },
          ]}
        />
      </Card>
      <TableFrame label="Bảng tham chiếu">
        <table>
          <thead>
            <tr>
              <th data-compare="th">Tên Hội Thánh</th>
              <th>Tỉnh/Thành</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-compare="td">Hội Thánh Bình An</td>
              <td>Đà Nẵng</td>
            </tr>
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}
function Reference() {
  const [modal, setModal] = useState(false),
    [drawer, setDrawer] = useState(false),
    [locked, setLocked] = useState(false),
    [tab, setTab] = useState("info"),
    [choice, setChoice] = useState(false);
  return (
    <AppShell
      activeId="reference"
      title="Bộ UI chung"
      context="UI-STD-r1 · dữ liệu minh họa · chỉ dùng cục bộ"
      identity={{ displayName: "Tham chiếu cục bộ", email: "ui@example.test" }}
      onLogout={() => {}}
      busy={false}
      items={[
        {
          id: "reference",
          label: "Bộ UI chung",
          icon: "grid",
          onSelect: () => window.scrollTo(0, 0),
        },
      ]}
    >
      <Feedback>
        HTML gốc là chuẩn style. Trang này dùng cùng component với A01/A04 và O01/O02.
      </Feedback>
      <Toolbar>
        <Field label="Giao diện">
          <Select
            defaultValue="system"
            onChange={(e) => {
              if (e.target.value === "system") delete document.documentElement.dataset.theme;
              else document.documentElement.dataset.theme = e.target.value;
            }}
          >
            <option value="system">Theo hệ thống</option>
            <option value="light">Sáng</option>
            <option value="dark">Tối</option>
          </Select>
        </Field>
        <Button variant="primary" onClick={() => setModal(true)}>
          Mở biểu mẫu
        </Button>
        <Button onClick={() => setDrawer(true)}>Mở drawer</Button>
        <IconButton icon="search" label="Tìm kiếm minh họa" />
      </Toolbar>
      <div className="ui-preview-grid">
        <Card>
          <SectionHeader title="Controls và trạng thái" />
          <div className="form">
            <Field label="Tên Hội Thánh">
              <TextInput required placeholder="Nhập tên Hội Thánh" />
            </Field>
            <Field label="Tỉnh/Thành">
              <Select>
                <option>Đà Nẵng</option>
                <option>Hà Nội</option>
              </Select>
            </Field>
            <Field label="Email liên hệ" error="Email chưa đúng định dạng." full>
              <TextInput defaultValue="email-sai" />
            </Field>
            <Field label="Thông tin khóa" hint="Chưa khả dụng.">
              <TextInput disabled defaultValue="—" />
            </Field>
            <Field label="Lý do" full>
              <TextArea rows={2} />
            </Field>
            <Choice
              label="Đã kiểm tra thông tin"
              checked={choice}
              onChange={(e) => setChoice(e.target.checked)}
            />
            <Choice type="radio" name="preview" label="Lựa chọn mẫu" defaultChecked />
          </div>
          <DialogActions>
            <Button disabled>Chưa khả dụng</Button>
            <Button variant="danger">Hành động rủi ro</Button>
            <Button variant="primary">Lưu</Button>
          </DialogActions>
        </Card>
        <Card>
          <SectionHeader title="Thông tin và số liệu" />
          <KeyValueList
            items={[
              { label: "Mã Hội Thánh", value: "HT-0001" },
              { label: "Tên Hội Thánh", value: "Hội Thánh Bình An — minh họa" },
              { label: "Trạng thái", value: <Badge tone="good">Hoạt động</Badge> },
            ]}
          />
          <Stats>
            <StatCard compact label="Tín hữu" value="—" unavailable />
            <StatCard compact label="Ban" value="—" unavailable />
            <StatCard compact label="Tài khoản" value={0} />
          </Stats>
          <Tabs
            id="reference"
            items={[
              { id: "info", label: "Thông tin" },
              { id: "history", label: "Lịch sử" },
              { id: "later", label: "Chưa khả dụng", disabled: true },
            ]}
            value={tab}
            onChange={setTab}
          />
          {["info", "history", "later"].map((id) => (
            <div
              key={id}
              role="tabpanel"
              id={`reference-panel-${id}`}
              aria-labelledby={`reference-tab-${id}`}
              hidden={tab !== id}
            >
              {id === "info" ? "Nội dung thông tin minh họa." : "Nội dung lịch sử minh họa."}
            </div>
          ))}
        </Card>
        <Card>
          <SectionHeader title="Phản hồi" />
          <Feedback tone="success">Đã lưu thông tin.</Feedback>
          <Feedback tone="error">Chưa thể lưu. Kiểm tra dữ liệu và thử lại.</Feedback>
          <Feedback tone="warning">
            Dữ liệu đã thay đổi. Tải lại và kiểm tra trước khi lưu.
          </Feedback>
          <Loading />
        </Card>
        <EmptyState message="Chưa có dữ liệu Hội Thánh để hiển thị.">
          <Button>Thêm Hội Thánh</Button>
        </EmptyState>
      </div>
      <PatternFixture />
      <PaginationControl loading={false} onMore={() => {}} />
      <Modal
        title="Biểu mẫu tham chiếu"
        open={modal}
        onClose={() => setModal(false)}
        locked={locked}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setModal(false);
          }}
        >
          <div className="form">
            <Field label="Tên Hội Thánh" full>
              <TextInput required disabled={locked} />
            </Field>
            <Field label="Tỉnh/Thành">
              <TextInput disabled={locked} />
            </Field>
            <Field label="Địa hạt">
              <TextInput disabled={locked} />
            </Field>
          </div>
          <Choice
            label="Khóa thao tác khi chờ đối soát"
            checked={locked}
            onChange={(e) => setLocked(e.target.checked)}
          />
          {locked && (
            <Feedback tone="warning">Chưa xác định kết quả. Kiểm tra trước khi thử lại.</Feedback>
          )}
          <DialogActions>
            {locked ? (
              <Button onClick={() => setLocked(false)}>Kiểm tra kết quả minh họa</Button>
            ) : (
              <>
                <Button onClick={() => setModal(false)}>Hủy</Button>
                <Button variant="primary" type="submit">
                  Lưu
                </Button>
              </>
            )}
          </DialogActions>
        </form>
      </Modal>
      <Drawer title="Chi tiết tham chiếu" open={drawer} onClose={() => setDrawer(false)}>
        <KeyValueList items={[{ label: "Trạng thái", value: "Minh họa" }]} />
        <DialogActions>
          <Button onClick={() => setDrawer(false)}>Đóng drawer</Button>
        </DialogActions>
      </Drawer>
    </AppShell>
  );
}
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    new URLSearchParams(location.search).has("fixture") ? <PatternFixture /> : <Reference />,
  );
