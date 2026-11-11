# Church CMS

Nền tảng Quản lý Hội Thánh: React/TypeScript/Vite/TailwindCSS, Bun/TypeScript, MongoDB replica set và Redis.

P1.1/P1.2 cung cấp luồng owner cục bộ và O01/O02: tạo/tìm/sửa/tạm ngưng/mở lại Hội Thánh, CAS/idempotency/audit và đối soát thao tác. User account/O03 tiếp tục theo gói đã duyệt; xem trạng thái hiện hành, không suy ra production readiness từ scaffold.

- [Khởi động và vận hành cục bộ](docs/engineering/P1.1-local-runbook.md)
- [Kế hoạch P1 và quyền thực hiện](docs/tasks/CHURCH-P1.md)
- [Hiện trạng](docs/project-state.md)
- [Chuẩn UI dùng chung từ HTML](docs/ui-system.md)
- [Thiết kế nền tảng r2](docs/engineering/P0-FOUNDATION.md)
- [Instructions](AGENTS.md) · [Agent Kit](docs/agent-kit-installation.md)

```sh
bun install --frozen-lockfile --ignore-scripts
bun run local:setup
docker compose up -d --wait
# Lần đầu: khởi tạo replica set theo runbook, rồi:
bun run db:init
bun run dev
```

`bun run lint`, `bun run typecheck`, `bun run build`, `bun test tests`, `bun run test:browser`, `bun run test:browser:p1.2`, `bun run ui:check`, `bun run test:ui` và `bun run benchmark` là các lệnh kiểm tra hiện có. Browser check dùng container riêng, không thay trust/global settings máy. Chỉ dữ liệu synthetic trong môi trường cục bộ; Git publication/deploy cần quyền riêng.

Trang mẫu UI dành cho phát triển: `bun run build:ui`; xem hướng dẫn trong `docs/ui-system.md`. Trang mẫu được build riêng, không nằm trong menu hay routes sản phẩm.
